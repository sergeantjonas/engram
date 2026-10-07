import { type ExternalIds, episodeKey, type TitleKind } from '@engram/shared';

/**
 * How recently an episode must have aired for its arrival to be news.
 *
 * Most shows air weekly, and a release that comes late is still the new
 * episode; twice that covers one the overdue alert already flagged. A season
 * Sonarr fetches after a show is added, or an old episode searched for by
 * hand, aired long before — which is how alerts keep quiet about what the
 * owner did without asking Sonarr why it acted.
 */
export const RECENT_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the record says about the viewer and a title. */
export interface FollowState {
  kind: TitleKind;
  want: boolean;
  dropped: boolean;
  excluded: boolean;
  /** Anything of the title has been played, finished or not. */
  played: boolean;
}

/** One episode of the title's grid, as far as where-you-stand needs it. */
export interface GridEpisode {
  season: number;
  number: number;
  seen: boolean;
  /** The viewer said they passed over it on purpose. */
  skipped: boolean;
  /** `YYYY-MM-DD`, or null when no date is on record. */
  airDate: string | null;
}

export interface ReadyInput {
  title: { kind: TitleKind; ids: ExternalIds };
  /** Sonarr's air instant and air day, as it sent them. */
  episode: { season: number; number: number; airedAt: string | null; airDate: string | null };
  /** A quality upgrade of a file already there. */
  upgrade: boolean;
  follow: FollowState;
  grid: GridEpisode[];
  now: Date;
}

export interface PlannedAlert {
  key: string;
  kind: 'ready';
  season: number;
  number: number;
  behind: number | null;
}

export type ReadyDecision = { ok: true; alert: PlannedAlert } | { ok: false; reason: string };

/**
 * A show being followed: wanted, or with a play behind it, and neither
 * dropped nor excluded. Derived rather than stored, because `intent.started_at`
 * is never written and a play is what "started" means in this record.
 */
export function isFollowed(follow: FollowState): boolean {
  return (
    follow.kind === 'show' && !follow.dropped && !follow.excluded && (follow.want || follow.played)
  );
}

const after = (a: { season: number; number: number }, b: { season: number; number: number }) =>
  a.season > b.season || (a.season === b.season && a.number > b.number);

/**
 * How many episodes the viewer still has before this one, on the definition
 * Next up uses: counted from the furthest regular episode watched, so a hole
 * left behind that point is not owed. Skipped and unaired episodes are not
 * counted either. Null when nothing has been watched, when this one sits
 * behind the furthest watched — doubling back, which Next up does not call
 * next either — and for a special, which sits outside the run.
 */
export function behindOf(
  grid: GridEpisode[],
  place: { season: number; number: number },
  today: string,
): number | null {
  if (place.season === 0) return null;
  const regular = grid.filter((ep) => ep.season !== 0);
  const furthest = regular
    .filter((ep) => ep.seen)
    .reduce<GridEpisode | null>((far, ep) => (far === null || after(ep, far) ? ep : far), null);
  if (furthest === null || !after(place, furthest)) return null;

  return regular.filter(
    (ep) =>
      after(ep, furthest) &&
      after(place, ep) &&
      !ep.seen &&
      !ep.skipped &&
      (ep.airDate === null || ep.airDate <= today),
  ).length;
}

/**
 * Whether an import is worth a ready alert, and the alert if it is.
 *
 * Pure: no database, no network, and the clock passed in.
 *
 * Only a first file of a recently aired episode of a followed show, not yet
 * watched. Everything else is the owner's own doing or nothing new, and the
 * reason says which, so the log can answer "why did it not tell me".
 */
export function planReadyAlert(input: ReadyInput): ReadyDecision {
  const { episode, follow, now } = input;

  if (input.upgrade) return { ok: false, reason: 'an upgrade' };
  if (!isFollowed(follow)) return { ok: false, reason: 'not followed' };

  // Sonarr's instant first. Its day, read as the start of that day in UTC,
  // only where it sent no instant: that overstates a US evening airing's age
  // by under a day, which a two-week window absorbs.
  const aired = episode.airedAt
    ? new Date(episode.airedAt)
    : episode.airDate
      ? new Date(`${episode.airDate}T00:00:00Z`)
      : null;
  if (aired === null) return { ok: false, reason: 'no air date' };

  const elapsed = now.getTime() - aired.getTime();
  if (elapsed > RECENT_DAYS * DAY_MS) {
    return { ok: false, reason: `aired ${Math.floor(elapsed / DAY_MS)} days ago` };
  }

  const self = input.grid.find(
    (ep) => ep.season === episode.season && ep.number === episode.number,
  );
  if (self?.seen) return { ok: false, reason: 'already watched' };

  const slot = episodeKey({ title: input.title, season: episode.season, episode: episode.number });
  // Unreachable for a title the record keyed, and cheaper to satisfy than to explain.
  if (slot === null) return { ok: false, reason: 'no episode key' };

  const today = now.toISOString().slice(0, 10);
  return {
    ok: true,
    alert: {
      key: `ready@${slot}`,
      kind: 'ready',
      season: episode.season,
      number: episode.number,
      behind: behindOf(input.grid, episode, today),
    },
  };
}
