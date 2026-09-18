import type { Database } from '../db/client.js';
import { SESSION_COOKIE } from './cookies.js';
import { SESSION_ABSOLUTE_TTL_MS, SESSION_TTL_MS } from './session.js';

/** The id the test `Config` calls the owner. */
export const OWNER_GITHUB_USER_ID = '10808486';

export const OWNER_TOKEN = 'an-owner-session-token';

/** Headers that carry a session the stubbed database will recognise. */
export const signedIn = { cookie: `${SESSION_COOKIE}=${OWNER_TOKEN}` };

export interface StubbedSession {
  githubUserId?: string;
  expiresAt?: Date;
  absoluteExpiresAt?: Date;
}

export interface SessionDb {
  db: Database;
  /** Rows the next raw `db.execute` answers with. Assign before the request. */
  rows: unknown[];
  /**
   * Result sets for consecutive `db.execute` calls, consumed in order.
   *
   * A route that reads twice — the title, then its grid — needs two different
   * answers, and one shared `rows` would hand the grid query a list of titles.
   */
  executions: unknown[][];
  /** Set when a row was reaped, and when the sliding window was rewritten. */
  deleted: number;
  extended: Date[];
}

/**
 * A database that knows one session and nothing else.
 *
 * It answers every lookup with the same row rather than matching on the hash,
 * and deletes unconditionally. Both predicates are drizzle's job and are
 * covered against the real table instead — a `resolveOwner` that selected on
 * the wrong column, or a `revokeSession` that dropped its `where` and ended
 * every session at once, would leave every test here green. Pass null for a
 * request whose cookie names nothing.
 */
export function sessionDb(session: StubbedSession | null = {}, now = new Date()): SessionDb {
  const row =
    session === null
      ? null
      : {
          githubUserId: session.githubUserId ?? OWNER_GITHUB_USER_ID,
          expiresAt: session.expiresAt ?? new Date(now.getTime() + SESSION_TTL_MS),
          absoluteExpiresAt:
            session.absoluteExpiresAt ?? new Date(now.getTime() + SESSION_ABSOLUTE_TTL_MS),
        };

  const state: SessionDb = {
    deleted: 0,
    extended: [],
    rows: [],
    executions: [],
    db: {
      // `db.execute` is the raw-SQL path; the queries that use it are verified
      // against the real table, so here it only replays what a test sets up.
      execute: async () => state.executions.shift() ?? state.rows,
      select: () => ({
        from: () => ({
          where: () => ({ limit: async () => (row === null ? [] : [row]) }),
        }),
      }),
      delete: () => ({
        where: async () => {
          state.deleted += 1;
        },
      }),
      update: () => ({
        set: (values: { expiresAt: Date }) => ({
          where: async () => {
            state.extended.push(values.expiresAt);
          },
        }),
      }),
    } as unknown as Database,
  };

  return state;
}
