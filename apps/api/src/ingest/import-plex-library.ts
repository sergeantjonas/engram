#!/usr/bin/env node
// Imports a Plex library dump into the database.
//
// Idempotent, but not the way the history importer is. A history row never
// changes, so re-importing one is a no-op; a library row is one claim per
// episode carrying its most recent date, so a later walk of the same episode
// is the same claim with newer facts and has to overwrite rather than be
// skipped.
//
//   node dist/ingest/import-plex-library.js [dump.json]

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { loadDatabaseUrl } from '../config.js';
import { createDatabase } from '../db/client.js';
import { episodes, libraryPresence, titles, watchEvents } from '../db/schema.js';
import { type PlexLibrarySection, planLibrary } from './plex-library.js';

const SOURCE = 'plex-library';
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
  summary?: { items?: number };
  sections: PlexLibrarySection[];
};

const plan = planLibrary(dump.sections);

// The sweep below reads absence as removal, so it is only safe over a dump
// that is the whole library. The dump counts its own items as it writes them;
// if the plan does not account for every one, this file is truncated and
// importing it would mark whatever is missing as gone from disk.
const counted = dump.summary?.items;
const placed = plan.presence.length + plan.dropped.length;
if (counted !== undefined && counted !== placed) {
  throw new Error(
    `dump is short: it counted ${counted} item(s), this plan accounts for ${placed}.\n` +
      'Re-run dump:library rather than importing a partial library.',
  );
}

console.log(`dump: ${dumpPath}`);
if (dump.server) console.log(`from: ${dump.server}`);
console.log(
  `plan: ${plan.titles.length} title(s), ${plan.episodes.length} episode(s), ` +
    `${plan.events.length} event(s)\n`,
);

const { db, sql: connection } = createDatabase(loadDatabaseUrl());
const walkedAt = new Date();

