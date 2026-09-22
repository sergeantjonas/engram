import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig } from '../app.fixture.js';
import { buildApp } from '../app.js';
import { sessionDb, signedIn } from '../auth/session.fixture.js';
import { type TmdbClient, TmdbError, type TmdbTitleDetails } from '../tmdb/client.js';

const witcher: TmdbTitleDetails = {
  kind: 'show',
  ids: { tmdb: '71912', tvdb: '362696' },
  name: 'The Witcher',
  year: 2019,
  posterPath: null,
  backdropPath: null,
  overview: null,
  status: null,
  lastAirDate: null,
  nextEpisode: null,
  runtimeMin: null,
  director: null,
  cast: [],
  collection: null,
  seasons: [],
};

const stub = (over: Partial<TmdbClient> = {}): TmdbClient => ({
  search: async () => [],
  details: async () => witcher,
  seasonEpisodes: async () => [],
  collection: async () => ({ id: 0, name: '', parts: [] }),
  ...over,
});

let app: FastifyInstance | undefined;

/**
 * Every case here is rejected before a query is issued. The stubbed database
 * answers the guard's session lookup and would throw on a write, so a case that
 * reached one would fail loudly. The paths that do write are covered by
 * `planTitle`/`planEpisodes` and verified against a live database.
 */
const start = (tmdb: TmdbClient | null): FastifyInstance => {
  app = buildApp({ config: testConfig, db: sessionDb().db, tmdb, github: githubStub });
  return app;
};

