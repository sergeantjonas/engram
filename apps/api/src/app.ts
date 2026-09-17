import { sql } from 'drizzle-orm';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Database } from './db/client.js';
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
}

/**
 * Assembles the app from its dependencies rather than reaching for module-scope
 * singletons, so a test can hand it a stub and drive routes through
 * `app.inject()` without a database, a network or an open port.
 */
export function buildApp({ config, db, tmdb }: AppDeps): FastifyInstance {
  const app = Fastify({ logger: { level: config.LOG_LEVEL } });

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

  registerSearchRoutes(app, tmdb);
  registerTitleRoutes(app, db, tmdb);
  registerWatchEventRoutes(app, db);

  return app;
}
