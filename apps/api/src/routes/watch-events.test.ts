import { PgDialect } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig } from '../app.fixture.js';
import { buildApp } from '../app.js';
import { OWNER_GITHUB_USER_ID, sessionDb, signedIn } from '../auth/session.fixture.js';
import { toScope } from './watch-events.js';

const titleId = '5e2f6f0c-6a5e-4f3b-9a4f-2b1d1c0e9a77';

let app: FastifyInstance | undefined;

/**
 * Every case here is rejected before a query is issued. The stubbed database
 * answers the guard's session lookup and would throw on a write. What the plan
 * then becomes is covered by `planWatchEvents`; the pairing of the stored date
 * with the date the event id carries only shows up against a live database.
 */
const start = (): FastifyInstance => {
  app = buildApp({ config: testConfig, db: sessionDb().db, tmdb: null, github: githubStub });
  return app;
};

const post = (payload: unknown) =>
  start().inject({
    method: 'POST',
    url: '/watch-events',
    payload: payload as object,
    headers: signedIn,
  });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST /watch-events', () => {
  it('rejects a body that names no title', async () => {
    const response = await post({ scope: 'all' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad_request');
  });

  it('rejects a title id that is not one', async () => {
    const response = await post({ titleId: 'the-witcher' });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('titleId');
  });

  it('rejects a scope it cannot read', async () => {
    const response = await post({ titleId, scope: 'season-2' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects an episode named without its season', async () => {
    const response = await post({ titleId, scope: { episode: 5 } });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a range that also names one episode, or runs backwards', async () => {
    expect((await post({ titleId, scope: { season: 2, episode: 3, through: 5 } })).statusCode).toBe(
      400,
    );
    expect((await post({ titleId, scope: { season: 2, from: 6, through: 5 } })).statusCode).toBe(
      400,
    );
    expect((await post({ titleId, scope: { season: 2, from: 3 } })).statusCode).toBe(400);
  });

  it('rejects a negative season', async () => {
    const response = await post({ titleId, scope: { season: -1 } });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('season');
  });

  // A date it cannot read would otherwise be stored as no date at all, which
  // silently turns a remembered year into "unknown".
  it('rejects a date it cannot read rather than dropping it', async () => {
    const response = await post({ titleId, watchedAt: 'summer 2019' });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('watchedAt');
  });

  // Without an offset the same string is two different moments on a laptop and
  // on the server.
  it('rejects an instant that names no offset', async () => {
    const response = await post({ titleId, watchedAt: '2019-06-14T21:03:00' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a day that does not exist', async () => {
    const response = await post({ titleId, watchedAt: '2019-02-30' });

    expect(response.statusCode).toBe(400);
  });
});

describe('DELETE /watch-events', () => {
  /**
   * The guard's session lookup is the first select the stub answers, so a test
   * that queues the title has to hand the guard its own row first.
   */
  const session = {
    githubUserId: OWNER_GITHUB_USER_ID,
    expiresAt: new Date(Date.now() + 60_000),
    absoluteExpiresAt: new Date(Date.now() + 60_000),
  };
  const show = { id: titleId, key: 'show:tvdb:1', kind: 'show', name: 'Fallout' };

  /** The WHERE the route handed drizzle, rendered so a missing term shows. */
  const predicateOf = (stub: ReturnType<typeof sessionDb>) =>
    new PgDialect().sqlToQuery(stub.deletedWhere[0] as Parameters<PgDialect['sqlToQuery']>[0]);

  const remove = (query: string, selects?: unknown[][], returns?: unknown[][]) => {
    const stub = sessionDb();
    if (selects) stub.selects = selects;
    if (returns) stub.returns = returns;
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    return {
      stub,
      response: app.inject({ method: 'DELETE', url: `/watch-events${query}`, headers: signedIn }),
    };
  };

  it('rejects a request naming no title', async () => {
    const { response } = remove('');

    expect((await response).statusCode).toBe(400);
    expect((await response).json().message).toContain('titleId');
  });

  it('rejects an episode named without its season', async () => {
    const { response } = remove(`?titleId=${titleId}&episode=5`);

    expect((await response).statusCode).toBe(400);
    expect((await response).json().message).toContain('season');
  });

  it('rejects a season that is not a number', async () => {
    const { response } = remove(`?titleId=${titleId}&season=two`);

    expect((await response).statusCode).toBe(400);
  });

  // Bare coercion reads this as season 0, which is a real season: the whole
  // title the caller meant would become the specials they did not name.
  it('rejects an empty season rather than reading it as the specials', async () => {
    const { response } = remove(`?titleId=${titleId}&season=`);

    expect((await response).statusCode).toBe(400);
    expect((await response).json().message).toContain('season');
  });

  it('answers 404 when no title is stored under the id', async () => {
    const { response } = remove(`?titleId=${titleId}`, [[session], []]);

    expect((await response).statusCode).toBe(404);
  });

  it('retracts the marks in one season and says how many went', async () => {
    const { stub, response } = remove(
      `?titleId=${titleId}&season=2`,
      [
        [session],
        [show],
        [
          { id: 'e1', season: 2, number: 1 },
          { id: 'e2', season: 2, number: 2 },
          // Another season, which the scope must leave alone.
          { id: 'e9', season: 3, number: 1 },
        ],
      ],
      [[{ id: 'w1' }, { id: 'w2' }]],
    );

    expect((await response).statusCode).toBe(200);
    expect((await response).json().removed).toBe(2);
    // The predicate, not just that a delete happened: losing the source term
    // would eat imported history, and losing the episode term would eat the
    // seasons the caller did not name. Neither shows up in a row count.
    expect(predicateOf(stub)).toMatchObject({
      sql: expect.stringContaining('"source" ='),
      params: [titleId, 'manual', 'e1', 'e2'],
    });
  });

  // A film's events name no episode, so the scope resolves to no ids at all —
  // which the route has to read as the film rather than as covering nothing.
  it('retracts a film, whose events name no episode', async () => {
    const { stub, response } = remove(
      `?titleId=${titleId}`,
      [[session], [{ ...show, kind: 'movie', key: 'movie:tmdb:2' }]],
      [[{ id: 'w1' }]],
    );

    expect((await response).statusCode).toBe(200);
    expect((await response).json().removed).toBe(1);
    // No episode ids at all, and an `is null` rather than an empty list.
    expect(predicateOf(stub)).toMatchObject({
      sql: expect.stringContaining('"episode_id" is null'),
      params: [titleId, 'manual'],
    });
  });

  // 422 rather than 404: the title is here, the season named is not, and the
  // two read very differently to whoever sent it.
  it('answers 422 for a season the title does not have', async () => {
    const { response } = remove(`?titleId=${titleId}&season=9`, [
      [session],
      [show],
      [{ id: 'e1', season: 1, number: 1 }],
    ]);

    expect((await response).statusCode).toBe(422);
    expect((await response).json().message).toContain('season 9');
  });

  // Nothing to take back is an answer, not a failure: the caller asked whether
  // there was, and zero says no.
  it('answers zero when the scope holds nothing entered by hand', async () => {
    const { response } = remove(
      `?titleId=${titleId}&season=2&episode=1`,
      [[session], [show], [{ id: 'e1', season: 2, number: 1 }]],
      [[]],
    );

    expect((await response).statusCode).toBe(200);
    expect((await response).json().removed).toBe(0);
  });
});

describe('toScope', () => {
  // Between the title load and the plan, and covered by neither side of it:
  // `planWatchEvents` takes the scope as an input, so it cannot catch a wrong
  // one built here.
  it('reads the three things a request can mark', () => {
    expect(toScope('all')).toEqual({ kind: 'title' });
    expect(toScope({ season: 2 })).toEqual({ kind: 'season', season: 2 });
    expect(toScope({ season: 2, episode: 5 })).toEqual({
      kind: 'episode',
      season: 2,
      episode: 5,
    });
  });

  it('reads a range, from the first episode unless told otherwise', () => {
    expect(toScope({ season: 4, through: 7 })).toEqual({
      kind: 'range',
      season: 4,
      from: 1,
      through: 7,
    });
    expect(toScope({ season: 4, from: 3, through: 7 })).toEqual({
      kind: 'range',
      season: 4,
      from: 3,
      through: 7,
    });
  });

  it('keeps season 0 addressable, which is the only way to mark specials', () => {
    expect(toScope({ season: 0 })).toEqual({ kind: 'season', season: 0 });
  });
});
