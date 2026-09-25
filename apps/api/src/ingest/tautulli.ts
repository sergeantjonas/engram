import {
  type ExternalIds,
  episodeKey,
  type TitleKind,
  titleKey,
  type WatchPrecision,
} from '@engram/shared';
import type { LiveEvent, LiveSession } from '../live/sessions.js';

/**
 * A Tautulli webhook body, already authenticated and with `token` stripped.
 *
 * Every value is a string. The body is a JSON template Tautulli substitutes
 * parameters into, so `"season_num": "1"` arrives and `1` never does, and a
 * parameter that does not apply becomes `""` rather than going absent.
 *
 * Named rather than `Record<string, unknown>` so a mistyped field fails to
 * compile instead of quietly reading as absent. Every value stays `unknown`:
 * the body is authored by hand in Tautulli's notification agent, so the type
 * says which fields are asked for, never that they arrived.
 */
export interface TautulliPayload {
  action?: unknown;
  media_type?: unknown;
  title?: unknown;
  show_name?: unknown;
  episode_name?: unknown;
  season_num?: unknown;
  episode_num?: unknown;
  year?: unknown;
  themoviedb_id?: unknown;
  thetvdb_id?: unknown;
  imdb_id?: unknown;
  guid?: unknown;
  rating_key?: unknown;
  grandparent_rating_key?: unknown;
  duration_sec?: unknown;
  view_offset?: unknown;
  progress_percent?: unknown;
  user_id?: unknown;
  player?: unknown;
  platform?: unknown;
  unixtime?: unknown;
  session_key?: unknown;
  user_streams?: unknown;
  remaining_duration_sec?: unknown;
}

export interface PlannedPlayTitle {
  key: string;
  kind: TitleKind;
  ids: ExternalIds;
  name: string;
  year: number | null;
}

export interface PlannedPlayEpisode {
  titleKey: string;
  season: number;
  number: number;
  name: string | null;
}

export interface PlannedPlay {
  sourceEventId: string;
  titleKey: string;
  season: number | null;
  number: number | null;
  watchedAt: Date;
  watchedPrecision: WatchPrecision;
  durationSec: number | null;
  viewOffsetSec: number | null;
  percentComplete: number | null;
  completed: boolean;
  /** Tautulli's `{user_id}`, which is its own namespace and not Plex's. */
  accountId: string | null;
  player: string | null;
  platform: string | null;
  raw: TautulliPayload;
}

/** Everything one play implies, named so the writer can take it whole. */
export interface PlannedRows {
  title: PlannedPlayTitle;
  /** Null for a film, which hangs off no episode. */
  episode: PlannedPlayEpisode | null;
  play: PlannedPlay;
}

export type TautulliPlan = ({ ok: true } & PlannedRows) | { ok: false; reason: string };

/**
 * How much of a thing counts as having watched it.
 *
 * 90% is Plex's own default, chosen to agree with it rather than on its own
 * merits: the nightly library walk reports Plex's binary watched flag, so a
 * different threshold here would have the two sources disagree about the same
 * play by construction, and the disagreement would look like a bug in
 * whichever one was read second.
 */
export const COMPLETION_THRESHOLD = 90;

/** Tautulli's media type, to the kind of title it hangs off. */
const KIND_BY_MEDIA_TYPE: Record<string, TitleKind | undefined> = {
  episode: 'show',
  movie: 'movie',
};

