import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { loadConfig } from '../config.js';
import { createDatabase } from './client.js';

const config = loadConfig();
const { db, sql } = createDatabase(config.DATABASE_URL);

await migrate(db, {
  migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
});
await sql.end();

console.log('migrations applied');
