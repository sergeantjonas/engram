import { queryOptions } from '@tanstack/react-query';
import { apiFetch, postJson } from './client.ts';

export type WatchPrecision = 'exact' | 'day' | 'month' | 'year' | 'unknown';

export type TitleState = 'unwatched' | 'in_progress' | 'seen';

/**
 * One card on the wall, as `GET /titles` answers it. The API's `TitleSummary`
 * is the contract; this is its browser-side reading, and the two are kept the
 * same shape by hand until a wire-types package exists to hold them once.
 */
export interface TitleSummary extends Intent {
  id: string;
  key: string;
  kind: 'show' | 'movie';
  name: string;
  year: number | null;
  posterPath: string | null;
  state: TitleState;
  /** Always `0 / 0` for a movie, which is "not applicable", not "0 of 0". */
  episodes: { total: number; seen: number };
  /** Null when nothing has ever reported on it, which is not the same as absent. */
  onDisk: boolean | null;
  lastWatchedAt: string | null;
  lastWatchedPrecision: WatchPrecision | null;
  /** An unwatched episode with watched ones either side of it, within one season. */
  hasGap: boolean;
  /** Nothing from Plex has ever been recorded against it, so it is here by hand. */
  manualOnly: boolean;
}

/** What the viewer wants of a title, as against what they have watched. */
export interface Intent {
  want: boolean;
  dropped: boolean;
  excluded: boolean;
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
  /**
   * How many of those plays were entered by hand, which is how many can be
   * taken back. A play Plex reported is not one of them.
   */
  manualPlays: number;
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
  /** Of those plays, the ones entered by hand: what a whole-title undo covers. */
  manualPlays: number;
  firstWatchedAt: string | null;
  firstWatchedPrecision: WatchPrecision | null;
  lastWatchedAt: string | null;
  lastWatchedPrecision: WatchPrecision | null;
}

/** One play, as the feed and the twelve-month strip read it. */
export interface WatchMoment {
  id: string;
  /** Null for a film, whose events name no episode. */
  season: number | null;
  number: number | null;
  name: string | null;
  watchedAt: string | null;
  precision: WatchPrecision;
  source: string;
  /** Not the first play of this episode. */
  rewatch: boolean;
}

export interface TitleDetail {
  title: TitleSummary;
  ids: ExternalIds;
  /** Null often enough that the header has to read without one. */
  backdropPath: string | null;
  figures: TitleFigures;
  /**
   * Newest first, and capped by the API. `figures.plays` counts the same set
   * uncapped, so `plays > recentActivity.length` means this is truncated and
   * anything drawn from it covers only the recent end.
   */
  recentActivity: WatchMoment[];
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

/** A backdrop is wide and sits behind text, so it is fetched at its own sizes. */
export function backdropUrl(backdropPath: string | null, size: 'w780' | 'w1280' = 'w1280') {
  return backdropPath === null ? null : `https://image.tmdb.org/t/p/${size}${backdropPath}`;
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

/**
 * How much of a title one mark covers, as `POST /watch-events` names it.
 *
 * `all` steps over season 0, so specials have to be named to be marked.
 */
export type WatchScope = 'all' | { season: number; episode?: number };

/** What `POST /watch-events` answers: the same mark twice writes nothing the second time. */
export interface MarkedWatched {
  written: number;
  skipped: number;
}

/**
 * Records that something was watched, which for history older than this Plex
 * server is the only way it gets on the record at all.
 *
 * `watchedAt` is the date as it was written — a year, a month, a day, or blank
 * — and the API reads the precision off its shape rather than being told. A
 * blank one is stored as no date, not as today.
 */
export function markWatched(mark: {
  titleId: string;
  scope: WatchScope;
  watchedAt: string;
}): Promise<MarkedWatched> {
  const watchedAt = mark.watchedAt.trim();
  return postJson<MarkedWatched>('/watch-events', {
    titleId: mark.titleId,
    scope: mark.scope,
    ...(watchedAt === '' ? {} : { watchedAt }),
  });
}

/** What `DELETE /watch-events` answers. */
export interface RetractedMarks {
  removed: number;
}

/**
 * Takes back what was entered by hand in a scope.
 *
 * Only hand-entered plays go: what Plex reported is not this record's to
 * delete, so a retraction can never cost imported history however wide the
 * scope it names.
 */
export function markUnwatched(mark: {
  titleId: string;
  scope: WatchScope;
}): Promise<RetractedMarks> {
  const scoped =
    mark.scope === 'all'
      ? ''
      : `&season=${mark.scope.season}${
          mark.scope.episode === undefined ? '' : `&episode=${mark.scope.episode}`
        }`;

  return apiFetch<RetractedMarks>(
    `/watch-events?titleId=${encodeURIComponent(mark.titleId)}${scoped}`,
    { method: 'DELETE' },
  );
}

/**
 * Records an opinion about a title.
 *
 * A patch: naming one field leaves the other two alone, so dropping a show
 * cannot quietly un-exclude it. When a title was dropped is the server's to
 * decide, which is why only booleans go over the wire.
 */
export function setIntent(titleId: string, patch: Partial<Intent>): Promise<{ intent: Intent }> {
  return apiFetch<{ intent: Intent }>(`/titles/${encodeURIComponent(titleId)}/intent`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/** An episode named by where it sits, which is how the band says it. */
export interface NextUpEpisode {
  season: number;
  number: number;
  name: string | null;
}

/** One show worth picking back up, as `GET /next-up` answers it. */
export interface NextUp {
  titleId: string;
  name: string;
  posterPath: string | null;
  backdropPath: string | null;
  stoppedAfter: NextUpEpisode & { watchedAt: string | null; watchedPrecision: WatchPrecision };
  next: NextUpEpisode;
  /** False when the only thing left sits behind where you stopped. */
  continues: boolean;
}

export function nextUpQuery() {
  return queryOptions({
    queryKey: ['next-up'],
    queryFn: () => apiFetch<{ nextUp: NextUp[] }>('/next-up'),
  });
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

/** A season as `POST /titles` reports it back, with what the grid holds. */
export interface AddedSeason {
  season: number;
  episodeCount: number;
}

/** What `POST /titles` returns. */
export interface AddedTitle {
  title: { id: string; name: string };
  seasons: AddedSeason[];
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
