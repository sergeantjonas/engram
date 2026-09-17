import { sql } from 'drizzle-orm';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { registerOwnerGuard } from './auth/guard.js';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
import type { GithubClient } from './github/client.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerTitleRoutes } from './routes/titles.js';
import { registerWatchEventRoutes } from './routes/watch-events.js';
import type { TmdbClient } from './tmdb/client.js';

export interface AppDeps {
  config: Config;
  db: Database;
  /**
   * Null when `TMDB_API_KEY` is unset. The API still boots and serves
   * everything that does not need TMDB, and the routes that do say so.
   */
  tmdb: TmdbClient | null;
  /** Never null: its credentials are required configuration, checked at boot. */
  github: GithubClient;
}

/**
 * Assembles the app from its dependencies rather than reaching for module-scope
 * singletons, so a test can hand it a stub and drive routes through
 * `app.inject()` without a database, a network or an open port.
 */
export function buildApp({ config, db, tmdb, github }: AppDeps): FastifyInstance {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      serializers: {
        /**
         * The default serializer logs the whole URL at `info`, and the OAuth
         * callback's query string carries a live authorisation code and the
         * signed state. Neither is worth keeping, and a log is the one place a
         * short-lived secret outlives its exchange.
         */
        req: (request) => ({
          method: request.method,
          url: request.url.startsWith('/auth/') ? (request.url.split('?')[0] ?? '') : request.url,
          host: request.host,
          remoteAddress: request.ip,
        }),
      },
    },
  });

  /**
   * Fastify's default handler puts the thrown error's message in the response,
   * so a constraint violation would answer with the schema's own text. A
   * failure the route did not anticipate is logged in full and reported as
   * nothing more than a 500.
   */
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status < 500) {
      return reply.code(status).send({ error: 'bad_request', message: error.message });
    }
    request.log.error({ err: error }, 'request failed');
    return reply
      .code(500)
      .send({ error: 'internal', message: 'the request could not be completed' });
  });

  // Before every route, so nothing can be registered outside it by accident.
  registerOwnerGuard(app, db, config);

  /** Liveness only — answers whether the process is up, nothing about Postgres. */
  app.get('/health', async () => ({ status: 'ok' }));

  /** Readiness — a failing database means this instance cannot serve, and the
   *  reverse proxy should know that rather than routing to it. */
  app.get('/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ok', database: 'ok' };
    } catch (error) {
      app.log.error({ err: error }, 'readiness check failed');
      return reply.code(503).send({ status: 'degraded', database: 'unreachable' });
    }
  });

  registerAuthRoutes(app, db, config, github);
  registerSearchRoutes(app, tmdb);
  registerTitleRoutes(app, db, tmdb);
  registerWatchEventRoutes(app, db);

  return app;
}
