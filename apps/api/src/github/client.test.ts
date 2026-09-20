import { describe, expect, it } from 'vitest';
import { createGithubClient } from './client.js';

const CLIENT_SECRET = 'the-client-secret';
const CODE = 'the-callback-code';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Answers the token endpoint and the user endpoint from one stub. */
const client = (answers: { token?: () => Response | Promise<Response>; user?: () => Response }) =>
  createGithubClient({
    clientId: 'Ov23liexample',
    clientSecret: CLIENT_SECRET,
    tokenUrl: 'https://github.test/token',
    userUrl: 'https://api.github.test/user',
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0]) => {
      const url = String(input);
      if (url.includes('/token')) {
        return answers.token?.() ?? json({ access_token: 'an-access-token' });
      }
      return answers.user?.() ?? json({ id: 10808486, login: 'sergeantjonas' });
    }) as typeof globalThis.fetch,
  });

describe('authorizeUrl', () => {
  it('asks for the account and nothing else', () => {
    const url = new URL(client({}).authorizeUrl('a-state'));

    expect(url.searchParams.get('client_id')).toBe('Ov23liexample');
    expect(url.searchParams.get('state')).toBe('a-state');
    expect(url.searchParams.get('allow_signup')).toBe('false');
  });

  // `GET /user` returns the authorising account with no scope granted, so
  // asking for one would be asking for what this project will never use.
  it('requests no scope', () => {
    expect(new URL(client({}).authorizeUrl('s')).searchParams.get('scope')).toBeNull();
  });

  // Omitted, GitHub uses the callback registered on the app, so where the
  // browser lands cannot be steered from a crafted link.
  it('names no redirect_uri', () => {
    expect(new URL(client({}).authorizeUrl('s')).searchParams.get('redirect_uri')).toBeNull();
  });
});

describe('exchangeCode', () => {
  // The stub elsewhere ignores `init`, so without this nothing pins that the
  // exchange is a POST carrying the credentials, or that the lookup presents
  // the token it just traded for.
  it('presents the credentials the way each endpoint expects', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const recording = createGithubClient({
      clientId: 'Ov23liexample',
      clientSecret: CLIENT_SECRET,
      tokenUrl: 'https://github.test/token',
      userUrl: 'https://api.github.test/user',
      fetch: (async (url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        calls.push({ url: String(url), init });
        return String(url).includes('/token')
          ? json({ access_token: 'an-access-token' })
          : json({ id: 1, login: 'x' });
      }) as typeof globalThis.fetch,
    });

    await recording.exchangeCode(CODE);

    const [token, user] = calls;
    expect(token?.init?.method).toBe('POST');
    expect(JSON.parse(String(token?.init?.body))).toEqual({
      client_id: 'Ov23liexample',
      client_secret: CLIENT_SECRET,
      code: CODE,
    });
    expect(new Headers(user?.init?.headers).get('authorization')).toBe('Bearer an-access-token');
  });

  it('returns the identity behind a good code', async () => {
    const result = await client({}).exchangeCode(CODE);

    expect(result).toEqual({ ok: true, identity: { id: 10808486, login: 'sergeantjonas' } });
  });

  // The trap this whole endpoint turns on: GitHub answers 200 with `{ error }`
  // for a bad or replayed code, so the status never says the exchange worked.
  it('refuses a 200 that carries an error instead of a token', async () => {
    const result = await client({
      token: () => json({ error: 'bad_verification_code' }),
    }).exchangeCode(CODE);

    expect(result.ok).toBe(false);
  });

  it('refuses a 200 carrying an empty token', async () => {
    const result = await client({ token: () => json({ access_token: '' }) }).exchangeCode(CODE);

    expect(result.ok).toBe(false);
  });

  it('refuses a token endpoint that fails outright', async () => {
    expect((await client({ token: () => json({}, 500) }).exchangeCode(CODE)).ok).toBe(false);
  });

  it('refuses a body it cannot read', async () => {
    const result = await client({
      token: () => new Response('<html>gateway</html>', { status: 200 }),
    }).exchangeCode(CODE);

    expect(result.ok).toBe(false);
  });

  it('refuses a user lookup that fails', async () => {
    expect((await client({ user: () => json({}, 401) }).exchangeCode(CODE)).ok).toBe(false);
  });

  // GitHub sends the id as a JSON number; a string would silently fail the
  // owner comparison later rather than here.
  it('refuses an account whose id is not a number', async () => {
    const result = await client({
      user: () => json({ id: '10808486', login: 'sergeantjonas' }),
    }).exchangeCode(CODE);

    expect(result.ok).toBe(false);
  });

  it('refuses a reachable network that answers nothing', async () => {
    const thrown = createGithubClient({
      clientId: 'Ov23liexample',
      clientSecret: CLIENT_SECRET,
      fetch: (() =>
        Promise.reject(
          new Error('ECONNREFUSED https://github.com/login/oauth'),
        )) as typeof globalThis.fetch,
    });

    expect((await thrown.exchangeCode(CODE)).ok).toBe(false);
  });

  // The request body carries the client secret and the code, so an error that
  // quoted the request would put both into the first log line that reported a
  // failed login.
  it('never names the secret or the code in the reason it gives', async () => {
    const failures = [
      client({ token: () => json({ error: 'bad_verification_code' }) }),
      client({ token: () => json({}, 500) }),
      client({ user: () => json({}, 401) }),
      createGithubClient({
        clientId: 'Ov23liexample',
        clientSecret: CLIENT_SECRET,
        fetch: (() =>
          Promise.reject(
            new Error(`failed with ${CLIENT_SECRET} and ${CODE}`),
          )) as typeof globalThis.fetch,
      }),
    ];

    for (const failing of failures) {
      const result = await failing.exchangeCode(CODE);

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.reason).not.toContain(CLIENT_SECRET);
      expect(result.reason).not.toContain(CODE);
    }
  });
});
