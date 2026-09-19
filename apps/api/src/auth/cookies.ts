/** The owner's session. An opaque random value; only its hash is stored. */
export const SESSION_COOKIE = 'engram_session';

/** Short-lived nonce pinning an OAuth callback to the browser that started it. */
export const STATE_COOKIE = 'engram_oauth_state';

export interface CookieOptions {
  maxAgeMs: number;
  secure: boolean;
  domain?: string | undefined;
}

/**
 * Whether the cookie should be marked `Secure`, read off the SPA's origin.
 *
 * The API sits behind a TLS proxy and sees plain HTTP on its own socket, so it
 * cannot answer this by looking at the request. The SPA's scheme is the honest
 * signal: the two are both HTTPS in production and both HTTP on localhost, and
 * deriving it costs one variable fewer than a `NODE_ENV` to get wrong.
 */
export const isSecureOrigin = (webOrigin: string): boolean => webOrigin.startsWith('https://');

/**
 * Builds a `Set-Cookie` value.
 *
 * Hand-rolled rather than pulling in a cookie plugin: Fastify has neither half
 * natively, this project sets exactly two cookies whose values are base64url,
 * and the whole of the syntax it needs is below.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    // Seconds here, not milliseconds. Every cookie library takes one or the
    // other and the header itself takes seconds.
    `Max-Age=${Math.floor(options.maxAgeMs / 1000)}`,
    'Path=/',
    'HttpOnly',
    // Lax is what makes CSRF a non-issue: the cookie rides top-level
    // navigations, so returning from GitHub carries it, and a top-level
    // navigation can only ever be a GET. Nothing cross-site can drive a POST,
    // PUT or DELETE here with the cookie attached — a form cannot emit the
    // latter two at all, and they are never simple requests, so they are
    // preflighted against an origin allowlist first.
    'SameSite=Lax',
  ];
  if (options.secure) parts.push('Secure');
  if (options.domain) parts.push(`Domain=${options.domain}`);
  return parts.join('; ');
}

/**
 * A `Set-Cookie` that removes one.
 *
 * The attributes have to match the ones it was set with or the browser clears
 * nothing and keeps the cookie it already has.
 */
export const expireCookie = (name: string, options: Omit<CookieOptions, 'maxAgeMs'>): string =>
  serializeCookie(name, '', { ...options, maxAgeMs: 0 });

/**
 * Reads a `Cookie` request header.
 *
 * The parsing half of the same decision: Fastify hands over the raw header and
 * nothing else.
 */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;

  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;

    const name = pair.slice(0, eq).trim();
    // First occurrence wins, matching how browsers resolve a duplicate name: a
    // cookie set on a narrower path is sent first, and a later duplicate is the
    // one an attacker could have tossed in from a sibling subdomain.
    if (name === '' || name in cookies) continue;

    cookies[name] = decodeValue(pair.slice(eq + 1).trim());
  }
  return cookies;
}

function decodeValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    // A stray `%` is not an encoding — take the bytes as they came rather than
    // dropping a cookie the browser considers perfectly valid.
    return raw;
  }
}
