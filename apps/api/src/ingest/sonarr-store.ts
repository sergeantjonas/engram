import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { episodes, libraryEvents, libraryPresence, titles } from '../db/schema.js';
import type { PlannedSeries, SonarrPlan } from './sonarr.js';

/** The `source` of every row this writes, in `library_event` and `library_presence` alike. */
export const SOURCE = 'sonarr';

/** A plan that writes something: neither refused nor a body with nothing in it. */
export type StorableSonarrPlan = Exclude<SonarrPlan, { ok: false } | { action: 'none' }>;

export interface StoredSonarr {
  /** Null when a series delete named a title the record never had. */
  titleId: string | null;
  /** Events new to the record. */
  written: number;
  /** Events already on record: the same delivery arriving twice. */
  skipped: number;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * The show's row, created if Sonarr is the first to name it.
 *
 * Gaps filled and nothing overwritten, as for a Tautulli play: Sonarr's name
 * for a series is TVDB's, and letting it win would re-title a show the TMDB
 * backfill had already described.
 */
async function upsertTitle(tx: Tx, series: PlannedSeries): Promise<string> {
  const [row] = await tx
    .insert(titles)
    .values({
      key: series.key,
      kind: series.kind,
      tmdbId: series.ids.tmdb ?? null,
      tvdbId: series.ids.tvdb ?? null,
      imdbId: series.ids.imdb ?? null,
      name: series.name,
      year: series.year,
    })
    .onConflictDoUpdate({
      target: titles.key,
      set: {
        year: sql`coalesce(${titles.year}, excluded.year)`,
        tmdbId: sql`coalesce(${titles.tmdbId}, excluded.tmdb_id)`,
        tvdbId: sql`coalesce(${titles.tvdbId}, excluded.tvdb_id)`,
        imdbId: sql`coalesce(${titles.imdbId}, excluded.imdb_id)`,
      },
    })
    .returning({ id: titles.id });
  if (!row) throw new Error(`no id for title ${series.key}`);
  return row.id;
}

/**
 * The title is on disk, as an import just showed.
 *
 * `source` is set only on a row this creates, the rule the library walk keeps
 * from its side: whoever wrote a row first owns its removals, and the walk's
 * sweep only clears rows that are its own.
 */
async function markPresent(tx: Tx, titleId: string): Promise<void> {
  await tx
    .insert(libraryPresence)
    .values({ titleId, present: true, firstSeenAt: sql`now()`, source: SOURCE })
    .onConflictDoUpdate({
      target: libraryPresence.titleId,
      set: { present: true, removedAt: null },
    });
}

/**
 * The title has left the disk. An update and never an insert: a row created
 * only to say "gone" would be Sonarr's, and the walk, seeing the show again,
 * would mark it present without being able to sweep it later.
 */
async function markGone(tx: Tx, titleId: string): Promise<void> {
  await tx
    .update(libraryPresence)
    .set({ present: false, removedAt: sql`now()` })
    .where(eq(libraryPresence.titleId, titleId));
}

/**
 * Writes what one Sonarr webhook implies.
 *
 * A series added is a title. A grab, an import or a delete is the title, each
 * episode it names — created when the backfill has not reached it yet — and
 * one `library_event` per episode, all in one transaction, since the composite
 * key on `(title_id, episode_id)` rejects an event whose episode is not
 * there. An import marks the title present; a series deleted with its files
 * marks it gone.
 */
export async function storeSonarrPlan(
  db: Database,
  plan: StorableSonarrPlan,
): Promise<StoredSonarr> {
  if (plan.action === 'series-add') {
    const titleId = await db.transaction((tx) => upsertTitle(tx, plan.series));
    return { titleId, written: 0, skipped: 0 };
  }

  if (plan.action === 'series-delete') {
    return db.transaction(async (tx) => {
      // Looked up rather than upserted: a show the record never had is not
      // created just to be marked gone.
      const [row] = await tx
        .select({ id: titles.id })
        .from(titles)
        .where(eq(titles.key, plan.series.key));
      if (!row) return { titleId: null, written: 0, skipped: 0 };
      // Files kept means Sonarr stopped watching the show, not that it left
      // the disk; the walk will say when it does.
      if (plan.filesDeleted) await markGone(tx, row.id);
      return { titleId: row.id, written: 0, skipped: 0 };
    });
  }

  return db.transaction(async (tx) => {
    const titleId = await upsertTitle(tx, plan.series);
    let written = 0;

    for (const event of plan.events) {
      const { season, number, name, airDate } = event.episode;
      await tx
        .insert(episodes)
        .values({ titleId, season, number, name, airDate })
        .onConflictDoNothing();
      const [episodeRow] = await tx
        .select({ id: episodes.id })
        .from(episodes)
        .where(
          and(
            eq(episodes.titleId, titleId),
            eq(episodes.season, season),
            eq(episodes.number, number),
          ),
        );
      if (!episodeRow) throw new Error(`no id for episode ${plan.series.key} s${season}e${number}`);

      const inserted = await tx
        .insert(libraryEvents)
        .values({
          source: SOURCE,
          sourceEventId: event.sourceEventId,
          kind: event.kind,
          titleId,
          episodeId: episodeRow.id,
          raw: event.raw,
        })
        // Nothing, not an update: the id names the download or the file, so a
        // conflict is the same delivery again with nothing new to say.
        .onConflictDoNothing()
        .returning({ id: libraryEvents.id });
      written += inserted.length;
    }

    if (plan.kind === 'import') await markPresent(tx, titleId);
    return { titleId, written, skipped: plan.events.length - written };
  });
}
