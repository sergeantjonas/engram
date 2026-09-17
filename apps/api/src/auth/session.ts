import { createHash, randomBytes } from 'node:crypto';

/** How long a session lives from its last use. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The ceiling the sliding window cannot outrun, so a session in continuous use
 * still ends rather than living forever.
 */
export const SESSION_ABSOLUTE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * How far the window has to have drifted before extending it is worth a write.
 *
 * Without this, reading a session would be a write on every request. Sliding
 * expiry is a convenience, not an audit trail, so paying for it per request
 * would be pure cost.
 */
export const SESSION_EXTEND_AFTER_MS = 24 * 60 * 60 * 1000;

/** What the cookie carries, and what the row it belongs to has to hold. */
export interface IssuedSession {
  /** Goes to the browser and is never stored. */
  token: string;
  tokenHash: string;
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

/** The lifetime columns of a stored session, which is all the expiry rules read. */
export interface SessionWindow {
  expiresAt: Date;
  absoluteExpiresAt: Date;
}

/**
 * SHA-256, hex.
 *
 * Only this reaches the database. A leaked backup then yields nothing a caller
 * can present, which is not true of a JWT signed with a key that sits in the
 * same environment as the dump.
 */
export const hashSessionToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export function issueSession(now: Date): IssuedSession {
  const token = randomBytes(32).toString('base64url');
  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    absoluteExpiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
  };
}

/**
 * Both boundaries, because a session that has run out either way is over. The
 * caller deletes the row rather than leaving it to a timer.
 */
export const isExpired = (session: SessionWindow, now: Date): boolean =>
  session.expiresAt <= now || session.absoluteExpiresAt <= now;

/**
 * The new `expires_at`, or null when the read should not become a write.
 *
 * Null covers both reasons not to write: the window has barely moved, and the
 * ceiling has already been reached so there is nothing left to extend.
 */
export function extendedExpiry(session: SessionWindow, now: Date): Date | null {
  // A session that has already run out is not extended back to life. The caller
  // is meant to check first and delete the row, but this is a pure function
  // reachable on its own and must not be the thing that revives it.
  if (isExpired(session, now)) return null;

  const extended = new Date(now.getTime() + SESSION_TTL_MS);
  if (extended.getTime() - session.expiresAt.getTime() < SESSION_EXTEND_AFTER_MS) return null;

  // The sliding window may never outrun the ceiling — that is the whole reason
  // the ceiling exists.
  const capped = extended > session.absoluteExpiresAt ? session.absoluteExpiresAt : extended;
  return capped > session.expiresAt ? capped : null;
}
