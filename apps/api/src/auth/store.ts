import type { Database } from '../db/client.js';
import { sessions as sessionTable } from '../db/schema.js';
import type { GithubIdentity } from '../github/client.js';
import { type IssuedSession, issueSession } from './session.js';

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
