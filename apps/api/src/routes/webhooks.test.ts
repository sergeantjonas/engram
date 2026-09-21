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
  it('accepts a payload carrying the shared secret', async () => {
    const response = await post(good, { media_type: 'episode', show_name: 'Bleach' });
    expect(response.statusCode).toBe(204);
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
    const response = await post(good, { unexpected: 'shape', nested: { a: 1 } });
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
