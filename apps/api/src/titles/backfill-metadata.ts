import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { titles as titleTable } from '../db/schema.js';
import { type TmdbClient, TmdbError } from '../tmdb/client.js';

export interface MetadataBackfillResult {
  name: string;
  /** What TMDB had. Null is an answer, not a failure: some titles have no poster. */
  posterPath: string | null;
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
  options: { dryRun?: boolean } = {},
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
    .where(and(isNull(titleTable.metadataFetchedAt), isNotNull(titleTable.tmdbId)))
    .orderBy(titleTable.name);

  const results: MetadataBackfillResult[] = [];

  for (const title of pending) {
    const tmdbId = title.tmdbId;
    if (!tmdbId) continue;

    let posterPath: string | null;
    let overview: string | null;
    try {
      // Sequential, like the episode backfill: this runs against one API key
      // shared with the live app.
      const details = await tmdb.details(title.kind, tmdbId);
      posterPath = details.posterPath;
      overview = details.overview;
    } catch (error) {
      // One title TMDB cannot answer for must not abandon the other ten.
      const reason = error instanceof TmdbError ? error.message : 'TMDB lookup failed';
      results.push({ name: title.name, posterPath: null, failed: reason });
      continue;
    }

    if (!options.dryRun) {
      await db
        .update(titleTable)
        .set({ posterPath, overview, metadataFetchedAt: new Date() })
        .where(eq(titleTable.id, title.id));
    }

    results.push({ name: title.name, posterPath });
  }

  return results;
}
