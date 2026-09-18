import { loadConfig } from '../config.js';
import { createDatabase } from '../db/client.js';
import { createTmdbClient } from '../tmdb/client.js';
import { backfillEpisodes } from './backfill-episodes.js';

const config = loadConfig();
if (!config.TMDB_API_KEY) throw new Error('TMDB_API_KEY is required to backfill episode grids');

const dryRun = process.argv.includes('--dry-run');
const { db, sql } = createDatabase(config.DATABASE_URL);
const tmdb = createTmdbClient({ apiKey: config.TMDB_API_KEY });

const results = await backfillEpisodes(db, tmdb, { dryRun });

for (const result of results) {
  const change = result.failed ? `failed: ${result.failed}` : `+${result.added}`;
  // Named rather than counted: an episode with history that TMDB no longer
  // lists is something to go and look at, not a statistic.
  const orphans = result.unmatched > 0 ? `  (${result.unmatched} not in TMDB)` : '';
  console.log(
    `  ${String(result.before).padStart(4)} -> ${change.padEnd(20)} ${result.name}${orphans}`,
  );
}

const added = results.reduce((total, result) => total + result.added, 0);
const unmatched = results.reduce((total, result) => total + result.unmatched, 0);
const failed = results.filter((result) => result.failed).length;
console.log(
  `\n${dryRun ? 'would add' : 'added'} ${added} episode rows across ${results.length} shows` +
    (unmatched > 0 ? `, ${unmatched} stored rows TMDB does not list` : '') +
    (failed > 0 ? `, ${failed} failed` : ''),
);

await sql.end();

// A TMDB outage must not look like a clean run to whatever called this.
if (failed > 0) process.exitCode = 1;
