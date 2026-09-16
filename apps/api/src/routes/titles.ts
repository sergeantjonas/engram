import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { episodes as episodeTable, titles as titleTable } from '../db/schema.js';
import { planEpisodes, planTitle } from '../titles/plan.js';
import {
  type TmdbClient,
  type TmdbEpisode,
  TmdbError,
  type TmdbTitleDetails,
} from '../tmdb/client.js';

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
            overview: sql`coalesce(excluded.overview, ${titleTable.overview})`,
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
}
