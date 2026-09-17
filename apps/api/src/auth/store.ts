import { eq } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { sessions as sessionTable } from '../db/schema.js';
import type { GithubIdentity } from '../github/client.js';
import {
  extendedExpiry,
  hashSessionToken,
  type IssuedSession,
  isExpired,
  issueSession,
} from './session.js';

/**
 * Writes a session and hands back the token that names it.
 *
 * The token is returned and never stored; the row carries its hash. The caller
 * is the only place it exists in the clear, and it goes straight into the
 * cookie from there.
 */
export async function createSession(
  db: Database,
  identity: GithubIdentity,
  now: Date,
): Promise<IssuedSession> {
  const session = issueSession(now);

  await db.insert(sessionTable).values({
    tokenHash: session.tokenHash,
    // Text, because that is what the owner check compares against: GitHub sends
    // a JSON number and the configured id is a string, so the conversion
    // happens once, here, rather than at every read.
    githubUserId: String(identity.id),
    createdAt: now,
    expiresAt: session.expiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
  });

  return session;
}

/**
 * Whether a cookie names a live session belonging to the owner.
 *
 * Every failure collapses to false on purpose: the caller has one decision to
 * make, and telling apart "no such session" from "expired" from "not the
 * owner" only says which half of a guess was right.
 *
 * Throws rather than answering false if the database is unreachable. On an API
 * with no public projection there is nothing to degrade to, and a read failure
 * that quietly became "not the owner" would lock the owner out while looking
 * like a permissions problem.
 */
export async function resolveOwner(
  db: Database,
  token: string | undefined,
  ownerGithubUserId: string,
  now: Date,
): Promise<boolean> {
  if (!token) return false;

  const tokenHash = hashSessionToken(token);
  const [session] = await db
    .select({
      githubUserId: sessionTable.githubUserId,
      expiresAt: sessionTable.expiresAt,
      absoluteExpiresAt: sessionTable.absoluteExpiresAt,
    })
    .from(sessionTable)
    .where(eq(sessionTable.tokenHash, tokenHash))
    .limit(1);

  if (!session) return false;

  if (isExpired(session, now)) {
    // Reaped on read. This is the only moment an expired row is known to exist
    // without scanning for one, which is cheaper than a timer that would run
    // mostly to find nothing.
    await db.delete(sessionTable).where(eq(sessionTable.tokenHash, tokenHash));
    return false;
  }

  // A session issued before `OWNER_GITHUB_USER_ID` changed is not the owner's,
  // whatever the row says. Checking on read rather than only on issue is what
  // makes changing that variable end every existing session at once.
  if (session.githubUserId !== ownerGithubUserId) return false;

  const extended = extendedExpiry(session, now);
  if (extended !== null) {
    await db
      .update(sessionTable)
      .set({ expiresAt: extended })
      .where(eq(sessionTable.tokenHash, tokenHash));
  }

  return true;
}
