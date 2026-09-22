import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { parseCookieHeader, SESSION_COOKIE } from './cookies.js';
import { resolveOwner } from './store.js';

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * Whether this request carries the owner's session.
     *
     * Resolved once, ahead of every route, because the open reads below are not
     * the same answer for both callers: the owner sees excluded titles and the
     * notes they wrote, and a stranger sees the record without them.
     */
    isOwner: boolean;
  }
}

/**
 * Everything reachable without a session, keyed by method and route pattern.
 *
 * `/health` and `/ready` because a reverse proxy has to reach them to decide
 * whether to route here at all, and the auth routes because they are how a
 * session comes to exist, is asked about, and ends. The two title reads because
 * the record is meant to be readable: what watching happened is the thing this
 * project exists to keep, and keeping it behind a login makes it a diary rather
 * than a record. Being outside the gate is not the same as being unchecked —
 * each of those handlers still varies on who is asking.
 *
 * The method is part of the key, which is the whole shape of the change: `GET
 * /titles` is open and `POST /titles` is not, and nothing else about the wall
 * distinguishes them.
 *
 * The Tautulli receiver is on it: it authenticates with a shared secret in
 * its own handler because it has no session to present. Sonarr and Radarr
 * will join it the same way, and are not an
 * exception to being authenticated: Tautulli and Sonarr have no browser and no
 * cookie jar, so they present `WEBHOOK_SECRET` instead of a session.
 */
const OPEN_ROUTES = new Set([
  'GET /health',
  'GET /ready',
  'GET /auth/github/login',
  'GET /auth/github/callback',
  // Both answer for a caller who has no session, which is why they are here
  // rather than behind the gate. Their handlers say why.
  'GET /auth/me',
  'POST /auth/logout',
  // The record. Every other read — TMDB search above all, which spends the
  // owner's key and exists only to feed the add screen — stays behind the gate.
  'GET /titles',
  'GET /titles/:id',
  // The rest of a title's feed; the detail already carries its first page.
  'GET /titles/:id/activity',
  // Same reasoning as the two above, and it discloses nothing they do not:
  // what was watched and what comes after it is the record itself.
  'GET /next-up',
  // Every title's dated plays at once, which discloses nothing the feeds above
  // do not.
  'GET /history',
  // Tautulli has no cookie jar, so its own shared secret is what
  // authenticates it — checked in the handler, not here. Open by method and
  // pattern together, so nothing else about /webhooks is opened with it.
  'POST /webhooks/tautulli',
]);

/** What the SPA sends; the API has no other kind of caller with a browser. */
const ALLOWED_METHODS = 'GET, POST, PUT, DELETE, OPTIONS';

/**
 * Resolves who is asking, and gates everything the answer does not open.
 *
 * Global with an opt-in list, which is the opposite of how `vyoh.gg` applies
 * the same guard — and deliberately so. That site annotates the owner routes,
 * so forgetting an annotation there leaks a page; here, forgetting an entry
 * locks a route rather than opening it. The failure mode should be the
 * recoverable one, and it stays that way now that the list has reads on it: a
 * write can never be opened by omission, because omission closes.
 *
 * Registered before the routes so it runs ahead of them, and CORS before the
 * gate so that a 401 still carries the headers that let the SPA read it as a
 * 401 rather than as an opaque CORS failure.
 */
export function registerOwnerGuard(app: FastifyInstance, db: Database, config: Config): void {
  app.decorateRequest('isOwner', false);

  app.addHook('onRequest', async (request, reply) => {
    // Set whether or not the origin matched: a cache keyed on the path alone
    // would otherwise hand one origin's allow header to another.
    reply.header('vary', 'Origin');

    if (request.headers.origin === config.WEB_ORIGIN) {
      reply.header('access-control-allow-origin', config.WEB_ORIGIN);
      // What lets the SPA's own `fetch` carry the session cookie. A wildcard
      // origin is incompatible with credentials, so there is no shortcut here
      // — and it is not what makes the OAuth leg work, which is `sameSite:
      // lax`. The two are easy to conflate when one of them starts failing.
      reply.header('access-control-allow-credentials', 'true');
    }

    if (request.method === 'OPTIONS') {
      // Nothing registers an OPTIONS route, so without this a preflight is a
      // 404 and every credentialed request the SPA makes fails before the real
      // one is sent. Answered here, ahead of the gate, because a preflight
      // carries no cookies by design and gating it would 401 the lot.
      reply.header('access-control-allow-methods', ALLOWED_METHODS);
      reply.header('access-control-allow-headers', 'content-type');
      reply.header('access-control-max-age', '600');
      return reply.code(204).send();
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    // HEAD is GET without the body, and Fastify registers one for every GET
    // route on its own. Keyed literally, a proxy's `HEAD /health` would answer
    // 401 — the one thing the probes are on this list to prevent.
    const method = request.method === 'HEAD' ? 'GET' : request.method;

    // The registered pattern rather than the path, so that `/titles/:id` is one
    // entry instead of one per id, and a query string is not mistaken for part
    // of what is open. A request that matched no route has no pattern at all,
    // so an unknown path answers 401 rather than 404 — the right way round on
    // an API that tells strangers nothing.
    const route = `${method} ${request.routeOptions.url ?? ''}`;

    // Resolved even for an open route, and before the open check rather than
    // after: a failure to read the session must not quietly serve the owner the
    // stranger's narrower answer. If this throws, the request is a 500.
    const token = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE];
    request.isOwner = await resolveOwner(db, token, config.OWNER_GITHUB_USER_ID, new Date());

    if (request.isOwner || OPEN_ROUTES.has(route)) return;

    return reply.code(401).send({ error: 'unauthorized', message: 'an owner session is required' });
  });
}
