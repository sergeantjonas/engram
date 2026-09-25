import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { planTautulliPlay, readAction, readLiveEvent } from '../ingest/tautulli.js';
import { storeTautulliPlay } from '../ingest/tautulli-store.js';
import type { LiveSessions } from '../live/sessions.js';

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
 * Authenticate, check whose play it is, read which trigger sent it, move
 * what is live, plan a stop, write, answer. Correctness is
 * the nightly library walk's job — this is idempotent on
 * `(source, source_event_id)` precisely so the two can overlap freely — which
 * is why nothing here refuses a body it cannot use. A play this drops is a
 * play the walk still finds.
 */
export function registerWebhookRoutes(
  app: FastifyInstance,
  config: Config,
  db: Database,
  live: LiveSessions,
): void {
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

    const reading = readAction(fields);

    // The one body answered before the viewer check. Tautulli builds a server
    // trigger with no session to take a `{user_id}` from, so it can never pass
    // the check, and it names nothing anybody watched.
    if (reading.known && reading.action === 'intdown') {
      const down = readLiveEvent(reading.action, fields);
      if (down.ok) live.apply(down.event);
      request.log.info(
        { action: reading.action, read: down.ok ? true : down.reason },
        'tautulli server event received',
      );
      return reply.code(204).send();
    }

    // Whose play this is, before any of it is written down. The server is
    // shared, and a housemate's viewing must not end up in this record —
    // including in a log line, which is a record of what they watched just
    // as much as a row would be. So the check sits above the logging — all of
    // it but the userless server trigger's — not beside the parsing.
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

    // Answered 204 like everything else here: a trigger turned on before the
    // receiver knew it is a template to fix, not a delivery to mark failed.
    if (!reading.known) {
      request.log.warn({ action: reading.action }, 'tautulli webhook ignored: unknown action');
      return reply.code(204).send();
    }

    // Every trigger moves what is live, a stop included, and ahead of the
    // record's write, so a write that fails cannot leave the session showing.
    const moved = readLiveEvent(reading.action, rest);
    if (moved.ok) {
      live.apply(moved.event);
    } else {
      // Field names and never values, as for a play that could not be planned.
      request.log.warn(
        { action: reading.action, reason: moved.reason, keys: Object.keys(rest) },
        'tautulli live event not read',
      );
    }

    // Only a stop is a play. Every other trigger says where a session is, and
    // planned as a play it would land in the record as a play of its own, in
    // a table nothing is ever taken back out of.
    if (reading.action !== 'stop') {
      const update = moved.ok && moved.event.kind === 'update' ? moved.event : null;
      request.log.info(
        {
          action: reading.action,
          title: update?.session.titleKey ?? null,
          season: update?.session.episode?.season ?? null,
          episode: update?.session.episode?.number ?? null,
          othersLive: update?.othersLive ?? null,
          live: live.now().length,
        },
        'tautulli playback event received',
      );
      return reply.code(204).send();
    }

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
