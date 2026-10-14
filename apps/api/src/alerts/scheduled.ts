import { createHash } from 'node:crypto';
import { type ExternalIds, episodeKey, type TitleKind } from '@engram/shared';
import {
  type AlertDecision,
  type AlertKind,
  behindOf,
  DAY_MS,
  type FollowState,
  type GridEpisode,
  isFollowed,
  RECENT_DAYS,
} from './ready.js';

/**
 * How long a grab may go without an import before it counts as stuck.
 *
 * On the seedbox an import has followed its grab within minutes; four hours
 * leaves room for a long download queue and still pings the same evening.
 */
export const STUCK_HOURS = 4;

/**
 * Days after its air date before an episode nothing grabbed counts as
 * overdue, judged by the first walk on or after that day.
 *
 * Only TMDB's day is known for an episode no payload named. A US evening
 * airing reaches Brussels the morning after its date and a release follows
 * within hours, so the walk two days after is about a day late — and a walk
 * is what proves the file is not there under a missed webhook.
 */
export const OVERDUE_DAYS = 2;

/** What the record says about a show, for every episode of it checked. */
export interface ShowState {
  title: { kind: TitleKind; ids: ExternalIds };
  follow: FollowState;
  grid: GridEpisode[];
  /**
   * Plex or Sonarr named an episode TMDB does not list: their numbering and
   * the grid's disagree, so an episode missing by the grid's numbers may be
   * on disk under others.
   */
  offGrid: boolean;
}

/** One grid episode, with what Sonarr and the last walk said about it. */
export interface EpisodeState extends GridEpisode {
  /** Sonarr's first grab of it. */
  grabbedAt: Date | null;
  /** Sonarr imported a file for it, ever. */
  imported: boolean;
  /** Sonarr asked for a hand with a download of it, which has its own alert. */
  blocked: boolean;
  /** In the last walk's snapshot of Plex. */
  onDisk: boolean;
}

/** The checks every scheduled alert shares, then the key it would carry. */
function eligible(
  kind: AlertKind,
  show: ShowState,
  episode: EpisodeState,
  now: Date,
): { ok: true; key: string } | { ok: false; reason: string } {
  if (!isFollowed(show.follow)) return { ok: false, reason: 'not followed' };
  if (episode.season === 0) return { ok: false, reason: 'a special' };
  if (episode.airDate === null) return { ok: false, reason: 'no air date' };

  const elapsed = now.getTime() - new Date(`${episode.airDate}T00:00:00Z`).getTime();
  if (elapsed < 0) return { ok: false, reason: 'not aired yet' };
  if (elapsed > RECENT_DAYS * DAY_MS) {
    return { ok: false, reason: `aired ${Math.floor(elapsed / DAY_MS)} days ago` };
  }
  if (episode.seen) return { ok: false, reason: 'already watched' };
  if (episode.skipped) return { ok: false, reason: 'skipped' };
  if (episode.imported || episode.onDisk) return { ok: false, reason: 'on disk' };

  const slot = episodeKey({ title: show.title, season: episode.season, episode: episode.number });
  // Unreachable for a title the record keyed, and cheaper to satisfy than to explain.
  if (slot === null) return { ok: false, reason: 'no episode key' };
  return { ok: true, key: `${kind}@${slot}` };
}

function decided(
  kind: AlertKind,
  key: string,
  show: ShowState,
  episode: EpisodeState,
  now: Date,
): AlertDecision {
  const { season, number } = episode;
  const today = now.toISOString().slice(0, 10);
  return {
    ok: true,
    alert: { key, kind, season, number, behind: behindOf(show.grid, episode, today) },
  };
}

/**
 * Whether a grab has gone long enough without its file to say so.
 *
 * Pure, with the clock passed in. A grab the import followed — by Sonarr's
 * word or by the walk's — is not stuck, and neither is an upgrade's, since a
 * file was already there. A download Sonarr asked a hand for has said so
 * already, in its own alert.
 */
