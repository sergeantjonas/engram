import type { TitleState, TitleSummary } from '../api/titles.ts';

/** One heading in the pane and the titles under it. */
export interface TitleGroup {
  state: TitleState;
  label: string;
  titles: TitleSummary[];
}

/**
 * Groups in the order a viewer works down them rather than the order the
 * states happen to be declared in: what is mid-run first, what has not been
 * started next, and what is done last. The mockup had no unwatched title to
 * place; this library can.
 */
const GROUPS: { state: TitleState; label: string }[] = [
  { state: 'in_progress', label: 'Still going' },
  { state: 'unwatched', label: 'Unwatched' },
  { state: 'seen', label: 'Finished' },
];

/**
 * Most recently watched first, undated last, ties broken by name.
 *
 * Undated goes to the bottom rather than the top: a title watched "sometime in
 * 2019" is not news, and sorting it beside last night's play would put the
 * least current thing where the most current belongs.
 */
function byRecency(a: TitleSummary, b: TitleSummary): number {
  if (a.lastWatchedAt === b.lastWatchedAt) return a.name.localeCompare(b.name);
  if (a.lastWatchedAt === null) return 1;
  if (b.lastWatchedAt === null) return -1;
  return b.lastWatchedAt.localeCompare(a.lastWatchedAt);
}

/** The pane's shape. Empty groups are dropped, so a heading always has rows. */
export function groupedTitles(titles: TitleSummary[]): TitleGroup[] {
  return GROUPS.map(({ state, label }) => ({
    state,
    label,
    titles: titles.filter((title) => title.state === state).sort(byRecency),
  })).filter((group) => group.titles.length > 0);
}

/**
 * The first row the pane would draw, which is where the rail's LIST leads.
 *
 * Derived from the same grouping rather than sorted again beside it: the rail
 * pointing somewhere the pane does not open on is the one way this can be
 * visibly wrong.
 */
export function topOfList(titles: TitleSummary[]): TitleSummary | undefined {
  return groupedTitles(titles)[0]?.titles[0];
}
