import type { TitleSummary } from '../api/titles.ts';

/**
 * How long a show can go untouched before it reads as drifting rather than in
 * progress.
 *
 * Six months is a judgement, not a measurement — it is one constant, in one
 * place, so it can be argued with. At 180 days this library separates the
 * handful still in rotation from the ones quietly abandoned, which is the
 * distinction the chip exists to draw.
 */
export const DRIFTING_AFTER_DAYS = 180;

/**
 * What the wall filters by, in the order the chips appear.
 *
 * These are facets, not a partition: a show can be still going, drifting and
 * full of holes at once, and each chip carries its own count of the whole
 * library rather than of what is currently on screen.
 */
export const FACETS = ['going', 'drifting', 'gaps', 'finished', 'unwatched', 'offdisk'] as const;

export type Facet = (typeof FACETS)[number];

export const FACET_LABEL: Record<Facet, string> = {
  going: 'Still going',
  drifting: 'Drifting',
  gaps: 'Gaps',
  finished: 'Finished',
  unwatched: 'Unwatched',
  offdisk: 'Not on disk',
};

export const isFacet = (value: unknown): value is Facet =>
  typeof value === 'string' && (FACETS as readonly string[]).includes(value);

const daysSince = (at: string | null, now: Date): number | null =>
  at === null ? null : Math.floor((now.getTime() - Date.parse(at)) / 86_400_000);

export function matchesFacet(title: TitleSummary, facet: Facet, now: Date): boolean {
  switch (facet) {
    case 'going':
      return title.state === 'in_progress';
    case 'drifting': {
      if (title.state !== 'in_progress') return false;
      // Only a date the record knows to the day can be counted from. A coarse
      // entry stores the first instant of the period it names, so "2026" would
      // read as however long ago the 1st of January was — an error bigger than
      // the threshold it is being measured against. A show with no date at all
      // cannot be drifting either: silence is not evidence of age, and every
      // hand-entered backfill is silent.
      const precision = title.lastWatchedPrecision;
      if (precision !== 'exact' && precision !== 'day') return false;
      const days = daysSince(title.lastWatchedAt, now);
      return days !== null && days >= DRIFTING_AFTER_DAYS;
    }
    case 'gaps':
      return title.hasGap;
    case 'finished':
      return title.state === 'seen';
    case 'unwatched':
      return title.state === 'unwatched';
    case 'offdisk':
      return title.onDisk === false;
  }
}

/** Every facet's count over the whole library, including the ones at zero. */
export function countFacets(titles: TitleSummary[], now: Date): Record<Facet, number> {
  const counts = {} as Record<Facet, number>;
  for (const facet of FACETS) {
    counts[facet] = titles.filter((title) => matchesFacet(title, facet, now)).length;
  }
  return counts;
}
