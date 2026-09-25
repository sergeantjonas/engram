import { describe, expect, it } from 'vitest';
import {
  COMPLETION_THRESHOLD,
  planTautulliPlay,
  readAction,
  readLiveEvent,
  type TautulliPayload,
} from './tautulli.js';

/**
 * A payload with fields knocked out, the way Tautulli actually sends them.
 *
 * `undefined` deletes rather than assigns: a parameter Tautulli cannot fill
 * arrives as `""`, and a key that is genuinely absent is a different case
 * worth testing separately.
 */
const knockOut = (
  base: Record<string, unknown>,
  over: Record<string, unknown>,
): TautulliPayload => {
  const row = { ...base };
  for (const [field, value] of Object.entries(over)) {
    if (value === undefined) delete row[field];
    else row[field] = value;
  }
  return row;
};

/** One of the payloads captured from the live install on 2026-09-21, verbatim. */
const episode = (over: Record<string, unknown> = {}): TautulliPayload =>
  knockOut(
    {
      media_type: 'episode',
      title: 'House of the Dragon - The Heirs of the Dragon',
      show_name: 'House of the Dragon',
      episode_name: 'The Heirs of the Dragon',
      season_num: '1',
      episode_num: '1',
      year: '2022',
      themoviedb_id: '94997',
      thetvdb_id: '371572',
      imdb_id: 'tt11198330',
      guid: 'plex://episode/5e160ed4e68804001e87a7bb',
      rating_key: '717',
      grandparent_rating_key: '460',
      duration_sec: '3938',
      view_offset: '18000',
      progress_percent: '0',
      user_id: '7597797',
      player: 'Firefox',
      platform: 'Firefox',
      unixtime: '1790018788',
    },
    over,
  );

/** The same, for a film: note `season_num` is "0" rather than empty. */
const film = (over: Record<string, unknown> = {}): TautulliPayload =>
  knockOut(
    {
      media_type: 'movie',
      title: 'Sinners',
      show_name: '',
      episode_name: 'Sinners',
      season_num: '0',
      episode_num: '0',
      year: '2025',
      themoviedb_id: '1311031',
      thetvdb_id: '357931',
      imdb_id: 'tt32820897',
      rating_key: '1043',
      grandparent_rating_key: '',
      duration_sec: '9301',
      view_offset: '502000',
      progress_percent: '5',
      user_id: '7597797',
      player: 'Chrome',
      platform: 'Chrome',
      unixtime: '1790018788',
    },
    over,
  );

const planned = (payload: TautulliPayload) => {
  const plan = planTautulliPlay(payload);
  if (!plan.ok) throw new Error(`expected a plan, got: ${plan.reason}`);
  return plan;
};

