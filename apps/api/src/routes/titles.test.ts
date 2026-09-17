import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { type TmdbClient, TmdbError, type TmdbTitleDetails } from '../tmdb/client.js';

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

const witcher: TmdbTitleDetails = {
  kind: 'show',
  ids: { tmdb: '71912', tvdb: '362696' },
  name: 'The Witcher',
  year: 2019,
  posterPath: null,
  overview: null,
  seasons: [],
};

const stub = (over: Partial<TmdbClient> = {}): TmdbClient => ({
  search: async () => [],
  details: async () => witcher,
  seasonEpisodes: async () => [],
  ...over,
});

let app: FastifyInstance | undefined;

/**
 * Every case here is rejected before a query is issued, so the app gets a
 * database that would throw if it were reached. The paths that do write are
 * covered by `planTitle`/`planEpisodes` and verified against a live database.
 */
const start = (tmdb: TmdbClient | null): FastifyInstance => {
  app = buildApp({ config, db: {} as Database, tmdb });
  return app;
};

const post = (server: FastifyInstance, payload: unknown) =>
  server.inject({ method: 'POST', url: '/titles', payload: payload as object });

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