const post = (server: FastifyInstance, payload: unknown) =>
  server.inject({
    method: 'POST',
    url: '/titles',
    payload: payload as object,
    headers: signedIn,
  });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('POST /titles', () => {
  it('rejects a body that names no title', async () => {
    const response = await post(start(stub()), { kind: 'show' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad_request');
  });

  it('rejects a kind it cannot store', async () => {
    const response = await post(start(stub()), { kind: 'person', tmdbId: '525' });

    expect(response.statusCode).toBe(400);
  });

  it('refuses an id that would escape the upstream path', async () => {
    const server = start(stub());

    const response = await post(server, {
      kind: 'show',
      tmdbId: '../../authentication/token/new',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('tmdbId');
  });

  it('says the capability is missing when no key is configured', async () => {
    const response = await post(start(null), { kind: 'show', tmdbId: '71912' });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('tmdb_unavailable');
  });

  it('refuses a show TMDB cannot give a tvdb id for', async () => {
    const server = start(stub({ details: async () => ({ ...witcher, ids: { tmdb: '71912' } }) }));

    const response = await post(server, { kind: 'show', tmdbId: '71912' });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toEqual({
      error: 'unidentifiable',
      message: 'TMDB has no tvdb id for this title',
    });
  });

  it('passes a missing title through as a 404 rather than a bad gateway', async () => {
    const server = start(
      stub({
        details: async () => {
          throw new TmdbError('TMDB responded 404', 404);
        },
      }),
    );

    const response = await post(server, { kind: 'show', tmdbId: '0' });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('not_found');
  });

  it('reports any other upstream failure as a bad gateway', async () => {
    const server = start(
      stub({
        details: async () => {
          throw new TmdbError('TMDB responded 500', 500);
        },
      }),
    );

    const response = await post(server, { kind: 'show', tmdbId: '71912' });

    expect(response.statusCode).toBe(502);
  });

  it('fails before writing when a season lookup fails partway', async () => {
    const server = start(
      stub({
        details: async () => ({ ...witcher, seasons: [{ season: 1, episodeCount: 8 }] }),
        seasonEpisodes: async () => {
          throw new TmdbError('TMDB responded 503', 503);
        },
      }),
    );

    const response = await post(server, { kind: 'show', tmdbId: '71912' });

    expect(response.statusCode).toBe(502);
  });
});

/** One row shaped the way the list query returns it, before mapping. */
const listRow = (over: Record<string, unknown> = {}) => ({
  id: '0f7c2c3a-8a0e-4c5f-9f6b-2a1c0e9a7701',
  key: 'show:tvdb:362696',
  kind: 'show',
  name: 'The Witcher',
  year: 2019,
  poster_path: null,
  want: null,
  dropped_at: null,
  excluded_at: null,
  present: null,
  episode_total: 8,
  seen_count: 8,
  movie_seen: null,
  last_watched_at: '2025-12-02T21:00:00+00:00',
  last_watched_precision: 'exact',
  has_gap: false,
  ...over,
});

/** No session cookie at all: the read is open, so this reaches the route. */
const stranger: Record<string, string> = {};

describe('GET /titles', () => {
  const list = (query = '', rows: unknown[] = [], headers: Record<string, string> = signedIn) => {
    const stub = sessionDb();
    stub.rows = rows;
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    return app.inject({ method: 'GET', url: `/titles${query}`, headers });
  };

  // The gap comes off an aggregate that is null for a title nothing has been
  // recorded against, and null there is "no gap" rather than "unknown": a
  // title with no episodes has no hole in a run to report.
  it('answers the gap facet, defaulting a title with no history', async () => {
    const rows = [
      listRow({ has_gap: true }),
      listRow({ id: 'b7a1c0e9-7701-4c5f-8a0e-0f7c2c3a9f6b', has_gap: null }),
    ];
    const titles = (await list('', rows)).json().titles;

    expect(titles[0]).toMatchObject({ hasGap: true });
    expect(titles[1]).toMatchObject({ hasGap: false });
  });

  it('carries TMDB’s status on the card, null until it has been fetched', async () => {
    const rows = [
      listRow({ status: 'Ended' }),
      listRow({ id: 'b7a1c0e9-7701-4c5f-8a0e-0f7c2c3a9f6b', status: null }),
    ];
    const titles = (await list('', rows)).json().titles;

    expect(titles.map((title: { status: string | null }) => title.status)).toEqual(['Ended', null]);
  });

  it('carries the next air date on the card', async () => {
    const rows = [listRow({ status: 'Returning Series', next_air_date: '2026-10-20' })];
    const titles = (await list('', rows)).json().titles;

    expect(titles[0]).toMatchObject({ nextAirDate: '2026-10-20' });
  });

  it('rejects a state nothing can be in', async () => {
    const response = await list('?state=abandoned');

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad_request');
  });

  it('rejects a flag that is not a flag', async () => {
    expect((await list('?includeExcluded=yes')).statusCode).toBe(400);
  });

  it('answers with what the library holds', async () => {
    const response = await list('', [listRow()]);

    expect(response.statusCode).toBe(200);
    expect(response.json().titles).toEqual([
      expect.objectContaining({
        name: 'The Witcher',
        state: 'seen',
        episodes: { total: 8, seen: 8 },
        lastWatchedAt: '2025-12-02T21:00:00+00:00',
      }),
    ]);
  });

  // The point of marking a title not-mine is to stop seeing it.
  it('hides an excluded title unless it is asked for', async () => {
    const rows = [listRow(), listRow({ id: 'x', name: 'Not Mine', excluded_at: '2026-09-17' })];

    expect((await list('', rows)).json().titles).toHaveLength(1);
    expect((await list('?includeExcluded=true', rows)).json().titles).toHaveLength(2);
  });

  // Asking is the owner's privilege. A stranger gets the flag ignored rather
  // than refused, so nothing tells them it was worth asking for.
  it('will not un-hide an excluded title for a stranger that asks', async () => {
    const rows = [listRow(), listRow({ id: 'x', name: 'Not Mine', excluded_at: '2026-09-17' })];
    const response = await list('?includeExcluded=true', rows, stranger);

    expect(response.statusCode).toBe(200);
    expect(response.json().titles).toHaveLength(1);
  });

  // What was meant is the owner writing to themselves; what was watched is the
  // record. The same line a gap's note falls on.
  it('keeps the owner\u2019s opinion of a title off a stranger\u2019s wall', async () => {
    const rows = [listRow({ want: true, dropped_at: '2026-09-17' })];

    expect((await list('', rows, signedIn)).json().titles[0]).toMatchObject({
      want: true,
      dropped: true,
    });
    expect((await list('', rows, stranger)).json().titles[0]).toMatchObject({
      want: false,
      dropped: false,
      excluded: false,
      // The watching itself is untouched: this is a redaction of opinion, not
      // of the record.
      state: 'seen',
      episodes: { total: 8, seen: 8 },
    });
  });

  it('filters on the derived state rather than a stored one', async () => {
    const rows = [listRow(), listRow({ id: 'y', name: 'Halfway', seen_count: 3 })];

    expect((await list('?state=seen', rows)).json().titles).toHaveLength(1);
    expect((await list('?state=in_progress', rows)).json().titles[0].name).toBe('Halfway');
    expect((await list('?state=unwatched', rows)).json().titles).toHaveLength(0);
  });
});

describe('GET /titles/:id/activity', () => {
  const activityRow = {
    id: 'w1',
    season: 1,
    number: 1,
    name: 'A Grain of Truth',
    watched_at: '2025-12-02T21:00:00+00:00',
    watched_precision: 'exact',
    source: 'plex-history',
    rewatch: false,
  };

  const page = (
    url: string,
    executions: unknown[][] = [[listRow()], [activityRow]],
    headers: Record<string, string> = signedIn,
  ) => {
    const stub = sessionDb();
    stub.executions = executions;
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    return app.inject({ method: 'GET', url, headers });
  };

  it('answers one page of the feed, newest first as the detail does', async () => {
    const response = await page(`/titles/${listRow().id}/activity?offset=50&limit=50`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      moments: [
        {
          id: 'w1',
          season: 1,
          number: 1,
          name: 'A Grain of Truth',
          watchedAt: '2025-12-02T21:00:00+00:00',
          precision: 'exact',
          source: 'plex-history',
          rewatch: false,
        },
      ],
    });
  });

  it('rejects an offset or a limit it cannot read, or a limit past the cap', async () => {
    expect((await page(`/titles/${listRow().id}/activity?offset=-1`)).statusCode).toBe(400);
    expect((await page(`/titles/${listRow().id}/activity?limit=201`)).statusCode).toBe(400);
    expect((await page(`/titles/${listRow().id}/activity?limit=`)).statusCode).toBe(400);
    expect(
      (await page(`/titles/${listRow().id}/activity?offset=${'9'.repeat(25)}`)).statusCode,
    ).toBe(400);
  });

  it('answers 404 for an id nothing is stored under, and to a stranger for an excluded title', async () => {
    expect((await page(`/titles/${listRow().id}/activity`, [[]])).statusCode).toBe(404);
    const excluded = listRow({ excluded_at: '2026-09-17T00:00:00+00:00' });
    expect(
      (await page(`/titles/${listRow().id}/activity`, [[excluded], [activityRow]], stranger))
        .statusCode,
    ).toBe(404);
    expect(
      (await page(`/titles/${listRow().id}/activity`, [[excluded], [activityRow]])).statusCode,
    ).toBe(200);
  });
});

describe('GET /titles/:id', () => {
  const identityRow = {
    tmdb_id: '71912',
    tvdb_id: '362696',
    imdb_id: 'tt5180504',
    overview: 'Geralt of Rivia.',
    plays: 1,
  };

  const activityRow = {
    id: 'w1',
    season: 1,
    number: 1,
    name: 'A Grain of Truth',
    watched_at: '2025-12-02T21:00:00+00:00',
    watched_precision: 'exact',
    source: 'plex-history',
    rewatch: false,
  };

  const detail = (
    id: string,
    executions: unknown[][] = [],
    headers: Record<string, string> = signedIn,
    activity: unknown[] = [activityRow],
  ) => {
    const stub = sessionDb();
    // Four statements: the summary, the identity and figures, the grid, then
    // the activity. A test supplies the first and the grid; the other two are
    // the same every time and are spliced in so the cases stay about what they
    // test.
    stub.executions =
      executions.length > 1
        ? [executions[0] ?? [], [identityRow], ...executions.slice(1), activity]
        : executions;
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    return app.inject({ method: 'GET', url: `/titles/${id}`, headers });
  };

  it('rejects an id that is not one', async () => {
    const response = await detail('the-witcher');

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('id');
  });

  it('answers 404 for an id nothing is stored under', async () => {
    // Only one result set: the episode query is never reached.
    const response = await detail('0f7c2c3a-8a0e-4c5f-9f6b-2a1c0e9a7701', [[]]);

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('not_found');
  });

  it('answers with the title and its grid', async () => {
    const response = await detail('0f7c2c3a-8a0e-4c5f-9f6b-2a1c0e9a7701', [
      [listRow()],
      [
        {
          id: 'e1',
          season: 1,
          number: 1,
          name: 'A Grain of Truth',
          air_date: '2019-12-20',
          runtime_min: 60,
          tmdb_episode_id: '1859369',
          seen: true,
          play_count: 1,
          first_watched_at: null,
          first_watched_precision: 'unknown',
          last_watched_at: null,
          last_watched_precision: 'unknown',
        },
      ],
    ]);

    expect(response.statusCode).toBe(200);
    expect(response.json().title.name).toBe('The Witcher');
    expect(response.json().overview).toBe('Geralt of Rivia.');
    expect(response.json().seasons).toEqual([
      { season: 1, episodes: [expect.objectContaining({ number: 1, seen: true })] },
    ]);
  });

  // Hiding it from the wall and then handing it over to anyone holding the id
  // would make the flag decorative.
  it('hides an excluded title from a stranger who has its id', async () => {
    // Built per call: the stub shifts result sets off the array it is given, so
    // one shared array leaves the second request with nothing to answer from.
    const rows = () => [[listRow({ excluded_at: '2026-09-17' })], []];
    const id = '0f7c2c3a-8a0e-4c5f-9f6b-2a1c0e9a7701';

    expect((await detail(id, rows(), stranger)).statusCode).toBe(404);
    // The owner still arrives by link or by back button.
    expect((await detail(id, rows())).statusCode).toBe(200);
  });

  it('keeps the owner’s opinion off the title page too', async () => {
    const id = '0f7c2c3a-8a0e-4c5f-9f6b-2a1c0e9a7701';
    const rows = () => [[listRow({ want: true, dropped_at: '2026-09-17' })], []];

    expect((await detail(id, rows(), stranger)).json().title).toMatchObject({
      want: false,
      dropped: false,
    });
    expect((await detail(id, rows())).json().title).toMatchObject({
      want: true,
      dropped: true,
    });
  });

  // The colour of the cell is a fact about the run; the sentence explaining it
  // is the owner talking to themselves.

  it('gives a stranger the reason for a hole but not the note about it', async () => {
    const rows = () => [
      [listRow()],
      [
        {
          id: 'e1',
          season: 1,
          number: 1,
          name: 'A Grain of Truth',
          air_date: '2019-12-20',
          runtime_min: 60,
          tmdb_episode_id: '1859369',
          seen: false,
          play_count: 0,
          first_watched_at: null,
          first_watched_precision: null,
          last_watched_at: null,
          last_watched_precision: null,
          gap_reason: 'skipped',
          gap_note: 'lent the box set out',
        },
      ],
    ];
    const id = '0f7c2c3a-8a0e-4c5f-9f6b-2a1c0e9a7701';

    const seen = await detail(id, rows(), stranger);
    expect(seen.json().seasons[0].episodes[0].gap).toEqual({ reason: 'skipped', note: null });
    // Redacting the note must not take the rest of the page with it: the ids
    // and the figures are facts about the record, which reads for anyone.
    expect(seen.json().ids).toEqual({ tmdb: '71912', tvdb: '362696', imdb: 'tt5180504' });
    expect(seen.json().figures.plays).toBe(1);
    // The plays are the record. `withoutGapNotes` enumerates what a stranger
    // receives precisely so adding a field is a decision rather than a
    // default, and this is the decision: an event carries its episode, its
    // date and its source, and nothing about the device or the account.
    expect(seen.json().recentActivity).toHaveLength(1);
    expect(seen.json().recentActivity[0]).toMatchObject({
      number: 1,
      source: 'plex-history',
      rewatch: false,
    });
    expect(Object.keys(seen.json().recentActivity[0]).sort()).toEqual([
      'id',
      'name',
      'number',
      'precision',
      'rewatch',
      'season',
      'source',
      'watchedAt',
    ]);

    const mine = await detail(id, rows());
    expect(mine.json().seasons[0].episodes[0].gap).toEqual({
      reason: 'skipped',
      note: 'lent the box set out',
    });
  });
});

describe('PUT /titles/:id/intent', () => {
  const ID = '0f7c2c3a-8a0e-4c5f-9f6b-2a1c0e9a7701';

  const put = (body: unknown, headers: Record<string, string> = signedIn, rows: unknown[] = []) => {
    // No `selects` override: the guard's session lookup is the first select
    // the stub answers, and queueing one here would hand the guard the title.
    const stub = sessionDb();
    stub.returns = [rows];
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    return {
      stub,
      response: app.inject({
        method: 'PUT',
        url: `/titles/${ID}/intent`,
        payload: body as object,
        headers,
      }),
    };
  };

  it('records an opinion on a title nobody had one about', async () => {
    const { stub, response } = put({ want: true }, signedIn, [
      { want: true, droppedAt: null, excludedAt: null },
    ]);

    expect((await response).statusCode).toBe(200);
    expect((await response).json()).toEqual({
      intent: { want: true, dropped: false, excluded: false },
    });
    // Upserted, because most titles have no intent row until someone has one.
    expect(stub.inserted[0]).toMatchObject({ onConflict: 'update' });
  });

  // A patch names what changed. Leaving a field out has to mean unchanged, or
  // setting "dropped" would quietly un-exclude.
  it('writes only the fields the body names', async () => {
    const { stub, response } = put({ dropped: true }, signedIn, [
      { want: false, droppedAt: new Date(), excludedAt: null },
    ]);
    await response;

    const set = stub.inserted[0]?.set as Record<string, unknown> | undefined;
    expect(Object.keys(set ?? {})).toEqual(['droppedAt']);
  });

  it('clears a flag rather than only setting it', async () => {
    const { stub, response } = put({ excluded: false }, signedIn, [
      { want: false, droppedAt: null, excludedAt: null },
    ]);
    await response;

    const set = stub.inserted[0]?.set as Record<string, unknown> | undefined;
    expect(set?.excludedAt).toBeNull();
  });

  it('refuses a body that says nothing', async () => {
    const { response } = put({});

    expect((await response).statusCode).toBe(400);
    expect((await response).json().message).toContain('at least one');
  });

  it('refuses an id that is not one', async () => {
    const stub = sessionDb();
    app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
    const response = await app.inject({
      method: 'PUT',
      url: '/titles/the-witcher/intent',
      payload: { want: true },
      headers: signedIn,
    });

    expect(response.statusCode).toBe(400);
  });

  // Wanting something is a change to the record, and the record is the
  // owner's to change.
  it('turns a stranger away', async () => {
    const { response } = put({ want: true }, stranger);

    expect((await response).statusCode).toBe(401);
  });
});
