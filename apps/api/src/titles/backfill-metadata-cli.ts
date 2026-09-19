import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { createTmdbClient } from '../tmdb/client.js';
import { backfillMetadata } from './backfill-metadata.js';

const config = loadConfig();
if (!config.TMDB_API_KEY) throw new Error('TMDB_API_KEY is required to backfill title metadata');

const dryRun = process.argv.includes('--dry-run');
const { db, sql } = createDatabase(config.DATABASE_URL);
const tmdb = createTmdbClient({ apiKey: config.TMDB_API_KEY });

const results = await backfillMetadata(db, tmdb, { dryRun });

for (const result of results) {
  // A title TMDB has no artwork for is named rather than counted: the wall will
  // draw it as a grey tile forever, and that is worth seeing once.
  const outcome = result.failed
    ? `failed: ${result.failed}`
    : (result.posterPath ?? 'no poster on TMDB');
  console.log(`  ${outcome.padEnd(36)} ${result.name}`);
}

const withPoster = results.filter((result) => !result.failed && result.posterPath).length;
const failed = results.filter((result) => result.failed).length;
console.log(
  `\n${dryRun ? 'would fetch' : 'fetched'} metadata for ${results.length - failed} titles` +
    `, ${withPoster} with a poster` +
    (failed > 0 ? `, ${failed} failed` : ''),
);

await sql.end();

// A TMDB outage must not look like a clean run to whatever called this.
if (failed > 0) process.exitCode = 1;
