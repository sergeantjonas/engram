import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { parseCookieHeader, SESSION_COOKIE } from './cookies.js';
import { resolveOwner } from './store.js';

/**
 * The only paths reachable without a session.
 *
 * `/health` and `/ready` because a reverse proxy has to reach them to decide
 * whether to route here at all, and the login pair because they are how a
 * session comes to exist.
 *
 * The webhook receivers will join this list when they land, and are not an
 * exception to being authenticated: Tautulli and Sonarr have no browser and no
 * cookie jar, so they present `WEBHOOK_SECRET` instead of a session.
 */
const OPEN_PATHS = new Set(['/health', '/ready', '/auth/github/login', '/auth/github/callback']);

/** What the SPA sends; the API has no other kind of caller with a browser. */
const ALLOWED_METHODS = 'GET, POST, OPTIONS';

/**
 * Gates every route on an owner session, and answers the browser's preflight.
 *
 * Global with an opt-out list, which is the opposite of how `vyoh.gg` applies
 * the same guard — and deliberately so. That site is public with a few owner
 * routes, so forgetting an annotation there leaks a page; this API is private
 * with a few open ones, so forgetting an entry here locks a route rather than
 * opening it. The failure mode should be the recoverable one.
 *
 * Registered before the routes so it runs ahead of them, and CORS before the
 * gate so that a 401 still carries the headers that let the SPA read it as a
 * 401 rather than as an opaque CORS failure.
 */
export function registerOwnerGuard(app: FastifyInstance, db: Database, config: Config): void {
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
    // The path alone: a query string is not part of what is open, and an
    // unmatched route has no route pattern to compare against. An unknown path
    // therefore answers 401 rather than 404, which is the right way round on
    // an API that tells strangers nothing.
    const path = request.url.split('?')[0] ?? '';
    if (OPEN_PATHS.has(path)) return;

    const token = parseCookieHeader(request.headers.cookie)[SESSION_COOKIE];
    if (await resolveOwner(db, token, config.OWNER_GITHUB_USER_ID, new Date())) return;

    return reply.code(401).send({ error: 'unauthorized', message: 'an owner session is required' });
  });
}
