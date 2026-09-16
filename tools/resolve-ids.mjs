#!/usr/bin/env node
// Resolves the Plex ratingKeys in a history dump to external ids (TMDB/TVDB/IMDb).
//
// History rows carry only Plex-internal keys, and /library/metadata resolves
// them only while the item is still in the library. What comes back as gone
// here is exactly the set that will need fuzzy title matching instead, so that
// count is the number that shapes the matching pipeline — which is why a
// transient error must never be recorded as a permanent absence.
//
//   PLEX_TOKEN=xxxxx node tools/resolve-ids.mjs [path-to-dump.json]

import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverServers, pickConnection, getJson, parseGuids } from './plex-client.mjs';

const TOKEN = process.env.PLEX_TOKEN;
if (!TOKEN) {
  console.error('PLEX_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const OUT_DIR = join(import.meta.dirname, 'out');

// Sorting filenames would order by server slug, which precedes the timestamp.
async function latestDump() {
  const names = (await readdir(OUT_DIR)).filter(
    (f) => f.startsWith('plex-history-') && f.endsWith('.json'),
  );
  if (names.length === 0) throw new Error('no history dump found in tools/out/');

  const withTimes = await Promise.all(
    names.map(async (name) => {
      const path = join(OUT_DIR, name);
      return { path, mtime: (await stat(path)).mtimeMs };
    }),
  );
  return withTimes.sort((a, b) => b.mtime - a.mtime)[0].path;
}

const dumpPath = process.argv[2] ?? (await latestDump());
const dump = JSON.parse(await readFile(dumpPath, 'utf8'));
console.log(`dump: ${dumpPath} (${dump.rows.length} rows)\n`);

// One lookup per title, not per play: the show-level guid is what anchors identity.
const targets = new Map();
for (const row of dump.rows) {
  const key = row.grandparentKey ?? row.key;
  const name = row.grandparentTitle ?? row.title;
  if (!key) continue;
  if (!targets.has(key)) targets.set(key, { key, name, type: row.type, plays: 0 });
  targets.get(key).plays++;
}
console.log(`${targets.size} distinct titles to resolve\n`);

const servers = await discoverServers(TOKEN);
if (servers.length === 0) {
  console.error('No Plex servers found on this account.');
  process.exit(1);
}

// Resolving against a different server would map these ratingKeys onto whatever
// unrelated items happen to share those ids, and report the result as success.
const server = servers.find((s) => s.clientIdentifier === dump.machineIdentifier);
if (!server) {
  console.error(
    `Dump came from machine ${dump.machineIdentifier}, which is not on this account.\n` +
      `Available: ${servers.map((s) => `${s.name} (${s.clientIdentifier})`).join(', ')}`,
  );
  process.exit(1);
}

const conn = await pickConnection(server, TOKEN);
if (!conn) {
  console.error(`${server.name} is unreachable.`);
  process.exit(1);
}
console.log(`connected to ${server.name}\n`);

const resolved = [];
const gone = [];
const errored = [];

for (const target of targets.values()) {
  try {
    const body = await getJson(`${conn.uri}${target.key}`, conn.token, 15000);
    const meta = body.MediaContainer?.Metadata?.[0];
    const ids = parseGuids(meta);
    const entry = { ...target, year: meta?.year, ids };
    if (Object.keys(ids).length > 0) {
      resolved.push(entry);
      console.log(`  ok    ${target.name} -> ${JSON.stringify(ids)}`);
    } else {
      gone.push({ ...entry, reason: 'item exists but carries no external ids' });
      console.log(`  BARE  ${target.name} (no guids)`);
    }
  } catch (err) {
    if (err.status === 404) {
      gone.push({ ...target, reason: 'gone from library' });
      console.log(`  GONE  ${target.name}`);
    } else {
      errored.push({ ...target, reason: err.message });
      console.log(`  ERROR ${target.name} (${err.status ?? err.message})`);
    }
  }
}

const playsIn = (list) => list.reduce((n, t) => n + t.plays, 0);
const report = {
  dump: dumpPath,
  resolvedAt: new Date().toISOString(),
  titles: { total: targets.size, resolved: resolved.length, gone: gone.length, errored: errored.length },
  plays: { total: dump.rows.length, resolved: playsIn(resolved), gone: playsIn(gone), errored: playsIn(errored) },
  resolved,
  gone,
  errored,
};

// Stamped, not overwritten: the record of what was resolvable before a deletion
// is itself the durable artifact.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = join(OUT_DIR, `resolved-ids-${stamp}.json`);
await writeFile(outFile, JSON.stringify(report, null, 2));

console.log(`\ntitles:  ${report.titles.resolved}/${report.titles.total} resolved`);
console.log(`plays:   ${report.plays.resolved}/${report.plays.total} covered`);
if (gone.length > 0) console.log(`gone:    ${gone.length} title(s) no longer resolvable`);
if (errored.length > 0) console.log(`errors:  ${errored.length} title(s) failed transiently — re-run`);
console.log(`wrote ${outFile}`);

process.exit(errored.length > 0 ? 1 : 0);
