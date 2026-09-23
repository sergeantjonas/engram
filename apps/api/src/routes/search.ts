import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { titles as titleTable } from '../db/schema.js';
import { type TmdbCandidate, type TmdbClient, TmdbError } from '../tmdb/client.js';

/** TMDB refuses a page past 500, whatever its `total_pages` says there are. */
const LAST_PAGE = 500;

/**
 * One request is one TMDB page of up to 20. Fewer can come back than TMDB
 * sent: a search across both kinds has its people filtered out of the page
 * after it arrives.
 */
const querySchema = z
  .object({
    q: z.string().trim().min(1, 'q is required'),
    kind: z.enum(['show', 'movie']).optional(),
    // The range TMDB accepts, which is wider than anything it holds a title for.
    year: z.coerce.number().int().min(1000).max(9999).optional(),
    page: z.coerce.number().int().min(1).max(LAST_PAGE).default(1),
  })
  .refine((query) => query.year === undefined || query.kind !== undefined, 'year needs a kind');

/** A candidate with the id of the title already holding it, when there is one. */
export interface SearchResult extends TmdbCandidate {
  storedTitleId: string | null;
}

/**
 * Which of these candidates the record already holds.
 *
 * Matched on kind and id together, never on the id alone: TMDB numbers films
 * and series in separate namespaces, so film 1399 and series 1399 are two
 * different things and one of them is not stored.
 */
async function markStored(db: Database, candidates: TmdbCandidate[]): Promise<SearchResult[]> {
  const ids = [...new Set(candidates.map((candidate) => candidate.tmdbId))];
  if (ids.length === 0) return [];

  const rows = await db
    .select({ id: titleTable.id, kind: titleTable.kind, tmdbId: titleTable.tmdbId })
    .from(titleTable)
    .where(inArray(titleTable.tmdbId, ids));

  const byCandidate = new Map(rows.map((row) => [`${row.kind}:${row.tmdbId}`, row.id]));

  return candidates.map((candidate) => ({
    ...candidate,
    storedTitleId: byCandidate.get(`${candidate.kind}:${candidate.tmdbId}`) ?? null,
  }));
}

/**
 * Finding a title that is not on disk, which is the first step of recording
 * something watched years ago.
 *
 * `tmdb` is null when no key is configured. The route then answers 503 rather
 * than being left unregistered: a missing capability is worth saying out loud,
 * and a 404 would look like the client had the wrong path.
 */
export function registerSearchRoutes(
  app: FastifyInstance,
  db: Database,
  tmdb: TmdbClient | null,
): void {
  app.get('/search', async (request, reply) => {
    if (!tmdb) {
      return reply
        .code(503)
        .send({ error: 'search_unavailable', message: 'TMDB_API_KEY is not configured' });
    }

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      const message = parsed.error.issues.map((issue) => issue.message).join('; ');
      return reply.code(400).send({ error: 'bad_request', message });
    }

    const { q, kind, year, page } = parsed.data;
    try {
      const found = await tmdb.search(q, kind ? { kind, year } : undefined, page);
      return {
        results: await markStored(db, found.results),
        page: found.page,
        hasMore: found.page < Math.min(found.totalPages, LAST_PAGE),
      };
    } catch (error) {
      if (!(error instanceof TmdbError)) throw error;
      // Only the status, never the error itself: its message or cause can carry
      // the request URL, and the API key rides in that URL's query string.
      request.log.error({ upstreamStatus: error.upstreamStatus }, 'tmdb search failed');
      return reply.code(502).send({ error: 'upstream_failed', message: 'TMDB did not answer' });
    }
  });
}
