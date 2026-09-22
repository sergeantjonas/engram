import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import {
  collections as collectionTable,
  collectionParts as partTable,
  titles as titleTable,
} from '../db/schema.js';
import {
  type TmdbClient,
  type TmdbCollectionPart,
  TmdbError,
  type TmdbTitleDetails,
} from '../tmdb/client.js';

export interface MetadataBackfillResult {
  name: string;
  /** What TMDB had. Null is an answer, not a failure: some titles have no poster. */
  posterPath: string | null;
  /** Null far more often than the poster, which is why the run reports both. */
  backdropPath: string | null;
  /** Set when TMDB could not answer; the row is left exactly as it was. */
  failed?: string;
  /** The film's collection and how many parts it has, when the film belongs to one. */
  collection?: { id: number; name: string; parts: number; failed?: string };
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
  // Once per collection, not per film in it: the four Thor films share one.
  const fetchedCollections = new Map<number, NonNullable<MetadataBackfillResult['collection']>>();

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

    const { posterPath, backdropPath, overview, runtimeMin, director, collection } = details;
    const cast = details.cast.length > 0 ? details.cast : null;
    if (!options.dryRun && collection !== null) {
      // Before the title, whose column points at it.
      await db
        .insert(collectionTable)
        .values({ tmdbId: collection.id, name: collection.name })
        .onConflictDoUpdate({ target: collectionTable.tmdbId, set: { name: sql`excluded.name` } });
    }
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
          ...(director === null ? {} : { director }),
          ...(cast === null ? {} : { cast }),
          ...(collection === null ? {} : { collectionId: collection.id }),
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

    const result: MetadataBackfillResult = { name: title.name, posterPath, backdropPath };
    if (collection !== null) {
      result.collection =
        fetchedCollections.get(collection.id) ??
        (await fetchCollection(db, tmdb, collection, options.dryRun ?? false));
      fetchedCollections.set(collection.id, result.collection);
    }
    results.push(result);
  }

  return results;
}

/**
 * The one call per film beyond its details: the collection's parts, so the
 * page can draw a sibling that is not on record. Refetched whenever the film
 * is, since a collection grows; a failure is reported on the film and leaves
 * the parts already stored alone.
 */
async function fetchCollection(
  db: Database,
  tmdb: TmdbClient,
  collection: { id: number; name: string },
  dryRun: boolean,
): Promise<NonNullable<MetadataBackfillResult['collection']>> {
  let parts: TmdbCollectionPart[];
  try {
    parts = (await tmdb.collection(collection.id)).parts;
  } catch (error) {
    const failed = error instanceof TmdbError ? error.message : 'TMDB lookup failed';
    return { id: collection.id, name: collection.name, parts: 0, failed };
  }

  if (!dryRun) {
    if (parts.length > 0) {
      await db
        .insert(partTable)
        .values(parts.map((part) => ({ ...part, collectionId: collection.id })))
        .onConflictDoUpdate({
          target: [partTable.collectionId, partTable.tmdbId],
          set: {
            name: sql`excluded.name`,
            year: sql`excluded.year`,
            releaseDate: sql`excluded.release_date`,
            posterPath: sql`coalesce(excluded.poster_path, ${partTable.posterPath})`,
          },
        });
    }
    await db
      .update(collectionTable)
      .set({ fetchedAt: new Date() })
      .where(eq(collectionTable.tmdbId, collection.id));
  }

  return { id: collection.id, name: collection.name, parts: parts.length };
}
