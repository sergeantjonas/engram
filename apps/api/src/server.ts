import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';

const config = loadConfig();
const { db, sql: connection } = createDatabase(config.DATABASE_URL);

const app = Fastify({ logger: { level: config.LOG_LEVEL } });

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

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await connection.end();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
