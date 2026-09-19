import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from './client.ts';

export const TITLE_STATES = ['unwatched', 'in_progress', 'seen'] as const;
export type TitleState = (typeof TITLE_STATES)[number];

export function isTitleState(value: unknown): value is TitleState {
  return typeof value === 'string' && (TITLE_STATES as readonly string[]).includes(value);
}

/**
 * One card on the wall, as `GET /titles` answers it. The API's `TitleSummary`
 * is the contract; this is its browser-side reading, and the two are kept the
 * same shape by hand until a wire-types package exists to hold them once.
 */
export interface TitleSummary {
  id: string;
  key: string;
  kind: 'show' | 'movie';
  name: string;
  year: number | null;
  posterPath: string | null;
  state: TitleState;
  /** Always `0 / 0` for a movie, which is "not applicable", not "0 of 0". */
  episodes: { total: number; seen: number };
  want: boolean;
  dropped: boolean;
  excluded: boolean;
  /** Null when nothing has ever reported on it, which is not the same as absent. */
  onDisk: boolean | null;
  lastWatchedAt: string | null;
  lastWatchedPrecision: 'exact' | 'day' | 'month' | 'year' | 'unknown' | null;
}

export interface TitleListFilter {
  state?: TitleState | undefined;
  /** Excluded titles are hidden unless asked for; there is no view of only the rejects. */
  includeExcluded?: boolean | undefined;
}

export function titlesQuery(filter: TitleListFilter = {}) {
  const params = new URLSearchParams();
  if (filter.state) params.set('state', filter.state);
  if (filter.includeExcluded) params.set('includeExcluded', 'true');
  const query = params.size > 0 ? `?${params.toString()}` : '';

  return queryOptions({
    // Normalised so that `{}` and `{ state: undefined }` are one cache entry.
    queryKey: [
      'titles',
      { state: filter.state ?? null, excluded: filter.includeExcluded ?? false },
    ],
    queryFn: () => apiFetch<{ titles: TitleSummary[] }>(`/titles${query}`),
  });
}

/**
 * TMDB's image CDN needs no key. The size is chosen here rather than stored
 * with the path, because the same path serves a card and, later, a title page.
 */
export function posterUrl(
  posterPath: string | null,
  size: 'w342' | 'w500' = 'w342',
): string | null {
  return posterPath === null ? null : `https://image.tmdb.org/t/p/${size}${posterPath}`;
}
