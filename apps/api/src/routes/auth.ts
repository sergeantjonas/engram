import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  type CookieOptions,
  expireCookie,
  isSecureOrigin,
  parseCookieHeader,
  SESSION_COOKIE,
  STATE_COOKIE,
  serializeCookie,
} from '../auth/cookies.js';
import { SESSION_TTL_MS } from '../auth/session.js';
import {
  DEFAULT_NEXT,
  newNonce,
  STATE_TTL_MS,
  safeNextPath,
  signState,
  verifyState,
} from '../auth/state.js';
import { createSession } from '../auth/store.js';
import type { Config } from '../config.js';
import type { Database } from '../db/client.js';
import { GITHUB_ISSUER, type GithubClient, type GithubIdentity } from '../github/client.js';

/** Why a login round-trip ended early. Read by the SPA's login screen, never by a guard. */
type DenyReason = 'state' | 'github' | 'forbidden';

const loginQuery = z.object({ next: z.string().max(512).optional() });

/**
 * Everything GitHub can put on the callback.
 *
 * Bounded rather than merely accepted: `state` is about to be HMAC'd and the
 * rest may be reflected into a redirect, so a caller does not get to choose
 * how much work a public endpoint does.
 */
const callbackQuery = z.object({
  code: z.string().max(512).optional(),
  state: z.string().max(2048).optional(),
  error: z.string().max(64).optional(),
  iss: z.string().max(256).optional(),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  db: Database,
  config: Config,
  github: GithubClient,
): void {
  const cookie = (maxAgeMs: number): CookieOptions => ({
    maxAgeMs,
    secure: isSecureOrigin(config.WEB_ORIGIN),
    domain: config.SESSION_COOKIE_DOMAIN,
  });

  const isOwner = (identity: GithubIdentity): boolean =>
    String(identity.id) === config.OWNER_GITHUB_USER_ID;

  const deny = (reply: FastifyReply, reason: DenyReason, next: string): FastifyReply => {
    const params = new URLSearchParams({ error: reason, next: safeNextPath(next) });
    return reply.redirect(`${config.WEB_ORIGIN}/login?${params.toString()}`, 302);
  };

  app.get('/auth/github/login', async (request, reply) => {
    const parsed = loginQuery.safeParse(request.query);
    const nonce = newNonce();
    const state = signState(
      {
        nonce,
        // Clamped before it is signed, not after: the signature proves the value
        // arrived unmodified, never that it was safe when it was minted.
        next: safeNextPath(parsed.success ? parsed.data.next : undefined),
        exp: Date.now() + STATE_TTL_MS,
      },
      config.OAUTH_STATE_SECRET,
    );

    return reply
      .header('set-cookie', serializeCookie(STATE_COOKIE, nonce, cookie(STATE_TTL_MS)))
      .redirect(github.authorizeUrl(state), 302);
  });

  app.get('/auth/github/callback', async (request, reply) => {
    const nonce = parseCookieHeader(request.headers.cookie)[STATE_COOKIE];
    // One-shot whatever happens next: a state cookie surviving a failed attempt
    // is a replay window.
    // Burned on the reply here rather than collected and sent with whatever
    // response is built later: a session write that throws would otherwise
    // answer 500 carrying no `Set-Cookie` at all, leaving the nonce live for
    // the rest of the state's ten minutes.
    reply.header('set-cookie', expireCookie(STATE_COOKIE, cookie(0)));

    const parsed = callbackQuery.safeParse(request.query);
    if (!parsed.success) return deny(reply, 'state', DEFAULT_NEXT);
    const query = parsed.data;

    const claims = verifyState(query.state, config.OAUTH_STATE_SECRET, new Date());
    // The nonce match is what pins this callback to the browser that started
    // the handshake. Without it a signed state token from anywhere logs anyone
    // in, which is the whole of login-CSRF.
    if (claims === null || nonce === undefined || claims.nonce !== nonce) {
      return deny(reply, 'state', DEFAULT_NEXT);
    }

    // A response carrying someone else's issuer is not this handshake's.
    // Absent is accepted because only the authorisation server decides whether
    // to send it, and requiring it would turn a GitHub-side change into a
    // total login outage.
    if (query.iss !== undefined && query.iss !== GITHUB_ISSUER) {
      return deny(reply, 'state', claims.next);
    }

    // GitHub sends `?error=access_denied` instead of a code when authorisation
    // is declined; there is nothing to exchange.
    if (query.error !== undefined || !query.code) {
      return deny(reply, 'github', claims.next);
    }

    const exchange = await github.exchangeCode(query.code);
    if (!exchange.ok) {
      request.log.warn({ reason: exchange.reason }, 'github login failed');
      return deny(reply, 'github', claims.next);
    }
    if (!isOwner(exchange.identity)) {
      // The login, not the id: the id is the configured secret-ish value being
      // compared against, and logging both sides of a comparison is how it ends
      // up somewhere it should not be.
      request.log.warn({ login: exchange.identity.login }, 'login refused, not the owner');
      return deny(reply, 'forbidden', claims.next);
    }

    const session = await createSession(db, exchange.identity, new Date());
    reply.header(
      'set-cookie',
      serializeCookie(SESSION_COOKIE, session.token, cookie(SESSION_TTL_MS)),
    );

    // Clamped again on the way out. The signature proves the value is the one
    // that was minted, never that minting clamped it — and this is the line
    // that concatenates, where a `next` of `@evil.example` turns the origin
    // into userinfo and the browser resolves a different host entirely. The
    // mint-side call is the real defence; this one is what survives someone
    // later adding a second way to mint a state.
    return reply.redirect(`${config.WEB_ORIGIN}${safeNextPath(claims.next)}`, 302);
  });
}
