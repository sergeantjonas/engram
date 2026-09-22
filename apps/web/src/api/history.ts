import { queryOptions } from '@tanstack/react-query';
import { apiFetch } from './client.ts';
import type { TitleState, WatchPrecision } from './titles.ts';

/** A title as `GET /history` names it. */
export interface HistoryTitle {
  id: string;
  kind: 'show' | 'movie';
  name: string;
  posterPath: string | null;
  state: TitleState;
}

/** One finished, dated play, as `GET /history` answers it. */
export interface HistoryPlay {
  id: string;
  titleId: string;
  /** Null for a film. */
  season: number | null;
  number: number | null;
  name: string | null;
  runtimeMin: number | null;
  /** Read with `precision`: a coarse entry holds the first instant of the period it names. */
  watchedAt: string;
  precision: Exclude<WatchPrecision, 'unknown'>;
  source: string;
}

export interface History {
  titles: HistoryTitle[];
  plays: HistoryPlay[];
}

export const historyQuery = queryOptions({
  queryKey: ['history'],
  queryFn: () => apiFetch<History>('/history'),
});
