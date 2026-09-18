import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig, WEB_ORIGIN } from '../app.fixture.js';
import { buildApp } from '../app.js';
import type { Database } from '../db/client.js';
import { SESSION_COOKIE } from './cookies.js';
import { type StubbedSession, sessionDb, signedIn } from './session.fixture.js';
import { SESSION_EXTEND_AFTER_MS, SESSION_TTL_MS } from './session.js';

let app: FastifyInstance | undefined;

const start = (session: StubbedSession | null = {}) => {
  const stub = sessionDb(session);
  app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
  return { app, stub };
};

const get = (server: FastifyInstance, url: string, headers: Record<string, string> = {}) =>
  server.inject({ method: 'GET', url, headers });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('the owner guard', () => {
  it('turns away a request carrying no session', async () => {
    const response = await get(start(null).app, '/search?q=witcher');

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('unauthorized');
  });

  it('lets a live owner session through', async () => {
    // 503 rather than 200 because no TMDB key is configured; what matters is
    // that the request reached the route at all.
    const response = await get(start().app, '/search?q=witcher', signedIn);

    expect(response.statusCode).toBe(503);
  });

  // A reverse proxy has to reach these to decide whether to route here at all.
  it('leaves the probes open', async () => {
    const server = start(null).app;

    expect((await get(server, '/health')).statusCode).toBe(200);
    // 200 because the stubbed database answers its `select 1`; what matters is
    // that neither probe is turned away by the gate.
    expect((await get(server, '/ready')).statusCode).toBe(200);
  });

  // They are how a session comes to exist; gating them would be a locked door
  // with the key behind it.
  it('leaves the login pair open', async () => {
    const response = await get(start(null).app, '/auth/github/login');

    expect(response.statusCode).toBe(302);
  });

  it('gates a route the list does not name', async () => {
    const response = await start(null).app.inject({ method: 'POST', url: '/titles' });

    expect(response.statusCode).toBe(401);
  });

  // Global with an opt-out list, so a path nobody registered is closed rather
  // than announcing that it does not exist.
  it('answers an unknown path with 401 rather than 404', async () => {
    expect((await get(start(null).app, '/not-a-route')).statusCode).toBe(401);
  });

  it('is not fooled by a query string on an open path', async () => {
    expect((await get(start(null).app, '/health?x=1')).statusCode).toBe(200);
  });

  it('refuses a session issued to somebody else', async () => {
    const response = await get(start({ githubUserId: '999' }).app, '/search?q=a', signedIn);

    expect(response.statusCode).toBe(401);
  });

  it('refuses a session past either boundary, and reaps the row', async () => {
    for (const expired of [
      { expiresAt: new Date(Date.now() - 1) },
      { absoluteExpiresAt: new Date(Date.now() - 1) },
    ]) {
      const { app: server, stub } = start(expired);
      const response = await get(server, '/search?q=a', signedIn);

      expect(response.statusCode).toBe(401);
      expect(stub.deleted).toBe(1);
      await server.close();
    }
  });

  it('slides a window that has drifted, and leaves a fresh one alone', async () => {
    const drifted = start({
      expiresAt: new Date(Date.now() + SESSION_TTL_MS - SESSION_EXTEND_AFTER_MS - 60_000),
    });
    await get(drifted.app, '/search?q=a', signedIn);
    expect(drifted.stub.extended).toHaveLength(1);
    await drifted.app.close();

    // Reading a session must not be a write on every request.
    const fresh = start();
    await get(fresh.app, '/search?q=a', signedIn);
    expect(fresh.stub.extended).toHaveLength(0);
  });

  // There is no public projection to degrade to, so a read that cannot happen
  // is a failure rather than a quiet "not the owner".
  it('fails closed when the session cannot be read', async () => {
    app = buildApp({ config: testConfig, db: {} as Database, tmdb: null, github: githubStub });

    const response = await get(app, '/search?q=a', signedIn);

    expect(response.statusCode).toBe(500);
  });
});

describe('cross-origin', () => {
  it('lets the SPA send its cookie', async () => {
    const response = await get(start().app, '/health', { origin: WEB_ORIGIN });

    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  // A wildcard is incompatible with credentials, so the allowlist is the only
  // thing standing between another origin and the owner's cookie.
  it('allows nobody else', async () => {
    // Shares a prefix with the allowed origin, so a `startsWith` compare would
    // let it through where the exact one does not.
    const response = await get(start().app, '/health', {
      origin: `${WEB_ORIGIN}.evil.example`,
    });

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    // Set on the miss too, or moving it inside the origin check — the
    // cache-poisoning bug — would go unnoticed.
    expect(response.headers.vary).toContain('Origin');
  });

  // A cache keyed on the path alone would hand one origin's allow header to
  // another.
  it('varies on the origin whether or not it matched', async () => {
    const allowed = await get(start().app, '/health', { origin: WEB_ORIGIN });

    expect(allowed.headers.vary).toContain('Origin');
  });

  // Nothing registers an OPTIONS route, so an unanswered preflight is a 404 and
  // every credentialed request fails before the real one is sent.
  it('answers a preflight rather than letting it 404', async () => {
    const response = await start(null).app.inject({
      method: 'OPTIONS',
      url: '/titles',
      headers: { origin: WEB_ORIGIN, 'access-control-request-method': 'POST' },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
  });

  // A preflight carries no cookies by design; gating it would 401 every
  // request the SPA ever makes.
  it('answers a preflight without a session', async () => {
    const response = await start(null).app.inject({
      method: 'OPTIONS',
      url: '/titles',
      headers: { origin: WEB_ORIGIN },
    });

    expect(response.statusCode).toBe(204);
  });

  // Otherwise the browser reports an opaque CORS failure and the real reason —
  // that the session has gone — never reaches the SPA.
  it('puts the headers on a 401 too', async () => {
    const response = await get(start(null).app, '/search?q=a', { origin: WEB_ORIGIN });

    expect(response.statusCode).toBe(401);
    expect(response.headers['access-control-allow-origin']).toBe(WEB_ORIGIN);
  });
});

describe('the session cookie', () => {
  // With a live session in the stub, a request carrying every cookie except
  // this one still has to be refused, or the guard is reading the wrong name.
  // It also pins the early return for an absent token: hashing `undefined`
  // throws, so without it this is a 500 rather than a 401.
  it('is the only cookie that counts', async () => {
    const response = await get(start().app, '/search?q=a', { cookie: 'other=1; another=2' });

    expect(response.statusCode).toBe(401);
  });

  it('is found among others', async () => {
    const response = await get(start().app, '/search?q=a', {
      cookie: `other=1; ${SESSION_COOKIE}=a-token; another=2`,
    });

    expect(response.statusCode).not.toBe(401);
  });
});
