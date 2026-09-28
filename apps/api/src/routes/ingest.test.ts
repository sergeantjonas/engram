import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig } from '../app.fixture.js';
import { buildApp } from '../app.js';
import { sessionDb } from '../auth/session.fixture.js';
import type { Config } from '../config.js';

let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const bearer = { authorization: `Bearer ${testConfig.INGEST_SECRET}` };

const post = async (
  headers: Record<string, string>,
  payload: unknown,
  stub: ReturnType<typeof sessionDb> = sessionDb(null),
  config: Config = testConfig,
) => {
  app = buildApp({ config, db: stub.db, tmdb: null, github: githubStub });
  return app.inject({
    method: 'POST',
    url: '/ingest/plex-library',
    headers: { 'content-type': 'application/json', ...headers },
    payload: payload as object,
  });
};

/** One unwatched film, which is a title and its presence and nothing else. */
const walk = (over: Record<string, unknown> = {}) => ({
  server: 'it is a secret to everyone',
  machineIdentifier: testConfig.PLEX_SERVER_ID,
  summary: { items: 1 },
  sections: [
    {
      key: '2',
      type: 'movie',
      title: 'Movies',
      items: [{ ratingKey: '900', title: 'Dune', year: 2021, Guid: [{ id: 'tmdb://438631' }] }],
    },
  ],
  ...over,
});

/** The film's row back from its upsert, and no event already held. */
const storing = () => {
  const stub = sessionDb(null);
  stub.returns = [[{ id: 'title-1' }]];
  stub.selects = [[]];
  return stub;
};

describe('POST /ingest/plex-library', () => {
  it('stores a whole walk and answers what it wrote', async () => {
    const stub = storing();
    const response = await post(bearer, walk(), stub);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      titles: 1,
      episodes: 0,
      events: 0,
      fresh: 0,
      present: 1,
      gone: 0,
      dropped: [],
      incomplete: [],
    });
    expect(stub.inserted[0]?.values).toMatchObject({ key: 'movie:tmdb:438631' });
  });

  // Fastify's default limit is 1 MiB, and this library's walk is already
  // twice that. Refused there, the walk would fail every night and say only
  // that the body was too large.
  it('takes a walk larger than the default body limit', async () => {
    const stub = storing();
    const large = walk();
    const film = large.sections[0]?.items[0];
    if (film) Object.assign(film, { summary: 'x'.repeat(2 * 1024 * 1024) });

    const response = await post(bearer, large, stub);
    expect(response.statusCode).toBe(200);
  });

  it('refuses a caller without the ingest secret, and writes nothing', async () => {
    const stub = storing();
    const response = await post({}, walk(), stub);

    expect(response.statusCode).toBe(401);
    expect(stub.inserted).toEqual([]);
  });

  // Held apart so either can be rotated without the other.
  it('refuses the webhook secret in its place', async () => {
    const response = await post({ authorization: `Bearer ${testConfig.WEBHOOK_SECRET}` }, walk());
    expect(response.statusCode).toBe(401);
  });

  // A body that is not even JSON: were it read before the secret, this would
  // be a 400, and a stranger could make the API parse sixteen megabytes.
  it('refuses a caller without the secret before reading the body', async () => {
    const response = await post({}, '{ not json');
    expect(response.statusCode).toBe(401);
  });

  it('answers 503 without a secret configured, and names nothing', async () => {
    const { INGEST_SECRET: _unset, ...config } = testConfig;
    const response = await post(bearer, walk(), sessionDb(null), config);

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      error: 'ingest_unavailable',
      message: 'library ingest is not configured',
    });
  });

  // Only a caller holding the secret learns which half is missing.
  it('answers 503 without a server configured, but only to the walker', async () => {
    const { PLEX_SERVER_ID: _unset, ...config } = testConfig;

    const walker = await post(bearer, walk(), sessionDb(null), config);
    expect(walker.statusCode).toBe(503);
    expect(walker.json().message).toMatch(/PLEX_SERVER_ID/);

    const stranger = await post({}, walk(), sessionDb(null), config);
    expect(stranger.statusCode).toBe(401);
  });

  it('refuses a body that is not a walk, and says where', async () => {
    const response = await post(bearer, walk({ summary: { items: 'one' } }));

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toMatch(/^summary\.items: /);
  });

  // A walk sweeps what it did not see, so somebody else's server would mark
  // this whole library gone.
  it('refuses a walk of another server, and writes nothing', async () => {
    const stub = storing();
    const response = await post(bearer, walk({ machineIdentifier: 'b'.repeat(40) }), stub);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: 'wrong_server' });
    expect(stub.inserted).toEqual([]);
  });

  it('refuses a walk that does not add up, and writes nothing', async () => {
    const stub = storing();
    const response = await post(bearer, walk({ summary: { items: 2 } }), stub);

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: 'incomplete',
      message: 'dump does not add up: it counted 2 item(s), its sections hold 1',
    });
    expect(stub.inserted).toEqual([]);
  });
});
