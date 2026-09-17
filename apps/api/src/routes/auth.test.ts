import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { SESSION_COOKIE, STATE_COOKIE } from '../auth/cookies.js';
import { type StubbedSession, sessionDb, signedIn } from '../auth/session.fixture.js';
import { STATE_TTL_MS, signState } from '../auth/state.js';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { type ExchangeResult, GITHUB_ISSUER, type GithubClient } from '../github/client.js';

const STATE_SECRET = 'b'.repeat(64);
const WEB_ORIGIN = 'http://localhost:2011';

const config: Config = {
  DATABASE_URL: 'postgres://unused',
  WEBHOOK_SECRET: 'x'.repeat(16),
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'fatal',
  GITHUB_OAUTH_CLIENT_ID: 'Ov23liexample',
  GITHUB_OAUTH_CLIENT_SECRET: 'a-client-secret',
  OWNER_GITHUB_USER_ID: '10808486',
  OAUTH_STATE_SECRET: STATE_SECRET,
  WEB_ORIGIN,
};

const owner = { id: 10808486, login: 'sergeantjonas' };
const stranger = { id: 999, login: 'someone-else' };

const github = (over: Partial<GithubClient> = {}): GithubClient => ({
  authorizeUrl: (state) => `https://github.test/authorize?state=${encodeURIComponent(state)}`,
  exchangeCode: async (): Promise<ExchangeResult> => ({ ok: true, identity: owner }),
  ...over,
});

/** Records what a session write would have been, without a database behind it. */
const writes: Record<string, unknown>[] = [];
const recordingDb = {
  insert: () => ({
    values: async (row: Record<string, unknown>) => {
      writes.push(row);
    },
  }),
} as unknown as Database;

let app: FastifyInstance | undefined;

const start = (over: Partial<GithubClient> = {}, db: Database = recordingDb): FastifyInstance => {
  app = buildApp({ config, db, tmdb: null, github: github(over) });
  return app;
};

const setCookies = (response: { headers: Record<string, unknown> }): string[] => {
  const header = response.headers['set-cookie'];
  return Array.isArray(header) ? header.map(String) : [String(header ?? '')];
};

const cookieNamed = (response: { headers: Record<string, unknown> }, name: string) =>
  setCookies(response).find((value) => value.startsWith(`${name}=`));

const nonceOf = (response: { headers: Record<string, unknown> }): string =>
  (cookieNamed(response, STATE_COOKIE) ?? '').slice(`${STATE_COOKIE}=`.length).split(';')[0] ?? '';

const stateOf = (response: { headers: Record<string, string> }): string =>
  new URL(response.headers.location).searchParams.get('state') ?? '';

const callback = (
  server: FastifyInstance,
  query: Record<string, string>,
  nonce: string | undefined,
) =>
  server.inject({
    method: 'GET',
    url: `/auth/github/callback?${new URLSearchParams(query).toString()}`,
    ...(nonce === undefined ? {} : { headers: { cookie: `${STATE_COOKIE}=${nonce}` } }),
  });

/** A full handshake: log in, then answer the callback it set up. */
const handshake = async (
  server: FastifyInstance,
  query: Record<string, string> = {},
  next?: string,
) => {
  const login = await server.inject({
    method: 'GET',
    url: next === undefined ? '/auth/github/login' : `/auth/github/login?next=${next}`,
  });

  return await callback(
    server,
    { code: 'a-code', state: stateOf(login), ...query },
    nonceOf(login),
  );
};

const signedInAs = (session: StubbedSession | null) => {
  const stub = sessionDb(session);
  app = buildApp({ config, db: stub.db, tmdb: null, github: github() });
  return { app, stub };
};

afterEach(async () => {
  await app?.close();
  app = undefined;
  writes.length = 0;
});

