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

const post = async (headers: Record<string, string>, payload: unknown) => {
  const stub = sessionDb();
  app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
  return app.inject({
    method: 'POST',
    url: '/webhooks/tautulli',
    headers: { 'content-type': 'application/json', ...headers },
    payload: payload as object,
  });
};

const good = { 'x-engram-token': testConfig.WEBHOOK_SECRET };

describe('POST /webhooks/tautulli', () => {
  const owner = testConfig.TAUTULLI_USER_IDS[0];

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

  // The whole reason it is in the body rather than the query string is to
  // keep it out of logs, which this handler would undo by logging the body.
  it('keeps the token out of what it logs', async () => {
    const logged: unknown[] = [];
    const stub = sessionDb();
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
      payload: { token: testConfig.WEBHOOK_SECRET, media_type: 'movie', user_id: owner },
    });

    // The handler's own line. Fastify's request and response lines go
    // through its serialisers, which emit a status code and a method and
    // never a body — this asserts the one place a body is deliberately
    // written, which is the place that could leak the token.
    const mine = logged.filter(
      (entry): entry is { tautulli: unknown } =>
        typeof entry === 'object' && entry !== null && 'tautulli' in entry,
    );
    expect(mine).toHaveLength(1);
    expect(JSON.stringify(mine)).not.toContain(testConfig.WEBHOOK_SECRET);
    expect(JSON.stringify(mine)).toContain('movie');
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
      // A real id from the same server, and not the owner's.
      payload: { media_type: 'episode', show_name: 'Something Private', user_id: '49291007' },
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
  });

  it('keeps out a payload with no viewer at all', async () => {
    const response = await post(good, { media_type: 'episode', show_name: 'Bleach' });
    expect(response.statusCode).toBe(204);
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
      payload: { media_type: 'episode', user_id: owner },
    });
    expect(response.statusCode).toBe(204);
  });

  it('is not reachable without the secret even though the guard opens it', async () => {
    // The guard lets this route past the session check by pattern, so the
    // handler's own check is the only thing left; a regression there would
    // open a write path to anyone.
    const response = await post({}, {});
    expect(response.statusCode).toBe(401);
  });
});
