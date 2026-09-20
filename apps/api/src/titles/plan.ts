import { type TitleKind, titleKey } from '@engram/shared';
import type { TmdbEpisode, TmdbTitleDetails } from '../tmdb/client.js';

/** A `title` row, ready to write. */
export interface PlannedTitleRow {
  key: string;
  kind: TitleKind;
  tmdbId: string | null;
  tvdbId: string | null;
  imdbId: string | null;
  name: string;
  year: number | null;
  posterPath: string | null;
  backdropPath: string | null;
  overview: string | null;
}

/** An `episode` row, ready to write. */
export interface PlannedEpisodeRow {
  season: number;
  number: number;
  name: string | null;
  airDate: string | null;
  runtimeMin: number | null;
  tmdbEpisodeId: string | null;
}

export type TitlePlan =
  | { ok: true; title: PlannedTitleRow; seasons: number[] }
  | { ok: false; reason: string };

/**
 * Turns a TMDB details response into the rows that represent it.
 *
 * Pure: no database, no network, no clock. The same split as `planImport` — the
 * decisions worth testing are here, and the route is left with the writing.
 */
export function planTitle(details: TmdbTitleDetails): TitlePlan {
  const key = titleKey({ kind: details.kind, ids: details.ids });
  if (!key) {
    // Without its canonical id a title cannot survive a redownload, and storing
    // it under some other id would quietly create a second identity for it.
    const missing = details.kind === 'show' ? 'tvdb' : 'tmdb';
    return { ok: false, reason: `TMDB has no ${missing} id for this title` };
  }

  return {
    ok: true,
    title: {
      key,
      kind: details.kind,
      tmdbId: details.ids.tmdb ?? null,
      tvdbId: details.ids.tvdb ?? null,
      imdbId: details.ids.imdb ?? null,
      name: details.name,
      year: details.year,
      posterPath: details.posterPath,
      backdropPath: details.backdropPath,
      overview: details.overview,
    },
    seasons: details.seasons.map((season) => season.season),
  };
}

/**
 * Narrows a season's episodes to rows the database will accept.
 *
 * `episode` is unique on (title, season, number), so a repeated number would
 * abort the whole season's insert. TMDB does occasionally list one twice where
 * a two-parter has been re-cut, and the first listing wins.
 */
export function planEpisodes(episodes: TmdbEpisode[]): PlannedEpisodeRow[] {
  const rows = new Map<string, PlannedEpisodeRow>();

  for (const episode of episodes) {
    if (!Number.isInteger(episode.season) || !Number.isInteger(episode.number)) continue;
    const key = `${episode.season}/${episode.number}`;
    if (rows.has(key)) continue;

    rows.set(key, {
      season: episode.season,
      number: episode.number,
      name: episode.name,
      airDate: episode.airDate,
      runtimeMin: episode.runtimeMin,
      tmdbEpisodeId: episode.tmdbEpisodeId,
    });
  }

  return [...rows.values()];
}

/**
 * Where a title sits, as one word the wall can colour.
 *
 * Jade for `seen`, gold for `in_progress`, and the espresso ground for the
 * rest — so the state is legible across a wall of artwork without a legend.
 */
export type TitleState = 'seen' | 'in_progress' | 'unwatched';

export interface TitleProgress {
  kind: TitleKind;
  /** Episodes on record, specials excluded. Zero for a movie. */
  episodeTotal: number;
  /** Of those, how many have a `watch_state` row saying seen. */
  seenCount: number;
  /** Whether the movie itself has been seen. Meaningless for a show. */
  movieSeen: boolean;
}

/**
 * Specials are left out of both halves of the fraction, matching what a
 * whole-title mark writes: a show whose every regular episode is seen reads as
 * seen even if an OVA never was, because that is what the viewer meant.
 *
 * A show with no episodes on record is `unwatched` rather than `seen`. An empty
 * fraction is not completion, and reading it as one would paint a title jade
 * the moment it was added.
 */
export function deriveState(progress: TitleProgress): TitleState {
  if (progress.kind === 'movie') return progress.movieSeen ? 'seen' : 'unwatched';
  if (progress.episodeTotal === 0 || progress.seenCount === 0) return 'unwatched';
  return progress.seenCount >= progress.episodeTotal ? 'seen' : 'in_progress';
}
