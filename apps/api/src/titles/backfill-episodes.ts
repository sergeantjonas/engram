import { and, eq, isNotNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { episodes as episodeTable, titles as titleTable } from '../db/schema.js';
import { type TmdbClient, type TmdbEpisode, TmdbError } from '../tmdb/client.js';
import { planEpisodes } from './plan.js';

export interface BackfillResult {
  name: string;
  before: number;
  added: number;
  /**
   * Rows already stored under a (season, number) TMDB did not return.
   *
   * Worth surfacing rather than ignoring: these are episodes with watch history
   * that no longer correspond to anything upstream, usually because a show was
   * renumbered or split, and nothing else in the system will ever mention them.
   */
  unmatched: number;
  /** Set when TMDB could not answer; the title is left exactly as it was. */
  failed?: string;
}

const slot = (episode: { season: number; number: number }) => `${episode.season}/${episode.number}`;

/**
 * Writes the episode rows the Plex import never created.
 *
 * The importer only writes an episode it saw played, so an imported grid holds
 * exactly the episodes with history and a gap is indistinguishable from a
 * season that ends early. This walks the same TMDB path `POST /titles` takes
 * and fills in the rest.
 *
 * Existing rows keep their identity and gain their metadata: the conflict
 * clause updates name, air date, runtime, synopsis, still and TMDB episode id
 * but never `episode.id`, so `watch_event`'s composite foreign key is untouched and no
 * history moves. That matters because the rows the importer created are exactly
 * the watched ones, and they are the only rows that arrived with no name or air
 * date at all — without this the grid could label every episode except the ones
 * actually seen.
 */
export async function backfillEpisodes(
  db: Database,
  tmdb: TmdbClient,
  options: { dryRun?: boolean } = {},
): Promise<BackfillResult[]> {
  const shows = await db
    .select({ id: titleTable.id, name: titleTable.name, tmdbId: titleTable.tmdbId })
    .from(titleTable)
    // Movies have no episodes, and a title with no TMDB id has nothing to ask
    // about — shows are keyed on tvdb, so that is not a given.
    .where(and(eq(titleTable.kind, 'show'), isNotNull(titleTable.tmdbId)))
    .orderBy(titleTable.name);

  const results: BackfillResult[] = [];

  for (const show of shows) {
    const tmdbId = show.tmdbId;
    if (!tmdbId) continue;

    const stored = await db
      .select({ season: episodeTable.season, number: episodeTable.number })
      .from(episodeTable)
      .where(eq(episodeTable.titleId, show.id));

    let seasonEpisodes: TmdbEpisode[][];
    try {
      const details = await tmdb.details('show', tmdbId);
      seasonEpisodes = [];
      // Sequential rather than in parallel: a long-running anime is twenty-odd
      // seasons, and this runs against one API key shared with the live app.
      for (const season of details.seasons) {
        seasonEpisodes.push(await tmdb.seasonEpisodes(tmdbId, season.season));
      }
    } catch (error) {
      // One title TMDB cannot answer for must not abandon the other ten.
      const reason = error instanceof TmdbError ? error.message : 'TMDB lookup failed';
      results.push({
        name: show.name,
        before: stored.length,
        added: 0,
        unmatched: 0,
        failed: reason,
      });
      continue;
    }

    const planned = planEpisodes(seasonEpisodes.flat());
    const offered = new Set(planned.map(slot));
    const unmatched = stored.filter((episode) => !offered.has(slot(episode))).length;
    // Set arithmetic rather than a second count: this is exactly what the
    // insert will add, which a "TMDB offers minus rows stored" subtraction is
    // not — a stored episode TMDB no longer lists would make that too low.
    const held = new Set(stored.map(slot));
    const added = planned.filter((episode) => !held.has(slot(episode))).length;

    if (!options.dryRun && planned.length > 0) {
      await db
        .insert(episodeTable)
        .values(planned.map((episode) => ({ ...episode, titleId: show.id })))
        .onConflictDoUpdate({
          target: [episodeTable.titleId, episodeTable.season, episodeTable.number],
          set: {
            name: sql`excluded.name`,
            airDate: sql`excluded.air_date`,
            runtimeMin: sql`excluded.runtime_min`,
            tmdbEpisodeId: sql`excluded.tmdb_episode_id`,
            overview: sql`excluded.overview`,
            stillPath: sql`excluded.still_path`,
          },
        });
    }

    results.push({ name: show.name, before: stored.length, added, unmatched });
  }

  return results;
}
