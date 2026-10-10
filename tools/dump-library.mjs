#!/usr/bin/env node
// Archives what Plex's library knows to disk: every item in every section, and
// every episode under every show, watched or not.
//
// This is the deeper record. The history endpoint is a server-local log that
// starts when the server was built; per-item watched state is account data and
// syncs through plex.tv, so it survives a rebuild the log does not. On this
// server the log reaches 2025-10-24 and the library reaches 2019-06-11.
//
//   PLEX_TOKEN=xxxxx node tools/dump-library.mjs [--server "Name"]
//
// With ENGRAM_INGEST_URL, INGEST_SECRET and PLEX_SERVER_ID set, the walk of
// that one server is posted to Engram instead of written to tools/out/. That
// is the nightly run on the Bytesized slot.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ingestTarget, postWalk } from './ingest-client.mjs';
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

const target = ingestTarget(process.env);
if (target && !target.ok) {
  console.error(`${target.reason}.`);
  process.exit(1);
}
if (target && wantServer) {
  console.error('--server names a server by name; a posted walk is of PLEX_SERVER_ID alone.');
  process.exit(1);
}

// Redrawn in place in a terminal. In the slot's journal every redraw would be
// a line of its own, one per show.
const progress = process.stdout.isTTY ? (line) => process.stdout.write(`\r${line}`) : () => {};

const watched = (item) => (item.viewCount ?? 0) > 0 || (item.viewedLeafCount ?? 0) > 0;

function summarise(sections) {
  let items = 0;
  let watchedItems = 0;
  let leaves = 0;
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
      leaves += (item.episodes ?? []).length;
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
      const seen = (item.episodes ?? []).filter((ep) => (ep.viewCount ?? 0) > 0);
      if (seen.length === 0) emptyWatchedShows++;
      for (const ep of seen) {
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
    // Every episode under every show. Engram holds a walk to it, and only a
    // walk that counted it may rewrite its record of what is on disk.
    leaves,
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
  progress(`  ${section.title}: ${items.length} item(s)`);

  // Every show's episodes, unwatched ones and unstarted shows included: Engram
  // keeps the whole list as its record of what is on disk, which is how it
  // tells an episode that never arrived from one whose Sonarr webhook was
  // missed. One request per show.
  const shows = section.type === 'show' ? items : [];
  let done = 0;
  for (const show of shows) {
    show.episodes = await fetchShowLeaves(conn.uri, conn.token, show.ratingKey);
    done++;
    progress(`  ${section.title}: ${items.length} item(s), episodes for ${done}/${shows.length}`);
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  else console.log(`  ${section.title}: ${items.length} item(s), ${shows.length} show(s)`);

  return { key: section.key, type: section.type, title: section.title, items };
}

const servers = await discoverServers(TOKEN);
if (servers.length === 0) {
  console.error('No Plex servers found on this account.');
  process.exit(1);
}

console.log(`Found ${servers.length} server(s): ${servers.map((s) => s.name).join(', ')}\n`);
if (!target) await mkdir(OUT_DIR, { recursive: true });

// By identifier when posting: a name can be shared or changed, and the API
// refuses any walk but its own server's anyway.
const targets = target
  ? servers.filter((s) => s.clientIdentifier === target.server)
  : wantServer
    ? servers.filter((s) => s.name === wantServer)
    : servers;
if (targets.length === 0) {
  console.error(
    target
      ? 'No server on this account has that PLEX_SERVER_ID.'
      : `No server named "${wantServer}".`,
  );
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
let failures = 0;

for (const server of targets) {
  console.log(`${server.name}:`);
  const conn = await pickConnection(server, TOKEN, { plaintext: !target });
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
    const dump = {
      server: server.name,
      machineIdentifier: server.clientIdentifier,
      dumpedAt: new Date().toISOString(),
      summary,
      sections,
    };

    if (target) {
      const stored = await postWalk(target, dump);
      const { dropped = [], incomplete = [], ...counts } = stored ?? {};
      console.log(`  posted to ${new URL(target.url).host}: ${JSON.stringify(counts)}`);
      // Written, but short: the same two reports import:library makes, and
      // they fail the run so the timer's status says so.
      for (const row of incomplete) {
        console.error(`  incomplete: ${row.found} of ${row.expected} — ${row.name}`);
      }
      for (const row of dropped) console.error(`  dropped: ${row.reason} — ${row.name}`);
      if (dropped.length > 0 || incomplete.length > 0) process.exitCode = 1;
    } else {
      const slug = server.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      const file = join(OUT_DIR, `plex-library-${slug}-${stamp}.json`);
      await writeFile(file, JSON.stringify(dump, null, 2));
      console.log(`  wrote ${file}`);
    }
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
