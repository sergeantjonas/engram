import { parseWatchedAt } from '@engram/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import {
  episodes as episodeTable,
  titles as titleTable,
  watchEvents as watchEventTable,
} from '../db/schema.js';
import { episodesInScope, MANUAL_SOURCE, planWatchEvents, type WatchScope } from '../watch/plan.js';

/**
 * How much of a title one request marks.
 *
 * Season 0 is addressable, since specials are a real thing to have watched, but
 * a bare `all` leaves them out — see `planWatchEvents`.
 */
const scopeSchema = z.union([
  z.literal('all'),
  z.object({
    season: z.int().min(0, 'season must be 0 or more'),
    episode: z.int().min(1, 'episode must be 1 or more').optional(),
  }),
]);

const bodySchema = z.object({
  /** A title already stored here: `POST /titles` is what puts one in reach. */
  titleId: z.uuid('titleId must be the id of a stored title'),
  scope: scopeSchema.default('all'),
  /**
   * A year, a month, a date, or an instant carrying its offset. Absent is the
   * ordinary case rather than an omission: the history this route exists to
   * capture is largely undated.
   */
  watchedAt: z.string().trim().optional(),
});

export const toScope = (scope: z.infer<typeof scopeSchema>): WatchScope => {
  if (scope === 'all') return { kind: 'title' };
  if (scope.episode === undefined) return { kind: 'season', season: scope.season };
  return { kind: 'episode', season: scope.season, episode: scope.episode };
};

/**
 * How much of a title one request retracts, as a query string rather than a
 * body: a DELETE that carries one is legal but poorly supported by everything
 * between the browser and the route.
 *
 * Absent `season` is the whole title, which mirrors the `all` a mark defaults
 * to — specials included in neither.
 */
const removeQuery = z
  .object({
    titleId: z.uuid('titleId must be the id of a stored title'),
    // A digit string rather than coercion. `z.coerce.number()` reads `season=`
    // as 0, and 0 is a real season, so a whole-title undo would quietly become
    // a retraction of the specials nobody named — and it would equally accept
    // `2.5`, `1e3` and `0x10` as seasons.
    season: z.string().regex(/^\d+$/, 'season must be a whole number').transform(Number).optional(),
    episode: z
      .string()
      .regex(/^[1-9]\d*$/, 'episode must be a whole number, counting from 1')
      .transform(Number)
      .optional(),
  })
  .refine((query) => query.episode === undefined || query.season !== undefined, {
    message: 'an episode has to name the season it is in',
  });

/** The title a request is about and the grid a scope is resolved against. */
async function loadTarget(db: Database, titleId: string) {
  const [title] = await db
    .select({
      id: titleTable.id,
      key: titleTable.key,
      kind: titleTable.kind,
      name: titleTable.name,
    })
    .from(titleTable)
    .where(eq(titleTable.id, titleId))
    .limit(1);

  if (!title) return null;

  const episodes =
    title.kind === 'movie'
      ? []
      : await db
          .select({
            id: episodeTable.id,
            season: episodeTable.season,
            number: episodeTable.number,
          })
          .from(episodeTable)
          .where(eq(episodeTable.titleId, title.id));

  return { title, episodes };
}

/**
 * Recording that something was watched, which for history older than this Plex
 * server is the only way it gets in at all.
 *
 * Idempotent by construction: the event id is derived from the title, the
 * episode and the date as written, so submitting the same mark twice writes
 * nothing the second time. That is what makes a "mark season watched" button
 * safe to press twice, and the response says how much of a request was already
 * on record rather than hiding it.
 */
export function registerWatchEventRoutes(app: FastifyInstance, db: Database): void {
  app.post('/watch-events', async (request, reply) => {
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }
    const { titleId, scope, watchedAt } = parsed.data;

    const moment = parseWatchedAt(watchedAt);
    if (!moment) {
      return reply.code(400).send({
        error: 'bad_request',
        message: 'watchedAt must be a year, a month, a date, or an instant naming its offset',
      });
    }

    const target = await loadTarget(db, titleId);
    if (!target) {
      return reply
        .code(404)
        .send({ error: 'not_found', message: 'no title is stored under that id' });
    }
    const { title } = target;

    const plan = planWatchEvents({
      target: title,
      episodes: target.episodes,
      scope: toScope(scope),
      moment,
      // The date as written rather than as stored, so a year and the first of
      // January stay distinct events.
      on: moment.watchedAt === null ? null : (watchedAt ?? null),
      // The validated body, not the original: this is copied onto every row a
      // mark expands into, so an unbounded payload would be written once per
      // episode. Zod strips what the schema does not name, and what is left
      // still determines the derivation entirely.
      raw: parsed.data,
    });

    if (!plan.ok) {
      // Well-formed, but it does not apply to this title — a 404 would read as
      // the title being missing rather than the season the caller named.
      return reply.code(422).send({ error: 'unmarkable', message: plan.reason });
    }

    const written = await db
      .insert(watchEventTable)
      .values(plan.rows)
      .onConflictDoNothing({
        target: [watchEventTable.source, watchEventTable.sourceEventId],
      })
      .returning({ id: watchEventTable.id });

    return reply.code(written.length > 0 ? 201 : 200).send({
      title: { id: title.id, key: title.key, name: title.name },
      written: written.length,
      skipped: plan.rows.length - written.length,
    });
  });

  /**
   * Retracting a mark, because a mark is a claim and a claim can be a mistake.
   *
   * Only what this record was told by hand. A play Plex reported is something
   * that was observed, and deleting it here would neither make it untrue nor
   * survive the next reconciliation pass, so `source` is part of the predicate
   * rather than an afterthought — one misdirected undo must not be able to eat
   * the imported history this project exists to keep.
   *
   * The scope resolves through the same function a mark uses, so an undo covers
   * exactly what the mark covered: specials stay out of a whole-title retraction
   * the way they stay out of a whole-title mark.
   */
  app.delete('/watch-events', async (request, reply) => {
    const parsed = removeQuery.safeParse(request.query);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }
    const { titleId, season, episode } = parsed.data;

    const target = await loadTarget(db, titleId);
    if (!target) {
      return reply
        .code(404)
        .send({ error: 'not_found', message: 'no title is stored under that id' });
    }

    const scope: WatchScope =
      season === undefined
        ? { kind: 'title' }
        : episode === undefined
          ? { kind: 'season', season }
          : { kind: 'episode', season, episode };

    const scoped = episodesInScope(target.title.kind, target.episodes, scope);
    if (!scoped.ok) {
      return reply.code(422).send({ error: 'unmarkable', message: scoped.reason });
    }

    const episodeIds = scoped.slots.filter((slot) => slot !== null).map((slot) => slot.id);
    const removed = await db
      .delete(watchEventTable)
      .where(
        and(
          eq(watchEventTable.titleId, target.title.id),
          eq(watchEventTable.source, MANUAL_SOURCE),
          // On the kind rather than on the list being empty. They agree today,
          // but only the kind says why: a film's events name no episode, and
          // reading it off an empty list would turn any future scope that
          // resolves to nothing into "every title-level row".
          target.title.kind === 'movie'
            ? isNull(watchEventTable.episodeId)
            : inArray(watchEventTable.episodeId, episodeIds),
        ),
      )
      .returning({ id: watchEventTable.id });

    // Zero is an answer rather than an error: the scope was valid and nothing
    // in it had been claimed by hand, which is what the caller wanted to know.
    return reply.send({
      title: { id: target.title.id, key: target.title.key, name: target.title.name },
      removed: removed.length,
    });
  });
}
