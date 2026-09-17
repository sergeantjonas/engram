import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** Long enough for a GitHub authorize screen, short enough to be worthless later. */
export const STATE_TTL_MS = 10 * 60 * 1000;

/** Where the callback lands when `?next=` is absent or unsafe. */
export const DEFAULT_NEXT = '/';

/**
 * Longer than any real path into the SPA, and short enough that the state token
 * built around it stays inside what GitHub will carry through the redirect.
 */
const MAX_NEXT_LENGTH = 512;

/**
 * Anything outside printable ASCII.
 *
 * A control character in a `Location` header is header injection; everything
 * above `~` is rejected for a duller reason, which is that Node refuses to put
 * it in a header at all and would turn a crafted `?next=` into a 500. A real
 * path arrives percent-encoded, so nothing legitimate is lost.
 */
const NOT_PRINTABLE_ASCII = /[^\u0020-\u007e]/;

export interface StateClaims {
  /**
   * Matched against a cookie of the same value, so a state token minted for one
   * browser is useless in another. This is what defeats login-CSRF; the
   * signature only makes the payload around it trustworthy.
   */
  nonce: string;
  next: string;
  /** Epoch milliseconds. */
  exp: number;
}

export const newNonce = (): string => randomBytes(16).toString('base64url');

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

/**
 * Signs the OAuth `state` parameter.
 *
 * Signing rather than storing lets `next` ride through GitHub's redirect
 * without a server-side lookup, and without letting anyone rewrite where the
 * callback sends the browser.
 */
export function signState(claims: StateClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

function decodeClaims(payload: string): StateClaims | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;

  const { nonce, next, exp } = parsed as Record<string, unknown>;
  if (typeof nonce !== 'string' || typeof next !== 'string' || typeof exp !== 'number') {
    return null;
  }
  return { nonce, next, exp };
}

/** Null for anything that is not a live token this secret signed. */
export function verifyState(
  token: string | undefined,
  secret: string,
  now: Date,
): StateClaims | null {
  if (!token) return null;

  const dot = token.indexOf('.');
  if (dot <= 0) return null;

  const payload = token.slice(0, dot);
  const expected = sign(payload, secret);

  // Compared as the encoded strings rather than as the bytes they decode to:
  // base64url decoding is lenient, so two different signatures can decode
  // alike.
  const actual = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(expected);

  // Both buffers, because `timingSafeEqual` throws on a length mismatch and
  // measures bytes while a string measures UTF-16 units: one `é` in a
  // signature is one character and two bytes, so checking the strings would
  // let a crafted state through to throw. The length of an HMAC is not a
  // secret worth protecting.
  if (actual.length !== want.length) return null;
  if (!timingSafeEqual(actual, want)) return null;

  const claims = decodeClaims(payload);
  if (claims === null || claims.exp <= now.getTime()) return null;
  return claims;
}

/**
 * Clamps `?next=` to a path on the SPA's own origin.
 *
 * A signed state token guarantees the value arrived unmodified, not that it was
 * safe when it was signed — the login route accepts `next` from whoever calls
 * it, so an attacker can craft the whole link. Without this the endpoint is an
 * open redirect, borrowing this domain's credibility for a phishing landing.
 */
export function safeNextPath(next: unknown): string {
  if (typeof next !== 'string' || next === '') return DEFAULT_NEXT;
  if (next.length > MAX_NEXT_LENGTH) return DEFAULT_NEXT;
  if (!next.startsWith('/')) return DEFAULT_NEXT;
  // `//evil.example` is protocol-relative and leaves the site; browsers
  // normalise the backslash form to the same thing.
  if (next.startsWith('//') || next.startsWith('/\\')) return DEFAULT_NEXT;
  if (NOT_PRINTABLE_ASCII.test(next)) return DEFAULT_NEXT;
  return next;
}
