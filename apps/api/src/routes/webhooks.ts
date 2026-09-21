import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';

/**
 * Constant time, and length-guarded because `timingSafeEqual` throws on a
 * mismatch rather than returning false — the same trap the OAuth state
 * verifier hit, where a UTF-16 string length was compared against a byte
 * length and the check passed for the wrong reason.
 */
function secretMatches(offered: string | undefined, want: string): boolean {
  if (offered === undefined) return false;
  const a = Buffer.from(offered, 'utf8');
  const b = Buffer.from(want, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Tautulli's webhook, in its recording phase.
 *
 * It does not parse, and that is the point rather than an omission.
 * Per-media-type coverage of Tautulli's external-id parameters is unverified
 * — the note in `plex-api-findings.md` says coverage differs between movies
 * and episodes and depends on which agent scanned the library, and Tautulli
 * substitutes an empty string for a parameter that does not apply, so a body
 * arrives looking complete with `"themoviedb_id": ""`. Writing a parser
 * against the documented list and finding out in production is the failure
 * this endpoint exists to avoid.
 *
 * So: authenticate, record, answer. Once a real episode and a real film have
 * been through it, the parser is written against what they actually carried
 * and this comment goes away with it.
 */
export function registerWebhookRoutes(app: FastifyInstance, config: Config): void {
  app.post('/webhooks/tautulli', async (request, reply) => {
    // A header rather than a query parameter: a query string is written to
    // nginx's access log in full, and this secret is the only thing standing
    // between a public endpoint and the watch history.
    const offered = request.headers['x-engram-token'];
    if (!secretMatches(typeof offered === 'string' ? offered : undefined, config.WEBHOOK_SECRET)) {
      // No detail. A sender that got the secret wrong and one that guessed at
      // the route should learn the same amount, which is nothing.
      return reply.code(401).send({ error: 'unauthorized' });
    }

    // Logged rather than stored: this phase answers "which fields arrive
    // filled", and a table would outlive the question. `empty` is the half
    // that matters — a parameter Tautulli could not resolve comes through as
    // an empty string, not as an absent key.
    const body = request.body;
    const fields =
      body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const filled = Object.keys(fields).filter((k) => fields[k] !== '' && fields[k] != null);
    const empty = Object.keys(fields).filter((k) => fields[k] === '' || fields[k] == null);

    request.log.info(
      { tautulli: body, filled, empty, contentType: request.headers['content-type'] },
      'tautulli webhook received',
    );

    // 204 rather than a body: Tautulli logs a non-2xx as a failed
    // notification and retries nothing, so the only thing worth saying is
    // that it arrived.
    return reply.code(204).send();
  });
}
