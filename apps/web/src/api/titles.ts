import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from './client.ts';

export type WatchPrecision = 'exact' | 'day' | 'month' | 'year' | 'unknown';

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
  lastWatchedPrecision: WatchPrecision | null;
}

export type GapReason = 'skipped' | 'missing';

/** What the viewer has said about a hole, if anything. */
export interface EpisodeGap {
  reason: GapReason;
  note: string | null;
}

/** One cell of the grid, as `GET /titles/:id` answers it. */
export interface EpisodeCell {
  id: string;
  number: number;
  name: string | null;
  airDate: string | null;
  runtimeMin: number | null;
  seen: boolean;
  playCount: number;
  firstWatchedAt: string | null;
  firstWatchedPrecision: WatchPrecision | null;
  lastWatchedAt: string | null;
  lastWatchedPrecision: WatchPrecision | null;
  /** True when TMDB does not list this episode, so nothing can ever label it. */
  unmatched: boolean;
  /** Null is "never said", which is not "not skipped". Stale rather than wrong on a seen episode. */
  gap: EpisodeGap | null;
}

export interface SeasonGrid {
  season: number;
  episodes: EpisodeCell[];
}

export interface TitleDetail {
  title: TitleSummary;
  /** Ascending, season 0 first when it exists; collapsing it is the page's job. */
  seasons: SeasonGrid[];
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

export function titleQuery(id: string) {
  return queryOptions({
    queryKey: ['title', id],
    queryFn: () => apiFetch<TitleDetail>(`/titles/${encodeURIComponent(id)}`),
  });
}

export function setGap(episodeId: string, gap: { reason: GapReason; note: string | null }) {
  return apiFetch<{ gap: EpisodeGap }>(`/episodes/${encodeURIComponent(episodeId)}/gap`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(gap),
  });
}

/** Clearing is saying nothing again; the API answers 204 whether or not there was anything to clear. */
export function clearGap(episodeId: string) {
  return apiFetch<void>(`/episodes/${encodeURIComponent(episodeId)}/gap`, { method: 'DELETE' });
}
