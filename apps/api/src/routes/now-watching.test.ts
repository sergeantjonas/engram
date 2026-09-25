import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig } from '../app.fixture.js';
import { buildApp } from '../app.js';
import { sessionDb } from '../auth/session.fixture.js';
import { createLiveSessions } from '../live/sessions.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const UNIXTIME = 1_790_018_788;
/** Thirty seconds after the trigger, so a playing offset has moved. */
const NOW = UNIXTIME * 1000 + 30_000;

const owner = testConfig.TAUTULLI_USER_IDS[0];

const trigger = (over: Record<string, unknown> = {}) => ({
  token: testConfig.WEBHOOK_SECRET,
  action: 'play',
  session_key: '12',
  user_streams: '1',
  media_type: 'episode',
  show_name: 'House of the Dragon',
  episode_name: 'The Heirs of the Dragon',
  season_num: '1',
  episode_num: '1',
  themoviedb_id: '94997',
  thetvdb_id: '371572',
  imdb_id: 'tt11198330',
  duration_sec: '3938',
  view_offset: '18000',
  remaining_duration_sec: '3920',
  plex_url: 'https://app.plex.tv/desktop#!/server/abc/details?key=%2Flibrary%2Fmetadata%2F717',
  user_id: owner,
  player: 'Firefox',
  platform: 'Firefox',
  unixtime: String(UNIXTIME),
  ...over,
});

const start = (stub = sessionDb(null)) => {
  app = buildApp({
    config: testConfig,
    db: stub.db,
    tmdb: null,
    github: githubStub,
    live: createLiveSessions(() => NOW),
  });
  const send = (payload: object) =>
    app?.inject({
      method: 'POST',
      url: '/webhooks/tautulli',
      headers: { 'content-type': 'application/json' },
      payload,
    });
  const read = async () => {
    const response = await app?.inject({ method: 'GET', url: '/now-watching' });
    return { status: response?.statusCode, body: response?.json() };
  };
  return { stub, send, read };
};

const stored = {
  id: 'title-1',
  key: 'show:tvdb:371572',
  name: 'House of the Dragon',
  posterPath: '/poster.jpg',
  backdropPath: '/backdrop.jpg',
};

describe('GET /now-watching', () => {
  it('answers a stranger, and answers nothing when nothing plays', async () => {
    const { read } = start();
    expect(await read()).toEqual({ status: 200, body: { nowWatching: [] } });
  });

  it("answers what the owner is playing, with the record's name and artwork", async () => {
    const { stub, send, read } = start();
    await send(trigger());
    stub.selects = [[stored]];

    expect((await read()).body).toEqual({
      nowWatching: [
        {
          id: '12',
          kind: 'show',
          titleId: 'title-1',
          name: 'House of the Dragon',
          posterPath: '/poster.jpg',
          backdropPath: '/backdrop.jpg',
          episode: { season: 1, number: 1, name: 'The Heirs of the Dragon' },
          state: 'playing',
          offsetMs: 48_000,
          durationMs: 3_938_000,
        },
      ],
    });
  });

  // Its first stop is what stores it, so a first watch is live before it is
  // on record — and Plex's own artwork needs the token.
  it('answers a title the record does not hold with the name it was sent and no picture', async () => {
    const { stub, send, read } = start();
    await send(trigger({ show_name: 'Something New' }));
    stub.selects = [[]];

    expect((await read()).body.nowWatching[0]).toMatchObject({
      titleId: null,
      name: 'Something New',
      posterPath: null,
    });
  });

  // A link to the item names the server, and the answer is public.
  it('says nothing about the viewer, the player or the server', async () => {
    const { stub, send, read } = start();
    await send(trigger());
    stub.selects = [[stored]];

    const body = JSON.stringify((await read()).body);
    expect(body).not.toContain(owner);
    expect(body).not.toContain('Firefox');
    expect(body).not.toContain('app.plex.tv');
  });

  it('ends the session on its stop', async () => {
    const { stub, send, read } = start();
    await send(trigger());
    stub.returns = [[{ id: 'title-1' }], [{ id: 'event-1' }]];
    stub.selects = [[{ id: 'episode-1' }]];
    await send(trigger({ action: 'stop', user_streams: '0', unixtime: String(UNIXTIME + 20) }));

    expect((await read()).body).toEqual({ nowWatching: [] });
  });

  // Ahead of the write, so a stop the record cannot take still ends it.
  it('ends the session on a stop whose write fails', async () => {
    const { send, read } = start();
    await send(trigger());
    const stopped = await send(
      trigger({ action: 'stop', user_streams: '0', unixtime: String(UNIXTIME + 20) }),
    );
    expect(stopped?.statusCode).toBe(500);
    expect((await read()).body).toEqual({ nowWatching: [] });
  });

  // The server trigger is answered before the viewer check, since it names
  // none, and still has to reach what is live.
  it('ends every session when the server goes down', async () => {
    const { send, read } = start();
    await send(trigger());
    await send({
      token: testConfig.WEBHOOK_SECRET,
      action: 'intdown',
      unixtime: String(UNIXTIME + 20),
    });
    expect((await read()).body).toEqual({ nowWatching: [] });
  });

  it('shows nothing a housemate plays', async () => {
    const { send, read } = start();
    await send(trigger({ user_id: '49291007' }));
    expect((await read()).body).toEqual({ nowWatching: [] });
  });
});
