#!/usr/bin/env node
// Imports a Plex history dump into the database.
//
// Idempotent: re-running converges rather than duplicating, because every event
// carries its Plex historyKey as source_event_id.
//
//   node dist/ingest/import-plex-dump.js [dump.json] [resolved.json]

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, sql } from 'drizzle-orm';
import { loadDatabaseUrl } from '../config.js';
import { createDatabase } from '../db/client.js';
import { episodes, titles, watchEvents } from '../db/schema.js';
import { type PlexHistoryRow, planImport, type ResolvedTitle } from './plex-dump.js';

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

const dumpPath = process.argv[2] ?? (await newestMatching('plex-history-'));
const reportPath = process.argv[3] ?? (await newestMatching('resolved-ids-'));

const dump = JSON.parse(await readFile(dumpPath, 'utf8')) as { rows: PlexHistoryRow[] };
const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
  dump?: string;
  resolved: ResolvedTitle[];
};

if (report.dump && report.dump !== dumpPath) {
  throw new Error(
    `report was built from a different dump:\n  report: ${report.dump}\n  dump:   ${dumpPath}\n` +
      'Re-run resolve:ids against this dump before importing.',
  );
}

console.log(`dump:   ${dumpPath} (${dump.rows.length} rows)`);
console.log(`report: ${reportPath} (${report.resolved.length} titles)\n`);

const plan = planImport(dump.rows, report.resolved);

const { db, sql: connection } = createDatabase(loadDatabaseUrl());

const inserted = await db.transaction(async (tx) => {
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

  let events = 0;
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

    const result = await tx
      .insert(watchEvents)
      .values({
        source: 'plex-history',
        sourceEventId: event.sourceEventId,
        titleId,
        episodeId,
        watchedAt: event.watchedAt,
        watchedPrecision: event.watchedPrecision,
        // Plex history rows carry no progress fields at all: a row exists only
        // because Plex already decided the item was watched.
        completed: true,
        accountId: event.accountId,
        raw: event.raw,
      })
      .onConflictDoNothing()
      .returning({ id: watchEvents.id });

    events += result.length;
  }

  return { titles: titleIds.size, episodes: episodeIds.size, events };
});

const [counts] = await db
  .select({
    titles: sql<number>`(select count(*)::int from ${titles})`,
    events: sql<number>`(select count(*)::int from ${watchEvents})`,
  })
  .from(sql`(select 1) as _`);

console.log(`titles:   ${inserted.titles} planned, ${counts?.titles ?? 0} in database`);
console.log(`episodes: ${inserted.episodes} known`);
console.log(
  `events:   ${inserted.events} new of ${plan.events.length} planned, ${counts?.events ?? 0} in database`,
);

if (plan.degraded > 0) {
  console.log(`\n${plan.degraded} play(s) recorded against the show, with no episode number.`);
}

if (plan.dropped.length > 0) {
  console.error(`\n${plan.dropped.length} row(s) could not be imported:`);
  for (const row of plan.dropped) {
    console.error(`  ${row.reason.padEnd(32)} ${row.name}`);
  }
  process.exitCode = 1;
}

await connection.end();
