import { parseWatchedAt } from '@engram/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import {
  episodes as episodeTable,
  titles as titleTable,
  watchEvents as watchEventTable,
} from '../db/schema.js';
import { planWatchEvents, type WatchScope } from '../watch/plan.js';

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

    if (!title) {
      return reply
        .code(404)
        .send({ error: 'not_found', message: 'no title is stored under that id' });
    }

    const grid =
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

    const plan = planWatchEvents({
      target: title,
      episodes: grid,
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
}
