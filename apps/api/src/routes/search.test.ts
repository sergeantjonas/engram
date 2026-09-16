import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { type TmdbCandidate, type TmdbClient, TmdbError } from '../tmdb/client.js';

const config: Config = {
  DATABASE_URL: 'postgres://unused',
  WEBHOOK_SECRET: 'x'.repeat(16),
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'fatal',
};

const witcher: TmdbCandidate = {
  kind: 'show',
  tmdbId: '71912',
  name: 'The Witcher',
  year: 2019,
  posterPath: '/AoGsDM02UVt0npBA8OvpDcZbaMi.jpg',
  overview: 'Geralt of Rivia.',
};

let app: FastifyInstance | undefined;

// `/search` never reaches Postgres, so the app gets a database it cannot use:
// a stub that is touched would fail loudly rather than quietly querying.
const start = (tmdb: TmdbClient | null): FastifyInstance => {
  app = buildApp({ config, db: {} as Database, tmdb });
  return app;
};

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /search', () => {
  it('returns the candidates TMDB found', async () => {
    const server = start({ search: async () => [witcher] });

    const response = await server.inject({ method: 'GET', url: '/search?q=witcher' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ results: [witcher] });
  });

  it('caps the results at the requested limit', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...witcher, tmdbId: String(i) }));
    const server = start({ search: async () => many });

    const response = await server.inject({ method: 'GET', url: '/search?q=a&limit=3' });

    expect(response.json().results).toHaveLength(3);
  });

  it('refuses a limit larger than the one page it fetches', async () => {
    const server = start({ search: async () => [witcher] });

    const response = await server.inject({ method: 'GET', url: '/search?q=a&limit=50' });

    expect(response.statusCode).toBe(400);
  });

  it('rejects a query that asks for nothing', async () => {
    const server = start({ search: async () => [witcher] });

    const response = await server.inject({ method: 'GET', url: '/search?q=%20%20' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad_request');
  });

  it('says the capability is missing rather than 404 when no key is configured', async () => {
    const server = start(null);

    const response = await server.inject({ method: 'GET', url: '/search?q=witcher' });

    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe('search_unavailable');
  });

  it('reports an upstream failure as a bad gateway, without leaking the key', async () => {
    const server = start({
      search: async () => {
        throw new TmdbError('TMDB responded 401', 401);
      },
    });

    const response = await server.inject({ method: 'GET', url: '/search?q=witcher' });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: 'upstream_failed', message: 'TMDB did not answer' });
  });
});