describe('planTautulliPlay', () => {
  it('plans an episode from the payload Tautulli actually sends', () => {
    const { title, episode: slot, play } = planned(episode());

    expect(title).toEqual({
      key: 'show:tvdb:371572',
      kind: 'show',
      ids: { tmdb: '94997', tvdb: '371572', imdb: 'tt11198330' },
      name: 'House of the Dragon',
      year: null,
    });
    expect(slot).toEqual({
      titleKey: 'show:tvdb:371572',
      season: 1,
      number: 1,
      name: 'The Heirs of the Dragon',
    });
    expect(play).toMatchObject({
      sourceEventId: 'show:tvdb:371572/s01e0001@7597797@1790018788',
      titleKey: 'show:tvdb:371572',
      season: 1,
      number: 1,
      watchedAt: new Date(1790018788 * 1000),
      watchedPrecision: 'exact',
      accountId: '7597797',
      player: 'Firefox',
      platform: 'Firefox',
    });
  });

  // The ids on an episode payload are the show's, which is what titleKey takes.
  // Keying on the episode's own would make every episode a separate series.
  it('keys an episode on the show, not on the episode', () => {
    expect(planned(episode()).title.key).toBe('show:tvdb:371572');
  });

  it('plans a film, keyed on tmdb rather than tvdb', () => {
    const { title, episode: slot, play } = planned(film());

    expect(title).toMatchObject({ key: 'movie:tmdb:1311031', kind: 'movie', name: 'Sinners' });
    expect(slot).toBeNull();
    expect(play).toMatchObject({
      sourceEventId: 'movie:tmdb:1311031@7597797@1790018788',
      season: null,
      number: null,
    });
  });

  // `season_num` is the string "0" on a film, not empty. A parser testing for
  // presence mints a phantom S0E0 for every movie ever played.
  it('mints no episode for a film whose season and episode arrive as "0"', () => {
    const plan = planned(film({ season_num: '0', episode_num: '0' }));
    expect(plan.episode).toBeNull();
    expect(plan.play.season).toBeNull();
    expect(plan.play.number).toBeNull();
  });

  // `view_offset` is milliseconds and `duration_sec` is seconds, inside one
  // payload. Dividing without converting is out by a thousand.
  it('converts the offset to seconds before comparing it to the duration', () => {
    const { play } = planned(film());
    expect(play.viewOffsetSec).toBe(502);
    expect(play.durationSec).toBe(9301);
    expect(play.percentComplete).toBeCloseTo(5.397, 2);
  });

  // Tautulli rounds `{progress_percent}` to whole percent, so a real play
  // reports 0 and the column would claim it never started.
  it('measures the percentage rather than trusting Tautulli rounding it to 0', () => {
    const { play } = planned(episode());
    expect(play.percentComplete).toBeCloseTo(0.457, 3);
    expect(play.percentComplete).toBeGreaterThan(0);
  });

  it('falls back to Tautulli percentage when the payload carries no duration', () => {
    const { play } = planned(episode({ duration_sec: '', progress_percent: '64' }));
    expect(play.percentComplete).toBe(64);
  });

  it('marks a play complete once it passes the threshold', () => {
    const { play } = planned(episode({ view_offset: '3600000' }));
    expect(play.percentComplete).toBeGreaterThanOrEqual(COMPLETION_THRESHOLD);
    expect(play.completed).toBe(true);
  });

  // The measured payload stopped 18 seconds into a 65 minute episode: a fact
  // worth storing, and not a watch. `watch_state.seen` is bool_or over this.
  it('stores a play that stopped seconds in, without calling it watched', () => {
    const { play } = planned(episode());
    expect(play.completed).toBe(false);
  });

  it('marks a play complete through the Tautulli percentage too', () => {
    const { play } = planned(episode({ duration_sec: '', progress_percent: '95' }));
    expect(play.completed).toBe(true);
  });

  it('judges nothing complete when the payload reports no progress at all', () => {
    const { play } = planned(episode({ duration_sec: '', view_offset: '', progress_percent: '' }));
    expect(play.percentComplete).toBeNull();
    expect(play.completed).toBe(false);
  });

  // An offset past the file's own duration is a rounding artefact, not a play
  // that ran over.
  it('holds the percentage to being one', () => {
    const { play } = planned(film({ view_offset: '9999000' }));
    expect(play.percentComplete).toBe(100);
  });

  // Tautulli's `{year}` is the release year of the thing played, so on an
  // episode it dates that episode rather than the series.
  it('rounds to whole seconds, because the column is an integer', () => {
    const { play } = planned(film({ duration_sec: '9301.6' }));
    expect(play.durationSec).toBe(9302);
  });

  it('takes a year from a film and never from an episode', () => {
    expect(planned(film()).title.year).toBe(2025);
    expect(planned(episode({ year: '2022' })).title.year).toBeNull();
  });

  it('names a film from its title, falling back to the episode name Tautulli reuses', () => {
    expect(planned(film({ title: '' })).title.name).toBe('Sinners');
  });

  // Play-grained: a rewatch is a second viewing, and a duplicate delivery of
  // one stop is not.
  it('gives a rewatch its own id and a redelivery the same one', () => {
    const first = planned(episode()).play.sourceEventId;
    const again = planned(episode()).play.sourceEventId;
    const later = planned(episode({ unixtime: '1790105188' })).play.sourceEventId;

    expect(again).toBe(first);
    expect(later).not.toBe(first);
  });

  // Ephemeral by design: delete the media and re-add it and every ratingKey
  // changes, so none of them belong in an id that has to stay stable.
  it('builds that id from canonical identity, not from the Plex rating key', () => {
    expect(planned(episode({ rating_key: '999999' })).play.sourceEventId).toBe(
      planned(episode()).play.sourceEventId,
    );
  });

  // Half the event id. Dating it from the clock instead would mint a fresh
  // id per delivery and duplicate the row it was supposed to collapse onto.
  it('refuses a play with no instant rather than dating it from the clock', () => {
    expect(planTautulliPlay(episode({ unixtime: undefined }))).toEqual({
      ok: false,
      reason: 'no unixtime',
    });
    expect(planTautulliPlay(episode({ unixtime: '0' }))).toEqual({
      ok: false,
      reason: 'no unixtime',
    });
  });

  // The allowlist is a list, so the same episode can be stopped by two people
  // the record is kept for in the same second.
  it('tells two viewers of one episode apart in the same second', () => {
    const mine = planned(episode()).play.sourceEventId;
    const theirs = planned(episode({ user_id: '49291007' })).play.sourceEventId;
    expect(theirs).not.toBe(mine);
  });

  it('keeps the whole payload, so a parser change stays re-derivable', () => {
    const payload = episode();
    expect(planned(payload).play.raw).toEqual(payload);
  });

  it('refuses a show with no tvdb id rather than keying it on tmdb', () => {
    const plan = planTautulliPlay(episode({ thetvdb_id: '' }));
    expect(plan).toEqual({ ok: false, reason: 'no tvdb id' });
  });

  it('refuses a film with no tmdb id rather than keying it on tvdb', () => {
    const plan = planTautulliPlay(film({ themoviedb_id: '' }));
    expect(plan).toEqual({ ok: false, reason: 'no tmdb id' });
  });

  it('refuses a media type this record has no place for', () => {
    const plan = planTautulliPlay(episode({ media_type: 'track' }));
    expect(plan).toEqual({ ok: false, reason: 'unsupported media type: track' });
  });

  it('refuses a body whose media type never arrived', () => {
    const plan = planTautulliPlay(episode({ media_type: undefined }));
    expect(plan).toEqual({ ok: false, reason: 'unsupported media type: (absent)' });
  });

  it('refuses an episode whose season or number did not arrive', () => {
    const plan = planTautulliPlay(episode({ episode_num: '' }));
    expect(plan).toEqual({ ok: false, reason: 'episode has no season or number' });
  });

  it('refuses an episode with no show name to store it under', () => {
    const plan = planTautulliPlay(episode({ show_name: '' }));
    expect(plan).toEqual({ ok: false, reason: 'no title name' });
  });
});

