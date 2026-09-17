const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const TIMEOUT_MS = 10_000;

/**
 * The `iss` GitHub puts on the authorisation response (RFC 9207).
 *
 * Compared exactly where it appears: a value that is present and different did
 * not come from the server this handshake was started with.
 */
export const GITHUB_ISSUER = 'https://github.com/login/oauth';

/** Everything this project needs to know about who authorised. */
export interface GithubIdentity {
  id: number;
  login: string;
}

/**
 * Why an exchange produced no identity.
 *
 * A reason rather than a thrown error, because the callback has exactly one
 * decision to make and every failure leads to the same denial. The strings are
 * fixed: the request carries the client secret and the code, and neither
 * belongs in a log line.
 */
export type ExchangeResult = { ok: true; identity: GithubIdentity } | { ok: false; reason: string };

export interface GithubClient {
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<ExchangeResult>;
}

export interface GithubClientOptions {
  clientId: string;
  clientSecret: string;
  /** Injected so the client is testable without a network or a registration. */
  fetch?: typeof globalThis.fetch;
  authorizeUrl?: string;
  tokenUrl?: string;
  userUrl?: string;
  timeoutMs?: number;
}

export function createGithubClient(options: GithubClientOptions): GithubClient {
  const {
    clientId,
    clientSecret,
    fetch = globalThis.fetch,
    authorizeUrl = AUTHORIZE_URL,
    tokenUrl = TOKEN_URL,
    userUrl = USER_URL,
    timeoutMs = TIMEOUT_MS,
  } = options;

  async function requestAccessToken(code: string): Promise<string | { reason: string }> {
    let response: Response;
    try {
      response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      // Never the caught error: its message or cause can carry the request, and
      // the request body holds the client secret.
      return { reason: 'the token exchange could not be reached' };
    }

    if (!response.ok) return { reason: `the token exchange answered ${response.status}` };

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { reason: 'the token exchange sent an unreadable body' };
    }

    // GitHub answers 200 with `{ error }` for a bad or replayed code rather
    // than a 4xx, so the status alone does not say the exchange worked. The
    // presence of a token is the success condition.
    const token = (body as { access_token?: unknown }).access_token;
    if (typeof token !== 'string' || token === '') {
      return { reason: 'the token exchange returned no access token' };
    }
    return token;
  }

  async function requestIdentity(accessToken: string): Promise<ExchangeResult> {
    let response: Response;
    try {
      response = await fetch(userUrl, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      return { ok: false, reason: 'the user lookup could not be reached' };
    }

    if (!response.ok) return { ok: false, reason: `the user lookup answered ${response.status}` };

    let body: { id?: unknown; login?: unknown };
    try {
      body = (await response.json()) as { id?: unknown; login?: unknown };
    } catch {
      return { ok: false, reason: 'the user lookup sent an unreadable body' };
    }

    if (typeof body.id !== 'number' || typeof body.login !== 'string') {
      return { ok: false, reason: 'the user lookup named no account' };
    }
    return { ok: true, identity: { id: body.id, login: body.login } };
  }

  return {
    /**
     * GitHub's authorize screen.
     *
     * No `scope`: `GET /user` returns the authorising account's id with no
     * scope granted at all, and that is the entire fact this app needs. No
     * `redirect_uri` either — omitted, GitHub uses the callback registered on
     * the OAuth app, so where the browser lands cannot be steered from a
     * crafted link.
     */
    authorizeUrl(state) {
      const params = new URLSearchParams({ client_id: clientId, state, allow_signup: 'false' });
      return `${authorizeUrl}?${params.toString()}`;
    },

    /**
     * Trades the callback's `code` for the identity behind it.
     *
     * The access token is used once, here, and never stored: the only fact
     * worth keeping is which account authorised, and re-deriving that is a
     * fresh login rather than a credential to protect.
     */
    async exchangeCode(code) {
      const token = await requestAccessToken(code);
      if (typeof token !== 'string') return { ok: false, reason: token.reason };
      return await requestIdentity(token);
    },
  };
}
