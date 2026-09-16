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