describe('GET /auth/github/login', () => {
  it('sends the browser to GitHub with a signed state', async () => {
    const response = await start().inject({ method: 'GET', url: '/auth/github/login' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('https://github.test/authorize');
    expect(stateOf(response)).not.toBe('');
  });

  // The nonce is what pins the callback to this browser; the state carries only
  // its signature, so the cookie is the other half of the pair.
  it('leaves the nonce in a cookie the callback can match', async () => {
    const response = await start().inject({ method: 'GET', url: '/auth/github/login' });
    const cookie = cookieNamed(response, STATE_COOKIE) ?? '';

    expect(nonceOf(response)).not.toBe('');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain(`Max-Age=${STATE_TTL_MS / 1000}`);
  });

  it('clamps where the callback will send the browser', async () => {
    const response = await start().inject({
      method: 'GET',
      url: '/auth/github/login?next=https://evil.example',
    });
    const claims = JSON.parse(
      Buffer.from(stateOf(response).split('.')[0] ?? '', 'base64url').toString('utf8'),
    );

    expect(claims.next).toBe('/');
  });
});

describe('GET /auth/github/callback', () => {
  it('signs the owner in and sends them where they asked to go', async () => {
    const response = await handshake(start(), {}, '/titles');

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${WEB_ORIGIN}/titles`);
    expect(cookieNamed(response, SESSION_COOKIE)).toContain('HttpOnly');
    expect(writes).toHaveLength(1);
  });

  it('stores only the hash of what it put in the cookie', async () => {
    const response = await handshake(start());
    const token = (cookieNamed(response, SESSION_COOKIE) ?? '')
      .slice(`${SESSION_COOKIE}=`.length)
      .split(';')[0];

    expect(token).not.toBe('');
    // The hash of *this* token, not merely something other than it: the row and
    // the cookie have to name each other or no session ever resolves.
    expect(writes[0]?.tokenHash).toBe(
      createHash('sha256')
        .update(token ?? '')
        .digest('hex'),
    );
    expect(writes[0]?.githubUserId).toBe('10808486');
  });

  // A state cookie surviving a failed attempt is a replay window.
  it('burns the nonce cookie whatever the outcome', async () => {
    const denied = await callback(start(), { code: 'a-code', state: 'nonsense' }, 'a-nonce');
    const allowed = await handshake(start());

    expect(cookieNamed(denied, STATE_COOKIE)).toContain('Max-Age=0');
    expect(cookieNamed(allowed, STATE_COOKIE)).toContain('Max-Age=0');
  });

  // Without the nonce match a signed state token from anywhere logs anyone in.
  it('refuses a state that was not minted for this browser', async () => {
    const server = start();
    const login = await server.inject({ method: 'GET', url: '/auth/github/login' });

    const response = await callback(
      server,
      { code: 'a-code', state: stateOf(login) },
      'a-different-nonce',
    );

    expect(response.headers.location).toBe(`${WEB_ORIGIN}/login?error=state&next=%2F`);
    expect(writes).toHaveLength(0);
  });

  it('refuses a callback carrying no state cookie at all', async () => {
    const server = start();
    const login = await server.inject({ method: 'GET', url: '/auth/github/login' });

    const response = await callback(server, { code: 'a-code', state: stateOf(login) }, undefined);

    expect(response.headers.location).toContain('error=state');
  });

  it('refuses a state it did not sign', async () => {
    const forged = signState(
      { nonce: 'a-nonce', next: '/', exp: Date.now() + STATE_TTL_MS },
      'a-secret-that-is-not-ours-and-is-long',
    );

    const response = await callback(start(), { code: 'a-code', state: forged }, 'a-nonce');

    expect(response.headers.location).toContain('error=state');
    expect(writes).toHaveLength(0);
  });

  it('refuses a state that has run out', async () => {
    const stale = signState({ nonce: 'a-nonce', next: '/', exp: Date.now() - 1 }, STATE_SECRET);

    const response = await callback(start(), { code: 'a-code', state: stale }, 'a-nonce');

    expect(response.headers.location).toContain('error=state');
  });

  // Present and different did not come from the server this handshake started
  // with; absent is fine, since only GitHub decides whether to send it.
  it('refuses a response issued by someone else', async () => {
    const wrong = await handshake(start(), { iss: 'https://evil.example' });
    const right = await handshake(start(), { iss: GITHUB_ISSUER });

    expect(wrong.headers.location).toContain('error=state');
    expect(right.headers.location).toBe(`${WEB_ORIGIN}/`);
  });

  // GitHub sends `?error=access_denied` rather than a code when the owner
  // clicks Cancel; there is nothing to exchange.
  it('takes a declined authorisation as a denial rather than a failure', async () => {
    const response = await handshake(start(), { error: 'access_denied' });

    expect(response.headers.location).toContain('error=github');
    expect(writes).toHaveLength(0);
  });

  it('denies when the exchange yields no identity', async () => {
    const response = await handshake(
      start({ exchangeCode: async () => ({ ok: false, reason: 'no access token' }) }),
    );

    expect(response.headers.location).toContain('error=github');
    expect(writes).toHaveLength(0);
  });

  // The check is on the numeric id, so anyone who authorises is turned away
  // before a session exists.
  it('refuses an account that is not the owner', async () => {
    const response = await handshake(
      start({ exchangeCode: async () => ({ ok: true, identity: stranger }) }),
    );

    expect(response.headers.location).toContain('error=forbidden');
    expect(cookieNamed(response, SESSION_COOKIE)).toBeUndefined();
    expect(writes).toHaveLength(0);
  });

  // `startsWith(WEB_ORIGIN)` would pass this: appended raw, `@evil.example`
  // turns the origin into userinfo and the browser resolves `evil.example`.
  // The assertion has to be on the whole value or it guards nothing.
  it('never redirects off this site, whatever the state carried', async () => {
    for (const next of ['@evil.example', '//evil.example', '/\\evil.example']) {
      const crafted = signState(
        { nonce: 'a-nonce', next, exp: Date.now() + STATE_TTL_MS },
        STATE_SECRET,
      );

      const response = await callback(start(), { code: 'a-code', state: crafted }, 'a-nonce');
      expect(response.headers.location, next).toBe(`${WEB_ORIGIN}/`);
      await app?.close();
    }
  });

  // The whole point of burning it on the reply rather than collecting it: a
  // write that throws must not leave a usable nonce behind.
  it('burns the nonce even when the session cannot be written', async () => {
    const failing = {
      insert: () => ({
        values: async () => {
          throw new Error('the database is unreachable');
        },
      }),
    } as unknown as Database;

    const response = await handshake(start({}, failing));

    expect(response.statusCode).toBe(500);
    expect(cookieNamed(response, STATE_COOKIE)).toContain('Max-Age=0');
    expect(cookieNamed(response, SESSION_COOKIE)).toBeUndefined();
  });
});

describe('GET /auth/me', () => {
  it('answers 200 to a caller with no session', async () => {
    const response = await signedInAs(null).app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ isOwner: false });
  });

  it('says so when the owner is signed in', async () => {
    const response = await signedInAs({}).app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: signedIn,
    });

    expect(response.json()).toEqual({ isOwner: true });
  });

  it('is not the owner on a session issued to somebody else', async () => {
    const response = await signedInAs({ githubUserId: '999' }).app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: signedIn,
    });

    expect(response.json()).toEqual({ isOwner: false });
  });

  // The answer differs per viewer, so nothing shared may hold a copy.
  it('forbids anything caching the answer', async () => {
    const response = await signedInAs(null).app.inject({ method: 'GET', url: '/auth/me' });

    expect(response.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /auth/logout', () => {
  it('ends the session and tells the browser to forget the cookie', async () => {
    const { app: server, stub } = signedInAs({});

    const response = await server.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(204);
    expect(stub.deleted).toBe(1);
    expect(cookieNamed(response, SESSION_COOKIE)).toContain('Max-Age=0');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  // Logging out twice, or with a cookie whose row was already reaped, is a
  // success: there is nothing the caller would do differently.
  it('succeeds with a cookie that names nothing', async () => {
    const { app: server } = signedInAs(null);

    const response = await server.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: signedIn,
    });

    expect(response.statusCode).toBe(204);
    expect(cookieNamed(response, SESSION_COOKIE)).toContain('Max-Age=0');
  });

  it('succeeds with no cookie at all, and deletes nothing', async () => {
    const { app: server, stub } = signedInAs(null);

    const response = await server.inject({ method: 'POST', url: '/auth/logout' });

    expect(response.statusCode).toBe(204);
    expect(stub.deleted).toBe(0);
  });
});