describe('readAction', () => {
  it('reads a body with no action as a stop', () => {
    expect(readAction(episode())).toEqual({ known: true, action: 'stop' });
  });

  // A stop is the one reading that writes a row, so an action that arrived
  // and cannot be read must not default to it.
  it('reads an action it cannot make out as unknown, never as a stop', () => {
    expect(readAction(episode({ action: '' }))).toEqual({ known: false, action: '(unreadable)' });
    expect(readAction(episode({ action: 1 }))).toEqual({ known: false, action: '(unreadable)' });
  });

  it('names a trigger the way Tautulli spells it', () => {
    expect(readAction(episode({ action: 'play' }))).toEqual({ known: true, action: 'play' });
    expect(readAction({ action: 'intdown' })).toEqual({ known: true, action: 'intdown' });
  });

  it('reports a trigger it does not know by name', () => {
    expect(readAction(episode({ action: 'concurrent' }))).toEqual({
      known: false,
      action: 'concurrent',
    });
  });
});

describe('readLiveEvent', () => {
  const live = (over: Record<string, unknown> = {}): TautulliPayload =>
    episode({
      session_key: '12',
      user_streams: '1',
      remaining_duration_sec: '3920',
      ...over,
    });

  it('reads a playback trigger as where the session is', () => {
    const reading = readLiveEvent('play', live());
    expect(reading).toMatchObject({
      ok: true,
      event: {
        kind: 'update',
        action: 'play',
        remainingSec: 3920,
        othersLive: 0,
        session: {
          sessionKey: '12',
          titleKey: 'show:tvdb:371572',
          kind: 'show',
          episode: { season: 1, number: 1 },
        },
      },
    });
  });

  it('reads a stop and an error both as the session ending', () => {
    for (const action of ['stop', 'error'] as const) {
      expect(readLiveEvent(action, live())).toMatchObject({
        ok: true,
        event: { kind: 'end', sessionKey: '12' },
      });
    }
  });

  // Tautulli leaves the stopping session out of its count on a stop, and on
  // nothing else.
  it('counts the other sessions the way each trigger reports them', () => {
    const others = (action: 'play' | 'stop' | 'error') => {
      const reading = readLiveEvent(action, live({ user_streams: '2' }));
      return reading.ok && reading.event.kind !== 'server-down' ? reading.event.othersLive : null;
    };
    expect(others('play')).toBe(1);
    expect(others('error')).toBe(1);
    expect(others('stop')).toBe(2);
  });

  it('reads a film as no episode, whatever its season and number say', () => {
    const reading = readLiveEvent('play', film({ session_key: '12' }));
    expect(reading).toMatchObject({
      ok: true,
      event: { session: { kind: 'movie', titleKey: 'movie:tmdb:1311031', episode: null } },
    });
  });

  it('works out the runtime left when the payload does not say', () => {
    const reading = readLiveEvent('play', live({ remaining_duration_sec: '' }));
    expect(reading.ok && reading.event.kind === 'update' && reading.event.remainingSec).toBe(
      3938 - 18,
    );
  });

  it('reads the server going down from a body that names no session', () => {
    expect(readLiveEvent('intdown', { action: 'intdown', unixtime: '1790018788' })).toEqual({
      ok: true,
      event: { kind: 'server-down', at: 1_790_018_788_000 },
    });
  });

  it('refuses a trigger with no session to key it on', () => {
    expect(readLiveEvent('play', live({ session_key: '' }))).toEqual({
      ok: false,
      reason: 'no session key',
    });
  });
});
