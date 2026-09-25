import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig } from '../app.fixture.js';
import { buildApp } from '../app.js';
import { sessionDb } from '../auth/session.fixture.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const post = async (
  headers: Record<string, string>,
  payload: unknown,
  stub: ReturnType<typeof sessionDb> = sessionDb(),
) => {
  app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
  return app.inject({
    method: 'POST',
    url: '/webhooks/tautulli',
    headers: { 'content-type': 'application/json', ...headers },
    payload: payload as object,
  });
};

const good = { 'x-engram-token': testConfig.WEBHOOK_SECRET };

/** The title's row and the event's, the two inserts that ask for one back. */
const storing = () => {
  const stub = sessionDb();
  stub.returns = [[{ id: 'title-1' }], [{ id: 'event-1' }]];
  stub.selects = [[{ id: 'episode-1' }]];
  return stub;
};

describe('POST /webhooks/tautulli', () => {
  const owner = testConfig.TAUTULLI_USER_IDS[0];

  /** A payload complete enough to plan, shaped like the measured one. */
  const play = (over: Record<string, unknown> = {}) => ({
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
    user_id: owner,
    player: 'Firefox',
    platform: 'Firefox',
    unixtime: '1790018788',
    ...over,
  });

  it('accepts a payload carrying the shared secret in a header', async () => {
    const response = await post(good, {
      media_type: 'episode',
      show_name: 'Bleach',
      user_id: owner,
    });
    expect(response.statusCode).toBe(204);
  });

  // Tautulli's webhook agent sends a URL, a method and a JSON body — there is
  // no field for a custom header, so the token has to travel in the payload.
  it('accepts the secret in the body, which is all Tautulli can send', async () => {
    const response = await post(
      {},
      { token: testConfig.WEBHOOK_SECRET, media_type: 'movie', title: 'Dune', user_id: owner },
    );
    expect(response.statusCode).toBe(204);
  });

  it('refuses a wrong secret in the body', async () => {
    const response = await post({}, { token: 'nope', media_type: 'movie' });
    expect(response.statusCode).toBe(401);
  });

  // A rejection that logs nothing cannot be told apart from a body that
  // never parsed, which is exactly the hole the first live attempt fell in.
  it('says enough about a rejection to diagnose it, and no more', async () => {
    const logged: unknown[] = [];
    const stub = sessionDb();
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    app.addHook('onRequest', (request, _reply, done) => {
      request.log.warn = ((obj: unknown) => {
        logged.push(obj);
      }) as typeof request.log.warn;
      done();
    });

    await app.inject({
      method: 'POST',
      url: '/webhooks/tautulli',
      headers: { 'content-type': 'application/json' },
      payload: { token: 'short', media_type: 'movie' },
    });

    expect(logged).toEqual([
      expect.objectContaining({
        tokenSource: 'body',
        offeredLength: 5,
        expectedLength: testConfig.WEBHOOK_SECRET.length,
      }),
    ]);
    // Lengths, never the value — of either side.
    expect(JSON.stringify(logged)).not.toContain(testConfig.WEBHOOK_SECRET);
    expect(JSON.stringify(logged)).not.toContain('short');
  });

  it('stores the play it planned', async () => {
    const stub = storing();
    const response = await post(good, play(), stub);

    expect(response.statusCode).toBe(204);
    const event = stub.inserted.at(-1)?.values as Record<string, unknown>;
    expect(event).toMatchObject({
      source: 'tautulli',
      sourceEventId: 'show:tvdb:371572/s01e0001@7597797@1790018788',
      episodeId: 'episode-1',
      completed: false,
      accountId: '7597797',
    });
  });

  // The whole reason the secret is in the body rather than the query string
  // is to keep it out of logs, which this handler would undo by writing the
  // body to one.
  it('keeps the token out of what it logs', async () => {
    const logged: unknown[] = [];
    const stub = storing();
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    app.addHook('onRequest', (request, _reply, done) => {
      request.log.info = ((obj: unknown) => {
        logged.push(obj);
      }) as typeof request.log.info;
      done();
    });

    await app.inject({
      method: 'POST',
      url: '/webhooks/tautulli',
      headers: { 'content-type': 'application/json' },
      payload: { ...play(), token: testConfig.WEBHOOK_SECRET },
    });

    // The handler's own line, and only it. Replacing `log.info` wholesale
    // bypasses Fastify's serialisers, so its response line hands the test the
    // raw request object with the body still on it — an artefact of the stub
    // rather than anything the running server writes.
    const mine = logged.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && 'title' in entry,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'show:tvdb:371572', completed: false, written: true });
    expect(JSON.stringify(mine)).not.toContain(testConfig.WEBHOOK_SECRET);
    // `raw` keeps the whole body, so the strip is the only thing between the
    // secret and a column that outlives every log file.
    expect(JSON.stringify(stub.inserted.map((i) => i.values))).not.toContain(
      testConfig.WEBHOOK_SECRET,
    );
  });

  // Accepted rather than refused: Tautulli logs a non-2xx as a failed
  // notification and retries nothing, so a 4xx would mark the delivery bad
  // without getting the play back. The nightly walk is what recovers it.
  it('accepts a body it cannot plan, and says why without saying what', async () => {
    const logged: unknown[] = [];
    const stub = sessionDb();
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    app.addHook('onRequest', (request, _reply, done) => {
      request.log.warn = ((obj: unknown) => {
        logged.push(obj);
      }) as typeof request.log.warn;
      done();
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/tautulli',
      headers: { 'content-type': 'application/json', ...good },
      payload: play({ thetvdb_id: '', show_name: 'Something Private' }),
    });

    expect(response.statusCode).toBe(204);
    expect(logged).toEqual([
      expect.objectContaining({ reason: 'no tvdb id', keys: expect.any(Array) }),
    ]);
    // Field names, never values: a body this could not read is still a
    // record of what somebody watched.
    expect(JSON.stringify(logged)).not.toContain('Something Private');
  });

  it('writes nothing for a body it cannot plan', async () => {
    const stub = sessionDb();
    await post(good, play({ thetvdb_id: '' }), stub);
    expect(stub.inserted).toEqual([]);
  });

  // It has no cookie jar, so the secret is the whole of its authentication.
  it('refuses a payload with no secret', async () => {
    const response = await post({}, { media_type: 'episode' });
    expect(response.statusCode).toBe(401);
  });

  it('refuses a wrong secret, and says nothing about why', async () => {
    const response = await post({ 'x-engram-token': 'not-the-secret' }, { media_type: 'episode' });
    expect(response.statusCode).toBe(401);
    // A sender that guessed the route and one that got the secret wrong
    // should learn the same amount.
    expect(response.json()).toEqual({ error: 'unauthorized' });
  });

  // `timingSafeEqual` throws on a length mismatch rather than returning
  // false, which is how the OAuth state verifier once passed for the wrong
  // reason. A short secret must be refused, not crash the route.
  it('refuses a secret of the wrong length without erroring', async () => {
    const response = await post({ 'x-engram-token': 'x' }, { media_type: 'movie' });
    expect(response.statusCode).toBe(401);
  });

  // The recording phase interprets nothing, so a body it cannot make sense
  // of still has to be accepted — finding out what arrives is the job.
  it('accepts a body it cannot interpret', async () => {
    const response = await post(good, { unexpected: 'shape', nested: { a: 1 }, user_id: owner });
    expect(response.statusCode).toBe(204);
  });

  // The server is shared. A housemate's viewing must not reach this record,
  // and a log line is a record of what they watched just as much as a row.
  it('records nothing about a viewer who is not on the allowlist', async () => {
    const logged: unknown[] = [];
    const stub = sessionDb();
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    app.addHook('onRequest', (request, _reply, done) => {
      request.log.info = ((obj: unknown) => {
        logged.push(obj);
      }) as typeof request.log.info;
      done();
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/tautulli',
      headers: { 'content-type': 'application/json', ...good },
      // A real id from the same server, and not the owner's. Complete enough
      // to plan, or the parser would refuse it first and this would pass with
      // the viewer check deleted.
      payload: play({ user_id: '49291007', show_name: 'Something Private' }),
    });

    // Accepted rather than refused: Tautulli logs a non-2xx as a failed
    // notification, and a housemate watching something is not a failure.
    expect(response.statusCode).toBe(204);
    // The handler's own lines. Fastify's request and response lines go
    // through its serialisers, which emit a method and a status code and
    // never a body — these are the lines that could have written down what
    // somebody else watched.
    const mine = logged.filter(
      (entry): entry is Record<string, unknown> =>
        typeof entry === 'object' && entry !== null && 'viewer' in entry,
    );
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain('Something Private');
    expect(mine[0]).toMatchObject({ viewer: '49291007', mediaType: 'episode' });
    // The part that matters: not a row, not just not a log line.
    expect(stub.inserted).toEqual([]);
  });

  it('keeps out a payload with no viewer at all', async () => {
    const stub = sessionDb();
    const response = await post(good, play({ user_id: undefined }), stub);
    expect(response.statusCode).toBe(204);
    expect(stub.inserted).toEqual([]);
  });

  // An unconfigured allowlist allows nobody. A write path opened by omission
  // is the one failure this cannot afford.
  it('allows nobody when the allowlist is empty', async () => {
    const stub = sessionDb();
    app = buildApp({
      config: { ...testConfig, TAUTULLI_USER_IDS: [] },
      db: stub.db,
      tmdb: null,
      github: githubStub,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/tautulli',
      headers: { 'content-type': 'application/json', ...good },
      payload: play(),
    });
    expect(response.statusCode).toBe(204);
    expect(stub.inserted).toEqual([]);
  });

  it('writes nothing for a playback trigger that is not a stop', async () => {
    const stub = storing();
    const response = await post(good, play({ action: 'play' }), stub);
    expect(response.statusCode).toBe(204);
    expect(stub.inserted).toEqual([]);
  });

  it('records a stop that names itself as one', async () => {
    const stub = storing();
    await post(good, play({ action: 'stop' }), stub);
    expect(stub.inserted.at(-1)?.values).toMatchObject({ source: 'tautulli' });
  });

  it('ignores an action it does not know, and names it', async () => {
    const logged: unknown[] = [];
    const stub = storing();
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    app.addHook('onRequest', (request, _reply, done) => {
      request.log.warn = ((obj: unknown) => {
        logged.push(obj);
      }) as typeof request.log.warn;
      done();
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/tautulli',
      headers: { 'content-type': 'application/json', ...good },
      payload: play({ action: 'concurrent' }),
    });

    expect(response.statusCode).toBe(204);
    expect(logged).toEqual([{ action: 'concurrent' }]);
    expect(stub.inserted).toEqual([]);
  });

  // A server trigger carries no `{user_id}`, so it would never pass the
  // viewer check — and it names nothing anybody watched.
  it('accepts the server going down, which names no viewer', async () => {
    const logged: unknown[] = [];
    const stub = sessionDb();
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    app.addHook('onRequest', (request, _reply, done) => {
      request.log.info = ((obj: unknown) => {
        logged.push(obj);
      }) as typeof request.log.info;
      done();
    });

    const response = await app.inject({
      method: 'POST',
      url: '/webhooks/tautulli',
      headers: { 'content-type': 'application/json', ...good },
      payload: { action: 'intdown', unixtime: '1790018788' },
    });

    expect(response.statusCode).toBe(204);
    expect(logged).toContainEqual({ action: 'intdown' });
    expect(logged).not.toContainEqual(expect.objectContaining({ viewer: null }));
    expect(stub.inserted).toEqual([]);
  });

  it('asks the server trigger for the secret like any other', async () => {
    const response = await post({}, { action: 'intdown' });
    expect(response.statusCode).toBe(401);
  });

  // The viewer check sits above every line that names a trigger, so a
  // housemate pausing is not written down as one either — known or not.
  it('says nothing about what a housemate did', async () => {
    const logged: unknown[] = [];
    const stub = sessionDb();
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    app.addHook('onRequest', (request, _reply, done) => {
      const keep = ((obj: unknown) => {
        logged.push(obj);
      }) as typeof request.log.info;
      request.log.info = keep;
      request.log.warn = keep;
      done();
    });

    for (const action of ['pause', 'concurrent']) {
      await app.inject({
        method: 'POST',
        url: '/webhooks/tautulli',
        headers: { 'content-type': 'application/json', ...good },
        payload: play({ action, user_id: '49291007' }),
      });
    }

    expect(logged).not.toContainEqual(expect.objectContaining({ action: expect.anything() }));
  });

  it('is not reachable without the secret even though the guard opens it', async () => {
    // The guard lets this route past the session check by pattern, so the
    // handler's own check is the only thing left; a regression there would
    // open a write path to anyone.
    const response = await post({}, {});
    expect(response.statusCode).toBe(401);
  });
});
