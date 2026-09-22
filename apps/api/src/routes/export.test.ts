import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig } from '../app.fixture.js';
import { buildApp } from '../app.js';
import { sessionDb, signedIn } from '../auth/session.fixture.js';
import { CSV_HEADER } from '../export/record.js';

let app: FastifyInstance | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

const eventRow = {
  id: 'a',
  sort_at: '-infinity',
  title_key: 'show:tvdb:362696',
  kind: 'show',
  title_name: 'The Witcher',
  year: 2019,
  tmdb_id: '71912',
  tvdb_id: '362696',
  imdb_id: 'tt5180504',
  season: 1,
  number: 1,
  episode_name: 'The End’s Beginning',
  watched_at: null,
  watched_precision: 'unknown',
  source: 'manual',
  source_event_id: 'manual:show:tvdb:362696:S1E1',
  plays: null,
  completed: true,
};

const get = (
  url: string,
  executions: unknown[][] = [],
  headers: Record<string, string> = signedIn,
) => {
  const stub = sessionDb();
  stub.executions = executions;
  app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
  return app.inject({ method: 'GET', url, headers });
};

describe('export', () => {
  it('is the owner’s alone', async () => {
    for (const url of ['/export', '/export/record.csv', '/export/record.json']) {
      expect((await get(url, [], {})).statusCode).toBe(401);
    }
  });

  // Fastify would answer one by running the whole export and discarding it.
  it('answers no HEAD for a file', async () => {
    await get('/export');
    const response = await app?.inject({
      method: 'HEAD',
      url: '/export/record.csv',
      headers: signedIn,
    });

    expect(response?.statusCode).toBe(404);
  });

  it('says what the record holds, the claims only the owner stands behind among it', async () => {
    const response = await get('/export', [[{ titles: 82, events: 1109, manual: 648 }]]);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ titles: 82, events: 1109, manual: 648 });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('hands the record over as a CSV file, one event a line', async () => {
    const response = await get('/export/record.csv', [[eventRow]]);

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toMatch(
      /^attachment; filename="engram-record-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    const [header, line] = response.body.split('\r\n');
    expect(header).toBe(CSV_HEADER.join(','));
    expect(line).toContain(',unknown,manual,manual:show:tvdb:362696:S1E1,');
  });

  it('hands the record over as one JSON document', async () => {
    const response = await get('/export/record.json', [[], [], [eventRow]]);

    expect(response.headers['content-disposition']).toMatch(/\.json"$/);
    expect(response.json().events).toHaveLength(1);
  });
});
