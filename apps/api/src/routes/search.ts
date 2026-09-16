import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { type TmdbClient, TmdbError } from '../tmdb/client.js';

/**
 * One request is one TMDB page, and a page is 20 results, so a larger limit
 * would promise more than it can return. Fewer than `limit` can still come
 * back: people are filtered out of the page after it arrives.
 */
const querySchema = z.object({
  q: z.string().trim().min(1, 'q is required'),
  limit: z.coerce.number().int().min(1).max(20).default(20),
});

/**
 * Finding a title that is not on disk, which is the first step of recording
 * something watched years ago.
 *
 * `tmdb` is null when no key is configured. The route then answers 503 rather
 * than being left unregistered: a missing capability is worth saying out loud,
 * and a 404 would look like the client had the wrong path.
 */
export function registerSearchRoutes(app: FastifyInstance, tmdb: TmdbClient | null): void {
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
      return { results: results.slice(0, parsed.data.limit) };
    } catch (error) {
      if (!(error instanceof TmdbError)) throw error;
      // Only the status, never the error itself: its message or cause can carry
      // the request URL, and the API key rides in that URL's query string.
      request.log.error({ upstreamStatus: error.upstreamStatus }, 'tmdb search failed');
      return reply.code(502).send({ error: 'upstream_failed', message: 'TMDB did not answer' });
    }
  });
}
