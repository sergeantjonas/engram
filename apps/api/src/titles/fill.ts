import type { Database } from '../db/client.js';
import type { TmdbClient } from '../tmdb/client.js';
import { backfillEpisodes } from './backfill-episodes.js';
import { backfillMetadata } from './backfill-metadata.js';

export interface FilledTitle {
  /** Art and details fetched: the title had none yet. */
  filled: boolean;
  /** What TMDB could not answer; the nightly backfill asks again. */
  failed?: string;
}

/**
 * One title's art, details and grid from TMDB, as the nightly backfills
 * would bring them, for a title another source just created — Sonarr, which
 * names a show by its ids and nothing else.
 *
 * Nothing when the title already has its details, so it is cheap to ask on
 * every event: the grid is only fetched alongside the first details. Whatever
 * fails here is left exactly as the backfills find it, so a title TMDB could
 * not answer for is asked about again on its next event, and nightly.
 */
export async function fillTitle(
  db: Database,
  tmdb: TmdbClient,
  titleId: string,
): Promise<FilledTitle> {
  const [details] = await backfillMetadata(db, tmdb, { titleId });
  if (!details) return { filled: false };
  if (details.failed) return { filled: false, failed: details.failed };

  const [grid] = await backfillEpisodes(db, tmdb, { titleId });
  return grid?.failed ? { filled: true, failed: grid.failed } : { filled: true };
}
