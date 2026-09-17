import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createDatabase } from './db/client.js';
import { createGithubClient } from './github/client.js';
import { createTmdbClient } from './tmdb/client.js';

const config = loadConfig();
const { db, sql: connection } = createDatabase(config.DATABASE_URL);
const tmdb = config.TMDB_API_KEY ? createTmdbClient({ apiKey: config.TMDB_API_KEY }) : null;

const github = createGithubClient({
  clientId: config.GITHUB_OAUTH_CLIENT_ID,
  clientSecret: config.GITHUB_OAUTH_CLIENT_SECRET,
});

const app = buildApp({ config, db, tmdb, github });

const shutdown = async (signal: string): Promise<void> => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await connection.end();
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ port: config.PORT, host: config.HOST });
