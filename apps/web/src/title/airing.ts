import type { Airing, TitleSummary } from '../api/titles.ts';

/** What the header's meta line says about where the run stands. */
export interface AiringLine {
  /** `Ended`, `Cancelled`, `Returning`, `In production`; null when there is nothing to add. */
  status: string | null;
  /** The year a closed run ended, when it differs from the year the title already carries. */
  endedYear: string | null;
  /** The next episode's `YYYY-MM-DD`, only while it is still ahead of today. */
  nextAirDate: string | null;
  /** The fetch date to state beside `next` when the claim is more than a day old. */
  asOf: string | null;
}

const CLOSED = new Set(['Ended', 'Canceled']);

/**
 * TMDB's status in the header's words. `Released` says nothing the year does
 * not already say, so a film's line stays as it was.
 */
function statusWord(status: string): string | null {
  switch (status) {
    case 'Returning Series':
      return 'Returning';
    case 'Canceled':
      return 'Cancelled';
    case 'Released':
      return null;
    default:
      return status.charAt(0) + status.slice(1).toLowerCase();
  }
}

/**
 * Pure: `today` comes in as `YYYY-MM-DD`, the shape the air dates are stored
 * in, so the comparison is a string comparison and the page shares one clock.
 *
 * A next episode is only claimed while its date is ahead; one that has passed
 * without a refresh is a fact this record no longer knows, and the line says
 * nothing rather than "next" about a day gone by. While the refresh is a
 * manual run, a claim not fetched today names the day it was: only a same-day
 * fetch is certain to be less than a day old.
 */
export function airingLine(
  title: Pick<TitleSummary, 'status' | 'year'>,
  airing: Airing,
  today: string,
): AiringLine {
  const status = title.status === null ? null : statusWord(title.status);

  const closed = title.status !== null && CLOSED.has(title.status);
  const ended = closed && airing.lastAirDate !== null ? airing.lastAirDate.slice(0, 4) : null;
  const endedYear = ended !== null && Number(ended) !== title.year ? ended : null;

  const ahead = airing.next?.airDate ?? null;
  const nextAirDate = ahead !== null && ahead >= today ? ahead : null;
  const fetched = airing.fetchedAt?.slice(0, 10) ?? null;
  const asOf = nextAirDate !== null && fetched !== null && fetched < today ? fetched : null;

  return { status, endedYear, nextAirDate, asOf };
}
