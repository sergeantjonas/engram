import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import {
  episodes as episodeTable,
  intent as intentTable,
  titles as titleTable,
} from '../db/schema.js';
import { asStranger, titleDetail } from '../titles/detail.js';
import { listTitles, withoutIntent } from '../titles/list.js';
import { nextUp } from '../titles/next-up.js';
import { planEpisodes, planTitle } from '../titles/plan.js';
import {
  type TmdbClient,
  type TmdbEpisode,
  TmdbError,
  type TmdbTitleDetails,
} from '../tmdb/client.js';

const listQuery = z.object({
  state: z.enum(['seen', 'in_progress', 'unwatched']).optional(),
  /**
   * Adds excluded titles to the answer rather than selecting them: off is the
   * point of marking a title not-mine, and there is no view that shows only
   * the rejects.
   */
  includeExcluded: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

const detailParams = z.object({ id: z.uuid('id must be the id of a stored title') });

/**
 * What the viewer wants, which is the thing Plex cannot express at all.
 *
 * Every field optional and at least one required: this is a patch, so leaving
 * `excluded` out means "unchanged" rather than "false". A body of nothing is a
 * mistake worth a 400 rather than a write of nothing.
 *
 * Booleans on the wire against two timestamps and a flag in the table. When a
 * title was dropped is a fact worth keeping, but a caller saying "I dropped
 * this" has no business choosing the moment — the server does, from its own
 * clock.
 */
const intentBody = z
  .object({
    want: z.boolean().optional(),
    dropped: z.boolean().optional(),
    excluded: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'name at least one of want, dropped or excluded',
  });

const bodySchema = z.object({
  kind: z.enum(['show', 'movie']),
  /**
   * The id carried by a `GET /search` candidate. Digits only, because it is
   * interpolated into the upstream path: `../../authentication/token/new`
   * resolves against the base URL and would aim the owner's API key at an
   * endpoint of the caller's choosing.
   */
  tmdbId: z.string().trim().regex(/^\d+$/, 'tmdbId must be a TMDB id'),
});

const upstreamFailed = (
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
  missing: string,
): FastifyReply => {
  if (!(error instanceof TmdbError)) throw error;
  if (error.upstreamStatus === 404) {
    return reply.code(404).send({ error: 'not_found', message: missing });
  }
  // Only the status: the error's message and cause can carry the request URL,
  // and the API key rides in that URL's query string.
  request.log.error({ upstreamStatus: error.upstreamStatus }, 'tmdb lookup failed');
  return reply.code(502).send({ error: 'upstream_failed', message: 'TMDB did not answer' });
};

/**
 * Recording a title the disk has never held, which is how history older than
 * this Plex server gets in at all.
 */
export function registerTitleRoutes(
  app: FastifyInstance,
  db: Database,
  tmdb: TmdbClient | null,
): void {
  /**
   * The wall. Everything stored, with the state each card is coloured by.
   *
   * Unpaginated on purpose: this is one person's library, and a few hundred
   * rows of metadata is smaller than one of the posters the page then loads.
   */
  app.get('/titles', async (request, reply) => {
    const parsed = listQuery.safeParse(request.query);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }

    const titles = await listTitles(db, {
      state: parsed.data.state,
      // Clamped for a stranger rather than refused: the flag exists to tidy the
      // owner's own listing, and answering 401 to it would tell them the flag
      // is worth having, which is more than ignoring it tells them.
      includeExcluded: parsed.data.includeExcluded && request.isOwner,
    });

    // What was meant is the owner's own note to themselves; what was watched
    // is the record. See authentication.md § What a stranger may read.
    return { titles: request.isOwner ? titles : titles.map(withoutIntent) };
  });

  /**
   * What to pick back up, which is the one question the wall cannot answer by
   * being looked at.
   *
   * Its own route rather than columns on `GET /titles`: it needs the episode
   * either side of where each show stopped, and carrying that across three
   * hundred cards that never read it would pay for the band on every page.
   */
  app.get('/next-up', async () => ({ nextUp: await nextUp(db) }));

  /**
   * One title and its grid, which is where the work happens.
   *
   * Excluded titles are served to the owner even though the wall hides them:
   * arriving by link or by back button should not 404 because of a flag that
   * exists to tidy a listing. A stranger gets the 404, because otherwise the
   * flag hides a title from the listing and an id still hands it over.
   */
  app.get('/titles/:id', async (request, reply) => {
    const parsed = detailParams.safeParse(request.params);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }

    const detail = await titleDetail(db, parsed.data.id);
    if (!detail || (detail.title.excluded && !request.isOwner)) {
      return reply
        .code(404)
        .send({ error: 'not_found', message: 'no title is stored under that id' });
    }

    return request.isOwner ? detail : asStranger(detail);
  });

  app.post('/titles', async (request, reply) => {
    if (!tmdb) {
      return reply
        .code(503)
        .send({ error: 'tmdb_unavailable', message: 'TMDB_API_KEY is not configured' });
    }

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }
    const { kind, tmdbId } = parsed.data;

    let details: TmdbTitleDetails;
    try {
      details = await tmdb.details(kind, tmdbId);
    } catch (error) {
      return upstreamFailed(request, reply, error, 'TMDB has no such title');
    }

    const plan = planTitle(details);
    if (!plan.ok) {
      return reply.code(422).send({ error: 'unidentifiable', message: plan.reason });
    }

    // Every season before the first write, so an upstream failure partway
    // through leaves no title at all rather than one with half a grid.
    const seasonEpisodes: TmdbEpisode[][] = [];
    try {
      for (const season of plan.seasons) {
        seasonEpisodes.push(await tmdb.seasonEpisodes(tmdbId, season));
      }
    } catch (error) {
      return upstreamFailed(request, reply, error, 'TMDB has no such season');
    }

    const { title, created, seasons } = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(titleTable)
        .values({ ...plan.title, metadataFetchedAt: new Date() })
        .onConflictDoUpdate({
          target: titleTable.key,
          set: {
            // Metadata is refreshed, identity is not. An id this row already
            // carries survives a TMDB response that happens to omit it — the
            // Plex resolution pass found ids TMDB alone does not always return.
            name: plan.title.name,
            year: sql`coalesce(excluded.year, ${titleTable.year})`,
            tmdbId: sql`coalesce(excluded.tmdb_id, ${titleTable.tmdbId})`,
            tvdbId: sql`coalesce(excluded.tvdb_id, ${titleTable.tvdbId})`,
            imdbId: sql`coalesce(excluded.imdb_id, ${titleTable.imdbId})`,
            posterPath: sql`coalesce(excluded.poster_path, ${titleTable.posterPath})`,
            backdropPath: sql`coalesce(excluded.backdrop_path, ${titleTable.backdropPath})`,
            overview: sql`coalesce(excluded.overview, ${titleTable.overview})`,
            // Not coalesced: a status changes and a next episode goes away
            // once it airs, so what TMDB answered today is the fact.
            status: plan.title.status,
            lastAirDate: plan.title.lastAirDate,
            nextAirDate: plan.title.nextAirDate,
            nextEpisodeSeason: plan.title.nextEpisodeSeason,
            nextEpisodeNumber: plan.title.nextEpisodeNumber,
            metadataFetchedAt: new Date(),
          },
        })
        // `xmax` is zero only on a genuine insert, so one statement answers both
        // what the row is and whether it is new. Asking beforehand would let two
        // concurrent posts both decide they created it.
        .returning({ id: titleTable.id, inserted: sql<boolean>`xmax = 0` });

      // DO UPDATE always writes a row and RETURNING always yields it; this is
      // the type system asking rather than a case that occurs.
      if (!row) throw new Error(`title ${plan.title.key} was not written`);

      const rows = planEpisodes(seasonEpisodes.flat()).map((episode) => ({
        ...episode,
        titleId: row.id,
      }));
      if (rows.length > 0) {
        await tx.insert(episodeTable).values(rows).onConflictDoNothing();
      }

      return {
        title: { id: row.id, ...plan.title },
        created: row.inserted,
        seasons: await tx
          .select({ season: episodeTable.season, episodeCount: sql<number>`count(*)::int` })
          .from(episodeTable)
          .where(eq(episodeTable.titleId, row.id))
          .groupBy(episodeTable.season)
          .orderBy(episodeTable.season),
      };
    });

    return reply.code(created ? 201 : 200).send({ title, seasons });
  });

  /**
   * What the viewer wants of a title, as against what they have watched.
   *
   * An upsert because most titles have no `intent` row at all — the row is
   * created by the first opinion anyone has about the title, and a caller
   * should not have to know whether they are the first.
   *
   * No `plan*()` split: as with a hole's reason, there is no decision between
   * validating the body and writing it, and a pure function here would take
   * three booleans and hand back three booleans.
   */
  app.put('/titles/:id/intent', async (request, reply) => {
    const id = detailParams.safeParse(request.params);
    if (!id.success) {
      const message = id.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }

    const body = intentBody.safeParse(request.body);
    if (!body.success) {
      const message = body.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }

    // Checked rather than left to the foreign key: a violation would surface as
    // a 500 quoting a constraint name, and "no such title" is a 404.
    const [stored] = await db
      .select({ id: titleTable.id })
      .from(titleTable)
      .where(eq(titleTable.id, id.data.id))
      .limit(1);

    if (!stored) {
      return reply.code(404).send({ error: 'not_found', message: 'no title has that id' });
    }

    const { want, dropped, excluded } = body.data;
    // Only the named fields, so a patch cannot silently reset the two it did
    // not mention. `now()` rather than a Node `Date` for the same reason the
    // gap route uses it: one column should not be written from two clocks.
    const changes = {
      ...(want === undefined ? {} : { want }),
      ...(dropped === undefined ? {} : { droppedAt: dropped ? sql`now()` : null }),
      ...(excluded === undefined ? {} : { excludedAt: excluded ? sql`now()` : null }),
    };

    const [row] = await db
      .insert(intentTable)
      .values({ titleId: id.data.id, ...changes })
      .onConflictDoUpdate({ target: intentTable.titleId, set: changes })
      .returning({
        want: intentTable.want,
        droppedAt: intentTable.droppedAt,
        excludedAt: intentTable.excludedAt,
      });

    // Booleans back, matching what the wall reads off `GET /titles`. When a
    // title was dropped is kept, but nothing asks for it yet.
    return reply.send({
      intent: {
        want: row?.want ?? false,
        dropped: row?.droppedAt != null,
        excluded: row?.excludedAt != null,
      },
    });
  });
}
