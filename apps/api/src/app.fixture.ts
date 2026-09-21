import { OWNER_GITHUB_USER_ID } from './auth/session.fixture.js';
import type { Config } from './config.js';
import type { GithubClient } from './github/client.js';

export const WEB_ORIGIN = 'http://localhost:2011';

/** What `loadConfig` would have produced, for a test that drives `buildApp`. */
export const testConfig: Config = {
  DATABASE_URL: 'postgres://unused',
  PLEX_ACCOUNT_IDS: ['1'],
  WEBHOOK_SECRET: 'x'.repeat(16),
  PORT: 0,
  HOST: '127.0.0.1',
  LOG_LEVEL: 'fatal',
  GITHUB_OAUTH_CLIENT_ID: 'Ov23liexample',
  GITHUB_OAUTH_CLIENT_SECRET: 'a-client-secret',
  OWNER_GITHUB_USER_ID,
  OAUTH_STATE_SECRET: 'b'.repeat(64),
  WEB_ORIGIN,
};

/** Enough of a client for `buildApp`; the suites that exercise it pass their own. */
export const githubStub: GithubClient = {
  authorizeUrl: () => 'https://github.test/authorize',
  exchangeCode: async () => ({ ok: false, reason: 'unused' }),
};
