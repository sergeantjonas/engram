import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Database } from '../db/client.js';
import { titles as titleTable } from '../db/schema.js';
import { type TmdbCandidate, type TmdbClient, TmdbError } from '../tmdb/client.js';

/**
 * One request is one TMDB page, and a page is 20 results, so a larger limit
 * would promise more than it can return. Fewer than `limit` can still come
 * back: people are filtered out of the page after it arrives.
 */
const querySchema = z.object({
  q: z.string().trim().min(1, 'q is required'),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});

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

    try {
      const results = await tmdb.search(parsed.data.q);
      // After the slice, so the lookup covers what is answered rather than the
      // whole page.
      return { results: await markStored(db, results.slice(0, parsed.data.limit)) };
    } catch (error) {
      if (!(error instanceof TmdbError)) throw error;
      // Only the status, never the error itself: its message or cause can carry
      // the request URL, and the API key rides in that URL's query string.
      request.log.error({ upstreamStatus: error.upstreamStatus }, 'tmdb search failed');
      return reply.code(502).send({ error: 'upstream_failed', message: 'TMDB did not answer' });
    }
  });
}
