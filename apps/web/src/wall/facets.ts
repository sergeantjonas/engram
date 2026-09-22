import type { TitleSummary } from '../api/titles.ts';
import { CLOSED } from '../title/airing.ts';

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
 *
 * *Want* sits beside *Unwatched* because the two are the backlog read two
 * ways: what the record has no play of, and what the viewer has said they
 * mean to see. They part as soon as a show is added before it is started, or
 * a film is flagged for a second watch.
 */
export const FACETS = [
  'going',
  'drifting',
  'gaps',
  'finished',
  'unwatched',
  'want',
  'offdisk',
] as const;

export type Facet = (typeof FACETS)[number];

export const FACET_LABEL: Record<Facet, string> = {
  going: 'Still going',
  drifting: 'Drifting',
  gaps: 'Gaps',
  finished: 'Finished',
  unwatched: 'Unwatched',
  want: 'Want',
  offdisk: 'Not on disk',
};

export const isFacet = (value: unknown): value is Facet =>
  typeof value === 'string' && (FACETS as readonly string[]).includes(value);

/**
 * What the wall narrows to, above the facets and apart from them.
 *
 * Kind is a partition where the facets are not — nothing is both a series and
 * a movie — so it reads as one control with a current value rather than as
 * another chip. Absent means both.
 *
 * It earns the room at 82 titles. A third of the library is movies, and the
 * movie backlog is the largest single thing on the wall: this control plus
 * *Unwatched*, or *Want* once films are flagged, rather than a chip of its own
 * saying the same in one word.
 */
export const KINDS = ['show', 'movie'] as const;

export type KindFilter = (typeof KINDS)[number];

export const KIND_LABEL: Record<KindFilter, string> = {
  show: 'Series',
  movie: 'Movies',
};

export const isKind = (value: unknown): value is KindFilter =>
  typeof value === 'string' && (KINDS as readonly string[]).includes(value);

/**
 * Three facets describe a run rather than a watch, and `deriveState` never
 * returns `in_progress` for a movie, so against Movies they are not empty by
 * accident — they cannot ever match. Offering a chip that is structurally
 * zero invites the reader to wonder what they did wrong.
 */
const RUN_ONLY: readonly Facet[] = ['going', 'drifting', 'gaps'];

/**
 * The same structural zero, for a different reader. `want` is an opinion, not
 * a fact about the record, and the API sends it to anyone but the owner as
 * false, so a stranger's *Want* could only ever read 0.
 */
const OWNER_ONLY: readonly Facet[] = ['want'];

export const appliesTo = (facet: Facet, kind: KindFilter | undefined, isOwner: boolean): boolean =>
  (kind !== 'movie' || !RUN_ONLY.includes(facet)) && (isOwner || !OWNER_ONLY.includes(facet));

export const facetsFor = (kind: KindFilter | undefined, isOwner: boolean): readonly Facet[] =>
  FACETS.filter((facet) => appliesTo(facet, kind, isOwner));

const daysSince = (at: string | null, now: Date): number | null =>
  at === null ? null : Math.floor((now.getTime() - Date.parse(at)) / 86_400_000);

export function matchesFacet(title: TitleSummary, facet: Facet, now: Date): boolean {
  switch (facet) {
    case 'going':
      return title.state === 'in_progress';
    case 'drifting': {
      if (title.state !== 'in_progress') return false;
      // A run TMDB has closed cannot be picked back up when the next episode
      // comes, because none is coming: half-watched, it is dropped in fact,
      // however recent the last episode was.
      if (title.status !== null && CLOSED.has(title.status)) return true;
      // The opposite case: a dated episode ahead means the gap is the show's,
      // not the viewer's. Waiting on a season is not drifting from it.
      const today = now.toISOString().slice(0, 10);
      if (title.nextAirDate !== null && title.nextAirDate >= today) return false;
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
    // The flag as set, whatever has been watched since: clearing it is the
    // viewer's call, and a title finished while wanted still says so. Dropped
    // is the exception. The two flags are kept apart so the record remembers
    // a show was meant before it was given up on, but a backlog that lists
    // what the viewer gave up on is not one.
    case 'want':
      return title.want && !title.dropped;
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
