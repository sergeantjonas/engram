import { and, eq, notInArray, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { episodes, libraryPresence, titles, watchEvents } from '../db/schema.js';
import type { LibraryPlan } from './plex-library.js';

export const SOURCE = 'plex-library';

export interface StoredLibrary {
  titles: number;
  episodes: number;
  events: number;
  /** Events this walk is the first to report, as against ones it refreshed. */
  fresh: number;
  present: number;
  /** Titles on record as present that this walk did not see. */
  gone: number;
}

/**
 * Writes a library plan: every title, episode and event it names, the
 * presence of every title it saw, and the absence of every title it did not.
 *
 * Idempotent, but not the way the history importer is. A history row never
 * changes, so re-importing one is a no-op; a library row is one claim per
 * episode carrying its most recent date, so a later walk of the same episode
 * is the same claim with newer facts and has to overwrite rather than be
 * skipped.
 *
 * One transaction, so a walk that fails partway writes nothing rather than
 * half a library. The caller refuses a truncated dump before this is reached
 * (`checkComplete`).
 */
export async function storeLibrary(
  db: Database,
  plan: LibraryPlan,
  walkedAt: Date,
): Promise<StoredLibrary> {
  return db.transaction(async (tx) => {
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
        // dump, however it arrived, lower a play count or move a date
        // backwards, which is the one thing a record of what was watched must
        // never do. `greatest` ignores nulls, so a claim that lost its date
        // does not erase one already held, and the precision is derived from
        // the same expression to keep the pair legal under
        // `watch_event_precision_date`.
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
    // A plan with nothing in it never sweeps. A truncated dump is already
    // refused, so an empty one means a genuinely empty library — and "every
    // title you have ever had is gone" is too destructive to infer from a file,
    // however well it counted itself.
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
}
