#!/usr/bin/env node
// Archives what Plex's library knows to disk: every item in every section, and
// for each watched show, every watched episode under it.
//
// This is the deeper record. The history endpoint is a server-local log that
// starts when the server was built; per-item watched state is account data and
// syncs through plex.tv, so it survives a rebuild the log does not. On this
// server the log reaches 2025-10-24 and the library reaches 2019-06-11.
//
//   PLEX_TOKEN=xxxxx node tools/dump-library.mjs [--server "Name"]

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  discoverServers,
  fetchSectionItems,
  fetchSections,
  fetchShowLeaves,
  pickConnection,
} from './plex-client.mjs';

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

const watched = (item) => (item.viewCount ?? 0) > 0 || (item.viewedLeafCount ?? 0) > 0;

function summarise(sections) {
  let items = 0;
  let watchedItems = 0;
  let episodes = 0;
  let undatedFilms = 0;
  let undatedEpisodes = 0;
  let emptyWatchedShows = 0;
  let min = Infinity;
  let max = -Infinity;

  const at = (t) => {
    if (typeof t !== 'number') return;
    min = Math.min(min, t);
    max = Math.max(max, t);
  };

  for (const section of sections) {
    for (const item of section.items) {
      items++;
      if (!watched(item)) continue;
      watchedItems++;
      if (section.type === 'movie') {
        if (typeof item.lastViewedAt === 'number') at(item.lastViewedAt);
        else undatedFilms++;
        continue;
      }
      // A show Plex counts as watched that yielded no watched episode is the
      // one shape this file can take that reads as success and is not: the
      // totals stay plausible while a whole show's viewing is missing.
      if ((item.episodes ?? []).length === 0) emptyWatchedShows++;
      for (const ep of item.episodes ?? []) {
        episodes++;
        if (typeof ep.lastViewedAt === 'number') at(ep.lastViewedAt);
        else undatedEpisodes++;
      }
    }
  }

  const day = (t) => (Number.isFinite(t) ? new Date(t * 1000).toISOString().slice(0, 10) : 'n/a');
  return {
    sections: sections.length,
    items,
    watchedItems,
    watchedEpisodes: episodes,
    emptyWatchedShows,
    undatedFilms,
    undatedEpisodes,
    earliest: day(min),
    latest: day(max),
  };
}

async function walkSection(conn, section) {
  const items = await fetchSectionItems(conn.uri, conn.token, section.key);
  process.stdout.write(`\r  ${section.title}: ${items.length} item(s)`);

  // Only the shows with something watched need their episodes: the rest
  // contribute presence, which the section listing already carries.
  const shows = section.type === 'show' ? items.filter(watched) : [];
  let done = 0;
  for (const show of shows) {
    const leaves = await fetchShowLeaves(conn.uri, conn.token, show.ratingKey);
    // An unwatched episode says nothing the show row has not already said, and
    // library_presence is keyed to the title rather than the episode.
    show.episodes = leaves.filter((ep) => (ep.viewCount ?? 0) > 0);
    done++;
    process.stdout.write(
      `\r  ${section.title}: ${items.length} item(s), episodes for ${done}/${shows.length} watched show(s)`,
    );
  }
  process.stdout.write('\n');

  return { key: section.key, type: section.type, title: section.title, items };
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
    console.error(
      `  unreachable on all ${server.connections?.length ?? 0} connection(s) — server may be down\n`,
    );
    failures++;
    continue;
  }
  console.log(`  connected via ${conn.uri}${conn.relay ? ' (relay)' : ''}`);

  try {
    const all = await fetchSections(conn.uri, conn.token);
    const wanted = all.filter((s) => s.type === 'show' || s.type === 'movie');
    // A server with no such section is a malformed response, not an empty
    // library. Writing the zeroes would report success over a failed read.
    if (wanted.length === 0) {
      throw new Error(`no show or film sections among the ${all.length} returned`);
    }
    console.log(`  ${wanted.length} of ${all.length} section(s) hold shows or films`);

    const sections = [];
    for (const section of wanted) {
      sections.push(await walkSection(conn, section));
    }

    const summary = summarise(sections);
    const slug = server.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const file = join(OUT_DIR, `plex-library-${slug}-${stamp}.json`);

    await writeFile(
      file,
      JSON.stringify(
        {
          server: server.name,
          machineIdentifier: server.clientIdentifier,
          dumpedAt: new Date().toISOString(),
          summary,
          sections,
        },
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
