import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { toScope } from './watch-events.js';

const config: Config = {
  DATABASE_URL: 'postgres://unused',
  WEBHOOK_SECRET: 'x'.repeat(16),
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'fatal',
  GITHUB_OAUTH_CLIENT_ID: 'Ov23liexample',
  GITHUB_OAUTH_CLIENT_SECRET: 'a-client-secret',
  OWNER_GITHUB_USER_ID: '10808486',
  OAUTH_STATE_SECRET: 'b'.repeat(32),
  WEB_ORIGIN: 'http://localhost:2011',
};

const titleId = '5e2f6f0c-6a5e-4f3b-9a4f-2b1d1c0e9a77';

let app: FastifyInstance | undefined;

/**
 * Every case here is rejected before a query is issued, so the app gets a
 * database that would throw if it were reached. What the plan then becomes is
 * covered by `planWatchEvents`; the pairing of the stored date with the date
 * the event id carries only shows up against a live database.
 */
const start = (): FastifyInstance => {
  app = buildApp({ config, db: {} as Database, tmdb: null });
  return app;
};

const post = (payload: unknown) =>
  start().inject({ method: 'POST', url: '/watch-events', payload: payload as object });

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

  it('keeps season 0 addressable, which is the only way to mark specials', () => {
    expect(toScope({ season: 0 })).toEqual({ kind: 'season', season: 0 });
  });
});
