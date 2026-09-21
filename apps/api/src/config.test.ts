import { describe, expect, it } from 'vitest';
import { loadConfig, loadDatabaseUrl, loadPlexAccountIds } from './config.js';

const base = {
  DATABASE_URL: 'postgres://engram:engram@localhost:55432/engram',
  WEBHOOK_SECRET: 'a-secret-of-at-least-16-chars',
  GITHUB_OAUTH_CLIENT_ID: 'Ov23liexample',
  GITHUB_OAUTH_CLIENT_SECRET: 'a-client-secret',
  OWNER_GITHUB_USER_ID: '10808486',
  OAUTH_STATE_SECRET: 'b'.repeat(64),
  WEB_ORIGIN: 'http://localhost:2011',
};

describe('loadConfig', () => {
  it('accepts a complete environment', () => {
    const config = loadConfig({ ...base });
    expect(config.DATABASE_URL).toBe(base.DATABASE_URL);
    expect(config.PORT).toBe(2012);
  });

  // This API is publicly reachable so the media stack can post webhooks to it;
  // starting without a secret would leave the watch history open to anyone.
  it('refuses to start without a webhook secret', () => {
    const { WEBHOOK_SECRET: _omitted, ...withoutSecret } = base;
    expect(() => loadConfig(withoutSecret)).toThrow(/WEBHOOK_SECRET/);
  });

  it('refuses a webhook secret short enough to guess', () => {
    expect(() => loadConfig({ ...base, WEBHOOK_SECRET: 'short' })).toThrow(/at least 16/);
  });

  // The whole arc is unbuildable without these, and a 500 on the first login
  // attempt is a worse way to find that out than a process that will not start.
  it('refuses to start without the credentials the login flow needs', () => {
    for (const key of [
      'GITHUB_OAUTH_CLIENT_ID',
      'GITHUB_OAUTH_CLIENT_SECRET',
      'OWNER_GITHUB_USER_ID',
      'OAUTH_STATE_SECRET',
      'WEB_ORIGIN',
      // Literal types, so the destructure below knows these are keys of `base`
      // rather than any string.
    ] as const) {
      const { [key]: _omitted, ...without } = base;
      expect(() => loadConfig(without), key).toThrow(new RegExp(key));
    }
  });

  // A renamed login can be claimed by someone else, who would inherit the watch
  // history along with it.
  it('refuses a GitHub login where the numeric id belongs', () => {
    expect(() => loadConfig({ ...base, OWNER_GITHUB_USER_ID: 'sergeantjonas' })).toThrow(
      /numeric id/,
    );
  });

  // GitHub returns the id as a number, so a padded value can never equal the
  // string it is compared against and would lock the owner out of their own
  // history with the same answer a stranger gets.
  it('refuses an owner id that no GitHub response can equal', () => {
    expect(() => loadConfig({ ...base, OWNER_GITHUB_USER_ID: '0010808486' })).toThrow(/numeric id/);
  });

  it('refuses a state secret short enough to brute force', () => {
    expect(() => loadConfig({ ...base, OAUTH_STATE_SECRET: 'b'.repeat(63) })).toThrow(
      /at least 64/,
    );
  });

  // `next` is appended to this, and a trailing slash would build `//path`,
  // which a browser reads as a host rather than a path.
  it('refuses a web origin carrying a path or a trailing slash', () => {
    expect(() => loadConfig({ ...base, WEB_ORIGIN: 'http://localhost:2011/' })).toThrow(
      /origin a browser sends/,
    );
    expect(() => loadConfig({ ...base, WEB_ORIGIN: 'http://localhost:2011/app' })).toThrow(
      /origin a browser sends/,
    );
  });

  // A URL parser gives these an origin; a browser will never send one, so an
  // allowlist holding one is an entry that can only ever fail to match.
  it('refuses an origin no browser can present', () => {
    for (const origin of [
      'ftp://engram.example',
      'localhost:2011',
      // Normalized away by the parser, so none of these could ever equal an
      // Origin header the browser actually sends.
      'http://engram.example:80',
      'https://engram.example:443',
      'HTTP://engram.example',
      'https://EnGrAm.example',
      'https://user:pass@engram.example',
    ]) {
      expect(() => loadConfig({ ...base, WEB_ORIGIN: origin }), origin).toThrow(
        /origin a browser sends/,
      );
    }
    expect(() => loadConfig({ ...base, WEB_ORIGIN: 'not a url' })).toThrow(/absolute URL/);
  });

  it('accepts the origin the SPA will actually serve from', () => {
    expect(loadConfig({ ...base }).WEB_ORIGIN).toBe('http://localhost:2011');
    expect(loadConfig({ ...base, WEB_ORIGIN: 'https://engram.example' }).WEB_ORIGIN).toBe(
      'https://engram.example',
    );
  });

  it('refuses to start without a database url', () => {
    const { DATABASE_URL: _omitted, ...withoutUrl } = base;
    expect(() => loadConfig(withoutUrl)).toThrow(/DATABASE_URL/);
  });

  // Binding every interface on a public VPS would expose unauthenticated routes.
  it('binds loopback unless told otherwise', () => {
    expect(loadConfig({ ...base }).HOST).toBe('127.0.0.1');
  });

  it('never echoes secret values in validation errors', () => {
    const secret = 'super-secret-value-here';
    try {
      loadConfig({
        WEBHOOK_SECRET: secret,
        OAUTH_STATE_SECRET: secret,
        GITHUB_OAUTH_CLIENT_SECRET: secret,
      });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});

describe('loadDatabaseUrl', () => {
  // `db:migrate` and `import:plex` read nothing else, and a fresh deploy should
  // not have to register an OAuth app before it can create its tables.
  it('reads the database without the credentials the login flow needs', () => {
    expect(loadDatabaseUrl({ DATABASE_URL: base.DATABASE_URL })).toBe(base.DATABASE_URL);
  });

  it('still refuses to run with no database at all', () => {
    expect(() => loadDatabaseUrl({})).toThrow(/DATABASE_URL/);
  });
});

describe('PLEX_ACCOUNT_IDS', () => {
  // The server is shared, so the one setting that decides whose viewing is
  // kept must not fail open into "everyone".
  it('defaults to the server owner rather than to everyone', () => {
    expect(loadConfig({ ...base }).PLEX_ACCOUNT_IDS).toEqual(['1']);
    expect(loadPlexAccountIds({ ...base })).toEqual(['1']);
  });

  it('reads a list, tolerating the spaces a person types', () => {
    expect(loadConfig({ ...base, PLEX_ACCOUNT_IDS: '1, 7 ,12' }).PLEX_ACCOUNT_IDS).toEqual([
      '1',
      '7',
      '12',
    ]);
  });

  it('refuses anything that is not an account id', () => {
    expect(() => loadConfig({ ...base, PLEX_ACCOUNT_IDS: 'jonas' })).toThrow(/PLEX_ACCOUNT_IDS/);
    // Empty would be an allowlist that permits nobody, which is a typo rather
    // than an intent — and silently ingesting nothing is hard to notice.
    expect(() => loadConfig({ ...base, PLEX_ACCOUNT_IDS: ' , ' })).toThrow(/PLEX_ACCOUNT_IDS/);
  });
});
