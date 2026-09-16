#!/usr/bin/env node
// Archives Plex watch history to disk. History rows outlive the media they
// point at, but only as dangling references, so this captures them while the
// titles and indices are still intact.
//
//   PLEX_TOKEN=xxxxx node tools/dump-plex-history.mjs [--server "Name"]

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { discoverServers, pickConnection, fetchAllHistory } from './plex-client.mjs';

const TOKEN = process.env.PLEX_TOKEN;
if (!TOKEN) {
  console.error('PLEX_TOKEN is not set. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const wantServer = (() => {
  const i = process.argv.indexOf('--server');
  if (i === -1) return null;
  const name = process.argv[i + 1];
  if (!name) {
    console.error('--server needs a server name.');
    process.exit(1);
  }
  return name;
})();

const OUT_DIR = join(import.meta.dirname, 'out');

function summarise(rows) {
  const byType = {};
  const byAccount = {};
  const shows = new Set();
  const movies = new Set();
  let min = Infinity;
  let max = -Infinity;

  for (const r of rows) {
    byType[r.type ?? 'unknown'] = (byType[r.type ?? 'unknown'] ?? 0) + 1;
    const acct = String(r.accountID ?? 'unknown');
    byAccount[acct] = (byAccount[acct] ?? 0) + 1;
    if (r.type === 'episode' && r.grandparentTitle) shows.add(r.grandparentTitle);
    if (r.type === 'movie' && r.title) movies.add(r.title);
    if (typeof r.viewedAt === 'number') {
      min = Math.min(min, r.viewedAt);
      max = Math.max(max, r.viewedAt);
    }
  }

  const day = (t) => (Number.isFinite(t) ? new Date(t * 1000).toISOString().slice(0, 10) : 'n/a');
  return {
    total: rows.length,
    byType,
    byAccount,
    distinctShows: shows.size,
    distinctMovies: movies.size,
    earliest: day(min),
    latest: day(max),
  };
}

const servers = await discoverServers(TOKEN);
if (servers.length === 0) {
  console.error('No Plex servers found on this account.');
  process.exit(1);
}

console.log(`Found ${servers.length} server(s): ${servers.map((s) => s.name).join(', ')}\n`);
await mkdir(OUT_DIR, { recursive: true });

const targets = wantServer ? servers.filter((s) => s.name === wantServer) : servers;
if (targets.length === 0) {
  console.error(`No server named "${wantServer}".`);
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let failures = 0;

for (const server of targets) {
  console.log(`${server.name}:`);
  const conn = await pickConnection(server, TOKEN);
  if (!conn) {
    console.error(`  unreachable on all ${server.connections?.length ?? 0} connection(s) — server may be down\n`);
    failures++;
    continue;
  }
  console.log(`  connected via ${conn.uri}${conn.relay ? ' (relay)' : ''}`);

  try {
    const rows = await fetchAllHistory(conn.uri, conn.token, {
      onProgress: (p) =>
        p.phase === 'total'
          ? console.log(`  server reports ${p.total ?? 'an unknown number of'} history entries`)
          : process.stdout.write(`\r  fetched ${p.fetched}${p.total === null ? '' : `/${p.total}`}`),
    });
    process.stdout.write('\n');
    const summary = summarise(rows);
    const slug = server.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const file = join(OUT_DIR, `plex-history-${slug}-${stamp}.json`);

    await writeFile(
      file,
      JSON.stringify(
        { server: server.name, machineIdentifier: server.clientIdentifier, dumpedAt: new Date().toISOString(), summary, rows },
        null,
        2,
      ),
    );

    console.log(`  wrote ${file}`);
    console.log(`  ${JSON.stringify(summary, null, 2).replace(/\n/g, '\n  ')}\n`);
  } catch (err) {
    console.error(`  failed: ${err.message}\n`);
    failures++;
  }
}

if (failures > 0) {
  console.error(`${failures} of ${targets.length} server(s) failed.`);
  process.exit(1);
}
