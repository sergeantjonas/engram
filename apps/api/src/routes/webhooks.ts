import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { planTautulliPlay } from '../ingest/tautulli.js';
import { storeTautulliPlay } from '../ingest/tautulli-store.js';

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
 * Tautulli's webhook: the freshness half of ingest.
 *
 * Authenticate, check whose play it is, plan, write, answer. Correctness is
 * the nightly library walk's job — this is idempotent on
 * `(source, source_event_id)` precisely so the two can overlap freely — which
 * is why nothing here refuses a body it cannot use. A play this drops is a
 * play the walk still finds.
 */
export function registerWebhookRoutes(app: FastifyInstance, config: Config, db: Database): void {
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

    const plan = planTautulliPlay(rest);
    if (!plan.ok) {
      // Warned, not refused. Tautulli logs a non-2xx as a failed notification
      // and retries nothing, so a 4xx would put a red mark in its log without
      // getting the play back. Field names and never values: a body this
      // could not read is still a record of what somebody watched.
      request.log.warn(
        { reason: plan.reason, keys: Object.keys(rest) },
        'tautulli webhook not planned',
      );
      return reply.code(204).send();
    }

    const stored = await storeTautulliPlay(db, plan);

    // The key rather than the name, and the numbers that decided it: enough
    // to follow a play from Tautulli to a row without keeping a second copy
    // of the record in the log. `raw` on the row itself is the full payload.
    request.log.info(
      {
        title: plan.title.key,
        season: plan.play.season,
        episode: plan.play.number,
        percentComplete: plan.play.percentComplete,
        completed: plan.play.completed,
        written: stored.written,
      },
      'tautulli play recorded',
    );

    // 204 rather than a body: Tautulli logs a non-2xx as a failed
    // notification and retries nothing, so the only thing worth saying is
    // that it arrived.
    return reply.code(204).send();
  });
}
