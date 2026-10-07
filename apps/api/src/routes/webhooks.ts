import type { FastifyInstance } from 'fastify';
import { secretMatches } from '../auth/secret.js';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { planSonarrEvent } from '../ingest/sonarr.js';
import { storeSonarrPlan } from '../ingest/sonarr-store.js';
import { planTautulliPlay, readAction, readLiveEvent } from '../ingest/tautulli.js';
import { storeTautulliPlay } from '../ingest/tautulli-store.js';
import type { LiveSessions } from '../live/sessions.js';

/**
 * Tautulli's and Sonarr's webhooks: the freshness half of ingest.
 *
 * For Tautulli: authenticate, check whose play it is, read which trigger sent
 * it, move what is live, plan a stop, write, answer. Sonarr's is the same
 * without the viewer and the live sessions. Correctness is the nightly library
 * walk's job — both are idempotent on `(source, source_event_id)` precisely so
 * the two can overlap freely — which is why nothing here refuses a body it
 * cannot use. What this drops, the walk still finds.
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
    // The header is accepted too, the one way Sonarr's route below takes it.
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

  // Sonarr's webhook: what it grabbed, imported and deleted, per episode, and
  // the series it was told to add or drop. Same shape as Tautulli's above,
  // with one thing that makes refusing nothing matter more: Sonarr tries once,
  // and a webhook still failing five minutes on is paused, skipping every
  // event until it recovers. A body it cannot use must not be what pauses it.
  app.post('/webhooks/sonarr', async (request, reply) => {
    // A header only. Sonarr's form has one, and its body is built by Sonarr,
    // so there is no template to put a token in.
    const header = request.headers['x-engram-token'];
    const offered = typeof header === 'string' ? header : undefined;

    if (!secretMatches(offered, config.WEBHOOK_SECRET)) {
      // Refused, unlike everything below: a wrong secret is a setting to fix,
      // and Sonarr's own failure mark is the place it shows. Lengths, never
      // values, as for Tautulli.
      request.log.warn(
        {
          tokenSource: typeof header === 'string' ? 'header' : 'absent',
          offeredLength: offered?.length ?? 0,
          expectedLength: config.WEBHOOK_SECRET.length,
        },
        'sonarr webhook rejected',
      );
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const plan = planSonarrEvent(request.body);
    if (!plan.ok) {
      // The reason names fields, never their values, and the walk recovers
      // whatever this drops.
      request.log.warn({ reason: plan.reason }, 'sonarr webhook not planned');
      return reply.code(204).send();
    }
    if (plan.action === 'none') {
      request.log.info({ eventType: plan.eventType, why: plan.why }, 'sonarr webhook ignored');
      return reply.code(204).send();
    }

    const stored = await storeSonarrPlan(db, plan);

    // The key and the episode numbers, enough to follow a delivery to its
    // rows. `raw` on each row is the full payload, paths and all.
    request.log.info(
      {
        action: plan.action,
        kind: plan.action === 'file' ? plan.kind : null,
        title: plan.series.key,
        episodes:
          plan.action === 'file'
            ? plan.events.map((e) => `s${e.episode.season}e${e.episode.number}`)
            : null,
        known: stored.titleId !== null,
        written: stored.written,
        skipped: stored.skipped,
      },
      'sonarr event recorded',
    );
    return reply.code(204).send();
  });
}
