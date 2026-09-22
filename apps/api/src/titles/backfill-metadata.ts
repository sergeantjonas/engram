import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { titles as titleTable } from '../db/schema.js';
import { type TmdbClient, TmdbError, type TmdbTitleDetails } from '../tmdb/client.js';

export interface MetadataBackfillResult {
  name: string;
  /** What TMDB had. Null is an answer, not a failure: some titles have no poster. */
  posterPath: string | null;
  /** Null far more often than the poster, which is why the run reports both. */
  backdropPath: string | null;
  /** Set when TMDB could not answer; the row is left exactly as it was. */
  failed?: string;
}

/**
 * Fetches the metadata the Plex import never asked TMDB for.
 *
 * `import-plex-dump` writes identity and history and makes no TMDB call at all,
 * so an imported title arrives on the wall with no poster — which is the one
 * thing the wall is made of. `POST /titles` already stores poster, overview and
 * `metadata_fetched_at` off a single `details` call; this brings the imported
 * rows to that same state.
 *
 * Identity is not touched. Name, year and ids stay as imported and resolved:
 * the Plex resolution pass found ids TMDB alone does not always return, and a
 * backfill is not the place to relitigate which name is canonical.
 */
export async function backfillMetadata(
  db: Database,
  tmdb: TmdbClient,
  options: { dryRun?: boolean; refresh?: boolean } = {},
): Promise<MetadataBackfillResult[]> {
  const pending = await db
    .select({
      id: titleTable.id,
      kind: titleTable.kind,
      name: titleTable.name,
      tmdbId: titleTable.tmdbId,
    })
    .from(titleTable)
    // Keyed on `metadata_fetched_at`, not on a null poster: a title TMDB has no
    // artwork for would otherwise be asked about again on every future run.
    // `refresh` ignores the timestamp, which is how a column added after the
    // first run gets filled for rows already marked done.
    .where(
      options.refresh
        ? isNotNull(titleTable.tmdbId)
        : and(isNull(titleTable.metadataFetchedAt), isNotNull(titleTable.tmdbId)),
    )
    .orderBy(titleTable.name);

  const results: MetadataBackfillResult[] = [];

  for (const title of pending) {
    const tmdbId = title.tmdbId;
    if (!tmdbId) continue;

    let details: TmdbTitleDetails;
    try {
      // Sequential, like the episode backfill: this runs against one API key
      // shared with the live app.
      details = await tmdb.details(title.kind, tmdbId);
    } catch (error) {
      // One title TMDB cannot answer for must not abandon the other ten.
      const reason = error instanceof TmdbError ? error.message : 'TMDB lookup failed';
      results.push({ name: title.name, posterPath: null, backdropPath: null, failed: reason });
      continue;
    }

    const { posterPath, backdropPath, overview, runtimeMin } = details;
    if (!options.dryRun) {
      await db
        .update(titleTable)
        .set({
          // Null fields are left out rather than written. A refresh runs over
          // rows that already hold artwork, and TMDB answering with one field
          // missing today — a poster pulled, an overview emptied — would
          // otherwise erase what a previous run stored. The other two refresh
          // paths coalesce for the same reason; this can only ever add.
          ...(posterPath === null ? {} : { posterPath }),
          ...(backdropPath === null ? {} : { backdropPath }),
          ...(overview === null ? {} : { overview }),
          ...(runtimeMin === null ? {} : { runtimeMin }),
          // The one group written null and all: a status changes, and a next
          // episode is gone once it has aired. TMDB's answer today is the fact,
          // and a null kept from last run would say an episode is still coming.
          status: details.status,
          lastAirDate: details.lastAirDate,
          nextAirDate: details.nextEpisode?.airDate ?? null,
          nextEpisodeSeason: details.nextEpisode?.season ?? null,
          nextEpisodeNumber: details.nextEpisode?.number ?? null,
          metadataFetchedAt: new Date(),
        })
        .where(eq(titleTable.id, title.id));
    }

    results.push({ name: title.name, posterPath, backdropPath });
  }

  return results;
}
