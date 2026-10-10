#!/usr/bin/env node
// Imports a Plex library dump into the database. What it writes, and why a
// re-run overwrites rather than skips, is `storeLibrary`'s.
//
//   node dist/ingest/import-plex-library.js [dump.json]

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { loadDatabaseUrl } from '../config.js';
import { createDatabase } from '../db/client.js';
import { titles, watchEvents } from '../db/schema.js';
import { SOURCE, storeLibrary } from './library-store.js';
import { checkComplete, type PlexLibrarySection, planLibrary } from './plex-library.js';

const TOOLS_OUT = new URL('../../../../tools/out/', import.meta.url);

async function newestMatching(prefix: string): Promise<string> {
  const dir = fileURLToPath(TOOLS_OUT);
  const names = (await readdir(dir)).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
  if (names.length === 0) throw new Error(`no ${prefix}*.json in tools/out/`);

  const timed = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      return { path, mtime: (await stat(path)).mtimeMs };
    }),
  );
  return timed.sort((a, b) => b.mtime - a.mtime)[0]?.path as string;
}

const dumpPath = process.argv[2] ?? (await newestMatching('plex-library-'));
const dump = JSON.parse(await readFile(dumpPath, 'utf8')) as {
  server?: string;
  summary?: { items?: number; leaves?: number };
  sections: PlexLibrarySection[];
};

const plan = planLibrary(dump.sections);

const complete = checkComplete(dump.summary, plan);
if (!complete.ok) {
  throw new Error(
    `${complete.reason}.\nRe-run dump:library rather than importing a partial library.`,
  );
}

console.log(`dump: ${dumpPath}`);
if (dump.server) console.log(`from: ${dump.server}`);
console.log(
  `plan: ${plan.titles.length} title(s), ${plan.episodes.length} episode(s), ` +
    `${plan.events.length} event(s)\n`,
);

const { db, sql: connection } = createDatabase(loadDatabaseUrl());
const written = await storeLibrary(db, plan, new Date(), {
  episodesCounted: complete.episodesCounted,
});

const [counts] = await db
  .select({
    titles: sql<number>`(select count(*)::int from ${titles})`,
    events: sql<number>`(select count(*)::int from ${watchEvents})`,
    walked: sql<number>`(select count(*)::int from ${watchEvents} where source = ${SOURCE})`,
  })
  .from(sql`(select 1) as _`);

console.log(`titles:   ${written.titles} planned, ${counts?.titles ?? 0} in database`);
console.log(`episodes: ${written.episodes} known`);
console.log(
  `events:   ${written.fresh} new of ${written.events} planned, ` +
    `${counts?.walked ?? 0} from this walk, ${counts?.events ?? 0} in database`,
);
console.log(
  `presence: ${written.present} present${written.gone > 0 ? `, ${written.gone} gone` : ''}`,
);
console.log(
  written.episodesOnDisk === null
    ? 'on disk:  left alone, the dump did not count its episodes'
    : `on disk:  ${written.episodesOnDisk} episode(s), ${written.episodesGone} gone`,
);

if (plan.incomplete.length > 0) {
  console.error(
    `\n${plan.incomplete.length} show(s) carry fewer watched episodes than they claim:`,
  );
  for (const row of plan.incomplete) {
    console.error(`  ${`${row.found} of ${row.expected}`.padEnd(38)} ${row.name}`);
  }
  console.error('Re-run dump:library — what was written for these is short.');
  process.exitCode = 1;
}

if (plan.dropped.length > 0) {
  console.error(`\n${plan.dropped.length} item(s) could not be imported:`);
  for (const row of plan.dropped) {
    console.error(`  ${row.reason.padEnd(38)} ${row.name}`);
  }
  process.exitCode = 1;
}

await connection.end();