const written = await db.transaction(async (tx) => {
  const titleIds = new Map<string, string>();

  for (const title of plan.titles) {
    // Metadata is refreshed, identity is not: `key` is what the row is.
    const [row] = await tx
      .insert(titles)
      .values({
        key: title.key,
        kind: title.kind,
        tmdbId: title.ids.tmdb ?? null,
        tvdbId: title.ids.tvdb ?? null,
        imdbId: title.ids.imdb ?? null,
        name: title.name,
        year: title.year,
      })
      .onConflictDoUpdate({
        target: titles.key,
        set: {
          name: title.name,
          year: sql`coalesce(excluded.year, ${titles.year})`,
          tmdbId: sql`coalesce(excluded.tmdb_id, ${titles.tmdbId})`,
          tvdbId: sql`coalesce(excluded.tvdb_id, ${titles.tvdbId})`,
          imdbId: sql`coalesce(excluded.imdb_id, ${titles.imdbId})`,
        },
      })
      .returning({ id: titles.id });
    if (row) titleIds.set(title.key, row.id);
  }

  const episodeIds = new Map<string, string>();

  for (const episode of plan.episodes) {
    const titleId = titleIds.get(episode.titleKey);
    if (!titleId) throw new Error(`no id for planned title ${episode.titleKey}`);

    await tx
      .insert(episodes)
      .values({ titleId, season: episode.season, number: episode.number, name: episode.name })
      .onConflictDoNothing();

    const [row] = await tx
      .select({ id: episodes.id })
      .from(episodes)
      .where(
        and(
          eq(episodes.titleId, titleId),
          eq(episodes.season, episode.season),
          eq(episodes.number, episode.number),
        ),
      );
    if (row) episodeIds.set(`${episode.titleKey}/${episode.season}/${episode.number}`, row.id);
  }

  // Counted before writing, because an upsert returns its row whether it
  // inserted or updated and the two are worth telling apart in the report.
  const already = new Set(
    (
      await tx
        .select({ id: watchEvents.sourceEventId })
        .from(watchEvents)
        .where(eq(watchEvents.source, SOURCE))
    ).map((r) => r.id),
  );

  let fresh = 0;
  for (const event of plan.events) {
    const titleId = titleIds.get(event.titleKey);
    if (!titleId) throw new Error(`no id for planned title ${event.titleKey}`);

    let episodeId: string | null = null;
    if (event.season !== null && event.number !== null) {
      const slot = `${event.titleKey}/${event.season}/${event.number}`;
      // Falling back to null here would silently downgrade an episode play to a
      // title-level one, which watch_state then reports beside real episodes.
      episodeId = episodeIds.get(slot) ?? null;
      if (!episodeId) throw new Error(`no id for planned episode ${slot}`);
    }

    await tx
      .insert(watchEvents)
      .values({
        source: SOURCE,
        sourceEventId: event.sourceEventId,
        titleId,
        episodeId,
        watchedAt: event.watchedAt,
        watchedPrecision: event.watchedPrecision,
        plays: event.plays,
        // An item only carries watched state once Plex has judged it watched;
        // there is no partial progress to read here the way a webhook has.
        completed: true,
        // The walk sees the calling token's own view of the library and has no
        // per-item account to record. Whose view it is belongs to the run.
        accountId: null,
        raw: event.raw,
      })
      // Merged, not replaced. Taking `excluded` wholesale would let an older
      // dump — a path argument, or an older file the mtime scan preferred —
      // lower a play count or move a date backwards, which is the one thing a
      // record of what was watched must never do. `greatest` ignores nulls, so
      // a claim that lost its date does not erase one already held, and the
      // precision is derived from the same expression to keep the pair legal
      // under `watch_event_precision_date`.
      .onConflictDoUpdate({
        target: [watchEvents.source, watchEvents.sourceEventId],
        set: {
          watchedAt: sql`greatest(excluded.watched_at, ${watchEvents.watchedAt})`,
          watchedPrecision: sql`case
            when greatest(excluded.watched_at, ${watchEvents.watchedAt}) is null
            then 'unknown'::watch_precision else 'exact'::watch_precision end`,
          plays: sql`greatest(excluded.plays, ${watchEvents.plays})`,
          raw: sql`excluded.raw`,
        },
      });

    if (!already.has(event.sourceEventId)) fresh++;
  }

  const seen: string[] = [];
  for (const key of plan.presence) {
    const titleId = titleIds.get(key);
    if (!titleId) throw new Error(`no id for planned title ${key}`);
    seen.push(titleId);

    await tx
      .insert(libraryPresence)
      .values({ titleId, present: true, firstSeenAt: walkedAt, source: SOURCE })
      .onConflictDoUpdate({
        target: libraryPresence.titleId,
        // `first_seen_at` is not touched: it is the first time, not the last.
        // Neither is `source` — taking ownership of a row Sonarr wrote would
        // hand its removals to the sweep below, which only knows what Plex
        // can see.
        set: { present: true, removedAt: null },
      });
  }

  // A walk sees the whole library, so absence is a fact rather than silence —
  // this is the half a webhook cannot do. Scoped to rows this walk owns, so a
  // future Sonarr or Radarr row is not overwritten by what Plex cannot see.
  //
  // A plan with nothing in it never sweeps. The cross-check above already
  // refuses a truncated dump, so an empty one means a genuinely empty library
  // — and "every title you have ever had is gone" is too destructive to infer
  // from a file, however well it counted itself.
  const gone =
    seen.length === 0
      ? []
      : await tx
          .update(libraryPresence)
          .set({ present: false, removedAt: walkedAt })
          .where(
            and(
              eq(libraryPresence.source, SOURCE),
              eq(libraryPresence.present, true),
              notInArray(libraryPresence.titleId, seen),
            ),
          )
          .returning({ id: libraryPresence.titleId });

  return {
    titles: titleIds.size,
    episodes: episodeIds.size,
    events: plan.events.length,
    fresh,
    present: seen.length,
    gone: gone.length,
  };
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
