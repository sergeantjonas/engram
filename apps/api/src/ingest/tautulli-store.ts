import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { episodes, titles, watchEvents } from '../db/schema.js';
import type { PlannedRows } from './tautulli.js';

/**
 * Written once, because `watch_state` names this string in its own SQL: the
 * play-grained count is `source in ('plex-history', 'tautulli')`. A typo here
 * would store the row and leave it out of every figure, silently.
 */
export const SOURCE = 'tautulli';

export interface StoredPlay {
  /** False when this exact play was already on record. */
  written: boolean;
  titleId: string;
  episodeId: string | null;
}

/**
 * Writes what one play implies: the title if it is new, the episode if it is
 * new, and the play itself.
 *
 * All three in one transaction. A title written without its event would leave
 * a row the record cannot explain, and the composite foreign key on
 * `(title_id, episode_id)` means a half-applied write is not merely untidy but
 * rejected.
 */
export async function storeTautulliPlay(db: Database, plan: PlannedRows): Promise<StoredPlay> {
  return db.transaction(async (tx) => {
    const [titleRow] = await tx
      .insert(titles)
      .values({
        key: plan.title.key,
        kind: plan.title.kind,
        tmdbId: plan.title.ids.tmdb ?? null,
        tvdbId: plan.title.ids.tvdb ?? null,
        imdbId: plan.title.ids.imdb ?? null,
        name: plan.title.name,
        year: plan.title.year,
      })
      // Gaps filled, nothing overwritten — the opposite of the library walk,
      // which refreshes metadata because it reads the whole item. A webhook
      // reports a play and carries whatever Plex happened to attach to it, so
      // letting it win would have a play re-title a series that TMDB had
      // already described properly.
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
    if (!titleRow) throw new Error(`no id for title ${plan.title.key}`);

    let episodeId: string | null = null;
    if (plan.episode !== null) {
      const { season, number } = plan.episode;
      await tx
        .insert(episodes)
        .values({ titleId: titleRow.id, season, number, name: plan.episode.name })
        .onConflictDoNothing();

      const [episodeRow] = await tx
        .select({ id: episodes.id })
        .from(episodes)
        .where(
          and(
            eq(episodes.titleId, titleRow.id),
            eq(episodes.season, season),
            eq(episodes.number, number),
          ),
        );
      // Falling back to null would downgrade an episode play to a title-level
      // one, which watch_state then reports beside real episodes.
      if (!episodeRow) throw new Error(`no id for episode ${plan.title.key} s${season}e${number}`);
      episodeId = episodeRow.id;
    }

    const written = await tx
      .insert(watchEvents)
      .values({
        source: SOURCE,
        sourceEventId: plan.play.sourceEventId,
        titleId: titleRow.id,
        episodeId,
        watchedAt: plan.play.watchedAt,
        watchedPrecision: plan.play.watchedPrecision,
        // Null, not one. This source enumerates plays, so watch_state counts
        // its rows; a count here as well would be the same viewing twice.
        plays: null,
        completed: plan.play.completed,
        durationSec: plan.play.durationSec,
        viewOffsetSec: plan.play.viewOffsetSec,
        percentComplete: plan.play.percentComplete,
        accountId: plan.play.accountId,
        player: plan.play.player,
        platform: plan.play.platform,
        raw: plan.play.raw,
      })
      // Nothing, not an update: the id carries the instant, so a row that
      // conflicts is the same stop arriving twice and has nothing new to say.
      .onConflictDoNothing()
      .returning({ id: watchEvents.id });

    return { written: written.length > 0, titleId: titleRow.id, episodeId };
  });
}