/** A field Tautulli could not fill arrives as `""`, so empty is absent. */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/** Numbers arrive as strings. `Number('')` is 0, so emptiness is ruled out first. */
function digits(value: unknown): number | null {
  const raw = text(value);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundOrNull(value: number | null): number | null {
  return value === null ? null : Math.round(value);
}

function externalIds(payload: TautulliPayload): ExternalIds {
  const ids: ExternalIds = {};
  // For an episode these are the show's ids, not the episode's — measured,
  // and exactly what titleKey() takes.
  const tmdb = text(payload.themoviedb_id);
  const tvdb = text(payload.thetvdb_id);
  const imdb = text(payload.imdb_id);
  if (tmdb !== null) ids.tmdb = tmdb;
  if (tvdb !== null) ids.tvdb = tvdb;
  if (imdb !== null) ids.imdb = imdb;
  return ids;
}

/**
 * How far this play got, in the units the columns are named for.
 *
 * The two fields disagree about units inside one payload: `view_offset` is
 * milliseconds and `duration_sec` is seconds. Dividing one by the other
 * without converting is out by a thousand, which reads as a play that never
 * started.
 */
function progressOf(
  payload: TautulliPayload,
): Pick<PlannedPlay, 'durationSec' | 'viewOffsetSec' | 'percentComplete' | 'completed'> {
  // Rounded because the column is `integer`: a fractional duration would
  // plan cleanly and fail at insert, which is the worst place to find out.
  const duration = digits(payload.duration_sec);
  const durationSec = duration === null ? null : Math.round(duration);
  const offsetMs = digits(payload.view_offset);
  const viewOffsetSec = offsetMs === null ? null : Math.round(offsetMs / 1000);

  // Computed rather than taken from `{progress_percent}`, which Tautulli
  // rounds to whole percent: an 18 second stop in a 65 minute episode reports
  // 0, and a percentage that says a play never happened is the one value this
  // column must not hold. Tautulli's own figure is the fallback for a payload
  // that carries no duration.
  const measured =
    viewOffsetSec !== null && durationSec !== null && durationSec > 0
      ? (viewOffsetSec / durationSec) * 100
      : digits(payload.progress_percent);

  // An offset past the file's own duration is a rounding artefact, not a play
  // that ran over; the column means a percentage and is held to it.
  const percentComplete = measured === null ? null : Math.min(100, Math.max(0, measured));

  return {
    durationSec,
    viewOffsetSec,
    percentComplete,
    // Null progress cannot be judged, and the safe direction is the one that
    // does not mark anything seen.
    completed: percentComplete !== null && percentComplete >= COMPLETION_THRESHOLD,
  };
}

type Identity =
  | { ok: true; kind: TitleKind; ids: ExternalIds; key: string; name: string }
  | { ok: false; reason: string };

/** Which title a playback trigger is about, keyed the way the record keys it. */
function identify(payload: TautulliPayload): Identity {
  const mediaType = text(payload.media_type);
  const kind = mediaType === null ? undefined : KIND_BY_MEDIA_TYPE[mediaType];
  // Music and clips share this webhook and have no place in this record.
  if (kind === undefined) {
    return { ok: false, reason: `unsupported media type: ${mediaType ?? '(absent)'}` };
  }

  const ids = externalIds(payload);
  const key = titleKey({ kind, ids });
  // Identity is the canonical source alone. An unkeyable play is reported
  // rather than stored under whichever id happened to arrive.
  if (key === null) {
    return { ok: false, reason: `no ${kind === 'show' ? 'tvdb' : 'tmdb'} id` };
  }

  // `episode_name` holds a film's own title, so it is a fallback for a movie
  // rather than a sign that this is an episode.
  const name =
    kind === 'show' ? text(payload.show_name) : (text(payload.title) ?? text(payload.episode_name));
  if (name === null) return { ok: false, reason: 'no title name' };

  return { ok: true, kind, ids, key, name };
}

/**
 * An episode's place in its show. Gated on the kind, never on whether these
 * arrived: on a film they are the string "0" rather than empty, and a parser
 * testing for presence mints a phantom S0E0 for every movie.
 */
function placeOf(payload: TautulliPayload): { season: number; number: number } | null {
  const season = digits(payload.season_num);
  const number = digits(payload.episode_num);
  if (
    season === null ||
    number === null ||
    !Number.isInteger(season) ||
    !Number.isInteger(number)
  ) {
    return null;
  }
  return { season, number };
}

/**
 * Turns one Tautulli Playback Stop into the rows it implies.
 *
 * Pure: no database, no network, no clock.
 *
 * Every play it can parse is planned, including one that stopped seconds in.
 * A partial play is a fact like any other, `watch_state.seen` is `bool_or` over
 * `completed` so it marks nothing watched, and the offset it carries is the
 * thing the nightly library walk can never report.
 */
export function planTautulliPlay(payload: TautulliPayload): TautulliPlan {
  const identity = identify(payload);
  if (!identity.ok) return identity;
  const { kind, ids, key, name } = identity;

  // Refused rather than dated from the clock, because the instant is half of
  // the event id: without it every redelivery of one stop would mint a new id
  // and land as another row in a table whose whole value is that it does not
  // duplicate. `{unixtime}` is a template field, so it is present for every
  // play or for none, and a missing one is a body to fix rather than a play
  // to guess at. The nightly library walk catches what this refuses.
  const at = digits(payload.unixtime);
  if (at === null || at <= 0) return { ok: false, reason: 'no unixtime' };
  const watchedAt = new Date(at * 1000);

  const title: PlannedPlayTitle = {
    key,
    kind,
    ids,
    name,
    // Only for a film. Tautulli's `{year}` is the release year of the thing
    // played, so on an episode it is that episode's air year — storing it as
    // the show's would date a series by whichever episode was watched first.
    // Left null for the library walk, which reads the show's own row.
    year: kind === 'movie' ? roundOrNull(digits(payload.year)) : null,
  };

  const progress = progressOf(payload);
  const common: Omit<PlannedPlay, 'sourceEventId' | 'season' | 'number'> = {
    titleKey: key,
    watchedAt,
    // Never `unknown`: a unix timestamp is an instant, and the check
    // constraint ties the two together anyway.
    watchedPrecision: 'exact',
    ...progress,
    accountId: text(payload.user_id),
    player: text(payload.player),
    platform: text(payload.platform),
    raw: payload,
  };

  // The instant is part of the id because this source is play-grained: a
  // rewatch next month is a second viewing and must not collapse onto the
  // first, while a duplicate delivery of one stop carries the same second and
  // does. Keyed on canonical identity rather than `{rating_key}`, which is
  // ephemeral and changes when the media is deleted and re-added.
  //
  // The viewer is in it too. The allowlist is a list, so two people the
  // record is kept for could stop the same episode in the same second, and
  // without this the second one is silently dropped as a duplicate of the
  // first — an unrecoverable loss dressed as idempotency.
  const occurrence = `${common.accountId ?? 'unknown'}@${at}`;

  if (kind === 'movie') {
    return {
      ok: true,
      title,
      episode: null,
      play: { ...common, sourceEventId: `${key}@${occurrence}`, season: null, number: null },
    };
  }

  const place = placeOf(payload);
  if (place === null) return { ok: false, reason: 'episode has no season or number' };
  const { season, number } = place;

  const slot = episodeKey({ title: { kind, ids }, season, episode: number });
  // Unreachable while the title keyed, and cheaper to satisfy than to explain.
  if (slot === null) return { ok: false, reason: 'no tvdb id' };

  return {
    ok: true,
    title,
    episode: { titleKey: key, season, number, name: text(payload.episode_name) },
    play: { ...common, sourceEventId: `${slot}@${occurrence}`, season, number },
  };
}

/**
 * The triggers this receiver knows, as `{action}` spells them: the trigger's
 * name without its `on_`, so Playback Start arrives as `play`. Every one but
 * `intdown` is a playback trigger and carries the session's fields; `intdown`
 * is the server becoming unreachable, and carries no session at all.
 */
export const TAUTULLI_ACTIONS = [
  'play',
  'stop',
  'pause',
  'resume',
  'error',
  'change',
  'buffer',
  'intro',
  'commercial',
  'credits',
  'watched',
  'intdown',
] as const;

export type TautulliAction = (typeof TAUTULLI_ACTIONS)[number];

export type ActionReading =
  | { known: true; action: TautulliAction }
  | { known: false; action: string };

function isTautulliAction(value: string): value is TautulliAction {
  return (TAUTULLI_ACTIONS as readonly string[]).includes(value);
}

/**
 * Which trigger a body came from.
 *
 * A body with no `{action}` at all is read as a stop, the only trigger such a
 * body can safely mean. One whose `{action}` arrived and cannot be read is not:
 * it is some other trigger, and a stop is the one reading that writes a row.
 */
export function readAction(payload: TautulliPayload): ActionReading {
  if (payload.action === undefined) return { known: true, action: 'stop' };
  const action = text(payload.action);
  if (action === null) return { known: false, action: '(unreadable)' };
  return isTautulliAction(action) ? { known: true, action } : { known: false, action };
}

export type LiveReading = { ok: true; event: LiveEvent } | { ok: false; reason: string };

/** A count Tautulli reports, which is only a count if it is a whole number. */
function count(value: unknown): number | null {
  const parsed = digits(value);
  return parsed !== null && Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * One trigger, as a change to what is live.
 *
 * Pure, like the play's plan. A stop is read here as well as planned as a
 * play: this says the session ended, the plan says what it added to the
 * record.
 */
export function readLiveEvent(action: TautulliAction, payload: TautulliPayload): LiveReading {
  const unixtime = digits(payload.unixtime);
  if (unixtime === null || unixtime <= 0) return { ok: false, reason: 'no unixtime' };
  const at = unixtime * 1000;

  if (action === 'intdown') return { ok: true, event: { kind: 'server-down', at } };

  const sessionKey = text(payload.session_key);
  if (sessionKey === null) return { ok: false, reason: 'no session key' };
  const viewer = text(payload.user_id);
  if (viewer === null) return { ok: false, reason: 'no viewer' };

  // `{user_streams}` counts the viewer's live sessions, and leaves the
  // session out only on a stop: Tautulli filters it from the count for
  // `on_stop` alone, to avoid racing its own database. Every other trigger,
  // an error included, counts it.
  const streams = count(payload.user_streams);
  const othersLive =
    streams === null ? null : action === 'stop' ? streams : Math.max(streams - 1, 0);

  if (action === 'stop' || action === 'error') {
    return { ok: true, event: { kind: 'end', sessionKey, viewer, at, othersLive } };
  }

  const identity = identify(payload);
  if (!identity.ok) return identity;

  let episode: LiveSession['episode'] = null;
  if (identity.kind === 'show') {
    const place = placeOf(payload);
    if (place === null) return { ok: false, reason: 'episode has no season or number' };
    episode = { ...place, name: text(payload.episode_name) };
  }

  // Milliseconds beside seconds again, as in the play's progress.
  const durationSec = digits(payload.duration_sec);
  const offsetMs = digits(payload.view_offset);
  const remainingSec =
    digits(payload.remaining_duration_sec) ??
    (durationSec !== null && offsetMs !== null ? durationSec - offsetMs / 1000 : null);

  return {
    ok: true,
    event: {
      kind: 'update',
      action,
      session: {
        sessionKey,
        viewer,
        titleKey: identity.key,
        kind: identity.kind,
        name: identity.name,
        episode,
        offsetMs: offsetMs === null ? 0 : Math.max(offsetMs, 0),
        durationMs: durationSec === null || durationSec <= 0 ? null : durationSec * 1000,
        at,
      },
      remainingSec,
      othersLive,
    },
  };
}
