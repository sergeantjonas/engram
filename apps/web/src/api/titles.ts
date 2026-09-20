import { queryOptions } from '@tanstack/react-query';
import { apiFetch, postJson } from './client.ts';

export type WatchPrecision = 'exact' | 'day' | 'month' | 'year' | 'unknown';

export type TitleState = 'unwatched' | 'in_progress' | 'seen';

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
  /** An unwatched episode with watched ones either side of it, within one season. */
  hasGap: boolean;
  /** Nothing from Plex has ever been recorded against it, so it is here by hand. */
  manualOnly: boolean;
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

/** What the title is keyed and cross-referenced by. Any of the three may be absent. */
export interface ExternalIds {
  tmdb: string | null;
  tvdb: string | null;
  imdb: string | null;
}

/**
 * The header's figure row, counted by the API over the same set as the seen
 * fraction — specials excluded, and a null episode counted only for a film.
 *
 * `lastWatchedAt` here is not `title.lastWatchedAt`, which includes specials.
 * This is the one to show beside the other figures.
 */
export interface TitleFigures {
  plays: number;
  rewatched: number;
  firstWatchedAt: string | null;
  firstWatchedPrecision: WatchPrecision | null;
  lastWatchedAt: string | null;
  lastWatchedPrecision: WatchPrecision | null;
}

export interface TitleDetail {
  title: TitleSummary;
  ids: ExternalIds;
  figures: TitleFigures;
  /** Ascending, season 0 first when it exists; collapsing it is the page's job. */
  seasons: SeasonGrid[];
}

/**
 * The API also filters by state; the wall does not use it. Every chip carries a
 * count of the whole library, so the wall fetches all of it and narrows in the
 * browser — asking the server would leave the counts describing what survived.
 */
export interface TitleListFilter {
  /** Excluded titles are hidden unless asked for; there is no view of only the rejects. */
  includeExcluded?: boolean | undefined;
}

export function titlesQuery(filter: TitleListFilter = {}) {
  const query = filter.includeExcluded ? '?includeExcluded=true' : '';

  return queryOptions({
    // Normalised so that `{}` and `{ includeExcluded: undefined }` are one entry.
    queryKey: ['titles', { excluded: filter.includeExcluded ?? false }],
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

/** A TMDB search hit, as `GET /search` answers it. Not stored until it is added. */
export interface TmdbCandidate {
  kind: 'show' | 'movie';
  tmdbId: string;
  name: string;
  year: number | null;
  posterPath: string | null;
  overview: string | null;
}

export function searchQuery(q: string) {
  return queryOptions({
    queryKey: ['search', q],
    queryFn: () => apiFetch<{ results: TmdbCandidate[] }>(`/search?q=${encodeURIComponent(q)}`),
    // A search for nothing is not a search. The route rejects an empty `q`
    // with a 400, and asking it to is a round trip to learn what is already
    // known here.
    enabled: q !== '',
    // The same query typed twice in a minute is the same twenty films, and
    // every miss is a TMDB call against the owner's key.
    staleTime: 5 * 60 * 1000,
  });
}

/** What `POST /titles` returns. */
export interface AddedTitle {
  title: { id: string; name: string };
  seasons: Array<{ season: number; episodeCount: number }>;
}

/**
 * Adds a title by TMDB id. Answers 201 when it was created and 200 when it was
 * already stored, which read the same here: either way the title now exists
 * and the page that shows it is where the viewer wants to be.
 */
export function addTitle(candidate: Pick<TmdbCandidate, 'kind' | 'tmdbId'>): Promise<AddedTitle> {
  return postJson<AddedTitle>('/titles', { kind: candidate.kind, tmdbId: candidate.tmdbId });
}

/**
 * Identity for a candidate on screen. TMDB numbers films and series in
 * separate namespaces, so the id alone can name two different things.
 */
export function candidateKey(candidate: Pick<TmdbCandidate, 'kind' | 'tmdbId'>): string {
  return `${candidate.kind}:${candidate.tmdbId}`;
}