export function planStuckAlert(input: {
  show: ShowState;
  episode: EpisodeState;
  now: Date;
}): AlertDecision {
  const { show, episode, now } = input;
  const base = eligible('stuck', show, episode, now);
  if (!base.ok) return base;
  if (episode.blocked) return { ok: false, reason: 'Sonarr asked for a hand' };
  if (episode.grabbedAt === null) return { ok: false, reason: 'never grabbed' };
  if (now.getTime() - episode.grabbedAt.getTime() < STUCK_HOURS * 60 * 60 * 1000) {
    return { ok: false, reason: `grabbed under ${STUCK_HOURS} hours ago` };
  }
  return decided('stuck', base.key, show, episode, now);
}

/**
 * Whether an aired episode that nothing grabbed is late enough to say so.
 *
 * Pure, with the clock and the last walk's time passed in. Sonarr's silence
 * alone is not enough — a webhook missed while the API was down looks the
 * same — so the absence has to come from a walk made once the episode fell
 * due, and from a show whose numbering the grid shares.
 */
export function planOverdueAlert(input: {
  show: ShowState;
  episode: EpisodeState;
  lastWalkAt: Date | null;
  now: Date;
}): AlertDecision {
  const { show, episode, lastWalkAt, now } = input;
  const base = eligible('overdue', show, episode, now);
  if (!base.ok) return base;
  if (episode.grabbedAt !== null || episode.blocked) return { ok: false, reason: 'grabbed' };
  if (show.offGrid) return { ok: false, reason: 'numbered off the grid' };

  const due = new Date(`${episode.airDate}T00:00:00Z`).getTime() + OVERDUE_DAYS * DAY_MS;
  if (lastWalkAt === null || lastWalkAt.getTime() < due) {
    return { ok: false, reason: 'no walk since it fell due' };
  }
  return decided('overdue', base.key, show, episode, now);
}

/** One episode of a blocked download, and whether its file has come since. */
export interface BlockedEpisode {
  season: number;
  number: number;
  /** Imported by Sonarr since, or found by the walk. */
  handled: boolean;
}

export type BlockedDecision =
  | { ok: true; alert: { key: string; kind: 'blocked'; detail: string } }
  | { ok: false; reason: string };

const code = (ep: { season: number; number: number }) =>
  `S${String(ep.season).padStart(2, '0')}E${String(ep.number).padStart(2, '0')}`;

/** Three episodes named, more as a range: a season pack is one line, not ten. */
function span(episodes: { season: number; number: number }[]): string {
  if (episodes.length <= 3) return episodes.map(code).join(', ');
  const first = episodes[0];
  const last = episodes[episodes.length - 1];
  return `${first ? code(first) : ''}–${last ? code(last) : ''} (${episodes.length} episodes)`;
}

/**
 * Whether a download Sonarr asked a hand for still needs one, and the alert
 * if it does: one per download, under its id.
 *
 * Pure. Unlike every other alert it asks nothing of the show: followed or
 * not, aired last night or years ago, a download that cannot finish without
 * the owner is worth saying even when the owner started it, so they need not
 * watch Sonarr to find out. Only the episodes whose files have come since are
 * left out, and a download with none left says nothing — the hand was given.
 */
export function planBlockedAlert(input: {
  titleKey: string;
  downloadId: string;
  episodes: BlockedEpisode[];
  /** Sonarr's reasons, as the receiver kept them. */
  reasons: string | null;
}): BlockedDecision {
  const waiting = input.episodes
    .filter((ep) => !ep.handled)
    .sort((a, b) => a.season - b.season || a.number - b.number);
  if (waiting.length === 0) return { ok: false, reason: 'imported since' };

  const lines = [span(waiting)];
  lines.push(
    input.reasons ? `Sonarr says:\n${input.reasons}` : 'Sonarr could not import it by itself.',
  );
  return {
    ok: true,
    alert: {
      key: blockedKey(input.titleKey, input.downloadId),
      kind: 'blocked',
      detail: lines.join('\n'),
    },
  };
}

/**
 * The download's own id where the hub will take it: no whitespace, 200
 * characters at most, or it refuses the message for good. SABnzbd's ids and
 * torrent hashes always fit; a blackhole client's file name may not, and is
 * hashed instead.
 */
function blockedKey(titleKey: string, downloadId: string): string {
  const key = `blocked@${titleKey}@${downloadId}`;
  if (key.length <= 200 && !/\s/.test(key)) return key;
  return `blocked@${titleKey}@${createHash('sha256').update(downloadId).digest('hex').slice(0, 32)}`;
}
