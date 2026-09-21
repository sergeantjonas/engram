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
    const body = request.body;
    const fields =
      body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};

    // In the body rather than the query string, which nginx writes to its
    // access log in full and Fastify repeats in its own request log — the
    // secret would be at rest in two files. A body is in neither, and is
    // stripped below before this handler logs anything itself.
    //
    // The header is still accepted: Sonarr and Radarr can send one, and they
    // are the next two through here.
    const header = request.headers['x-engram-token'];
    const offered =
      typeof header === 'string'
        ? header
        : typeof fields.token === 'string'
          ? fields.token
          : undefined;

    if (!secretMatches(offered, config.WEBHOOK_SECRET)) {
      // The reply says nothing — a sender that got the secret wrong and one
      // that guessed at the route should learn the same amount. The log is a
      // different audience: without this a rejection is indistinguishable
      // from a body that never parsed, and the first one of these took a
      // round trip through a deploy to work out.
      //
      // Lengths, never values. Comparing the length of what arrived against
      // the length of what was expected separates "wrong secret" from
      // "no token in the body" from "the body is not what I think it is",
      // which is every case worth telling apart.
      request.log.warn(
        {
          keys: Object.keys(fields),
          contentType: request.headers['content-type'],
          tokenSource:
            typeof header === 'string'
              ? 'header'
              : typeof fields.token === 'string'
                ? 'body'
                : 'absent',
          offeredLength: offered?.length ?? 0,
          expectedLength: config.WEBHOOK_SECRET.length,
        },
        'tautulli webhook rejected',
      );
      return reply.code(401).send({ error: 'unauthorized' });
    }

    // Whose play this is, before any of it is written down. The server is
    // shared, and a housemate's viewing must not end up in this record —
    // including in a log line, which is a record of what they watched just
    // as much as a row would be. So the check sits above the logging, not
    // beside the parsing that will come later.
    //
    // Tautulli's ids, not Plex's: `{user_id}` is 7597797 for the same owner
    // the history endpoint calls account 1. An empty list allows nobody,
    // because a write path opened by omission is the failure this cannot
    // afford.
    const viewer = typeof fields.user_id === 'string' ? fields.user_id : null;
    if (viewer === null || !config.TAUTULLI_USER_IDS.includes(viewer)) {
      request.log.info(
        {
          viewer,
          allowlistSize: config.TAUTULLI_USER_IDS.length,
          mediaType: typeof fields.media_type === 'string' ? fields.media_type : null,
        },
        'tautulli webhook ignored: not an allowed viewer',
      );
      // Accepted, not refused. Tautulli logs a non-2xx as a failed
      // notification, and a housemate watching something is not a failure —
      // it is simply not ours to keep.
      return reply.code(204).send();
    }

    // Never the token, whichever way it arrived. The point of keeping it out
    // of the query string is lost if the handler writes it to the log itself.
    const { token: _secret, ...rest } = fields;

    // Logged rather than stored: this phase answers "which fields arrive
    // filled", and a table would outlive the question. `empty` is the half
    // that matters — a parameter Tautulli could not resolve comes through as
    // an empty string, not as an absent key.
    const filled = Object.keys(rest).filter((k) => rest[k] !== '' && rest[k] != null);
    const empty = Object.keys(rest).filter((k) => rest[k] === '' || rest[k] == null);

    request.log.info(
      { tautulli: rest, filled, empty, contentType: request.headers['content-type'] },
      'tautulli webhook received',
    );

    // 204 rather than a body: Tautulli logs a non-2xx as a failed
    // notification and retries nothing, so the only thing worth saying is
    // that it arrived.
    return reply.code(204).send();
  });
}
