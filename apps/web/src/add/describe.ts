import { ApiError } from '../api/client.ts';

/**
 * The API's own message, except where its code names a condition the viewer
 * can act on. A missing key is the owner's to fix, and "TMDB did not answer"
 * is worth retrying; neither reads that way as a bare status.
 */
export function describe(error: unknown): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : String(error);
  if (error.status === 401) return 'Sign in to add a title.';
  if (error.code === 'search_unavailable' || error.code === 'tmdb_unavailable') {
    return 'TMDB is not configured, so nothing can be looked up or added.';
  }
  if (error.code === 'upstream_failed') return 'TMDB did not answer. Try again.';
  return error.message;
}
