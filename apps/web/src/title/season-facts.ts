import type { EpisodeCell } from '../api/titles.ts';
import { statusOf } from './EpisodeCell.tsx';

/**
 * What a season heading can say about the season from the cells alone. There
 * is no `season` table, so this is derived, not stored.
 */
export interface SeasonFacts {
  /** `2019` or `2019–2020` from the air dates; null when no episode is dated. */
  years: string | null;
  count: number;
  seen: number;
  /** Cells not seen that are part of the run: not out yet and not on TMDB are excluded. */
  holes: number;
  /**
   * The seen state in the heading's words, or null for a season with nothing
   * to say — every cell in the run seen. `none seen` when nothing is, `one
   * missing` for a single hole, `3 missing` above that.
   */
  state: string | null;
}

const HOLE_STATUSES = new Set(['hole', 'skipped', 'missing']);

/** Pure: the clock comes in as `today` so every cell on the page shares one. */
export function seasonFacts(episodes: EpisodeCell[], today: string): SeasonFacts {
  const years = episodes
    .map((episode) => episode.airDate?.slice(0, 4))
    .filter((year): year is string => year !== undefined)
    .sort();
  const first = years[0];
  const last = years[years.length - 1];
  const range = first === undefined ? null : first === last ? first : `${first}–${last}`;

  let seen = 0;
  let holes = 0;
  for (const episode of episodes) {
    const status = statusOf(episode, today);
    if (status === 'seen') seen += 1;
    else if (HOLE_STATUSES.has(status)) holes += 1;
  }

  const state =
    holes === 0
      ? null
      : seen === 0
        ? 'none seen'
        : holes === 1
          ? 'one missing'
          : `${holes} missing`;

  return { years: range, count: episodes.length, seen, holes, state };
}
