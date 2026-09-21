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
  /**
   * Result sets for consecutive typed `select` calls, consumed in order.
   *
   * The guard's session lookup is always the first, so a test that needs a
   * later select to come back empty has to supply the session row itself.
   * Left empty, every select answers with the session.
   */
  selects: unknown[][];
  /**
   * Writes made through `insert`, in order, each with the conflict clause it
   * used. The clause is recorded because it carries the semantics: an upsert
   * silently swapped for `onConflictDoNothing` would otherwise look identical.
   */
  inserted: { values: unknown; onConflict: 'update' | 'nothing'; set?: unknown }[];
  /**
   * Rows the next `.returning()` answers with, one result set per call, shared
   * by the upsert and the delete.
   */
  returns: unknown[][];
  /** Set when a row was reaped, and when the sliding window was rewritten. */
  deleted: number;
  /**
   * The condition each `delete` carried, in order.
   *
   * Kept for the same reason the insert keeps its conflict clause: a delete
   * that quietly lost a term from its predicate would otherwise pass every
   * test here while removing far more than it was asked to.
   */
  deletedWhere: unknown[];
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
    deletedWhere: [],
    extended: [],
    rows: [],
    executions: [],
    selects: [],
    inserted: [],
    returns: [],
    db: {
      // `db.execute` is the raw-SQL path; the queries that use it are verified
      // against the real table, so here it only replays what a test sets up.
      execute: async () => state.executions.shift() ?? state.rows,
      select: () => ({
        from: () => ({
          // Shifted once per query, not once per builder method: a chain
          // ending in `.limit()` would otherwise consume two answers and hand
          // the caller the one meant for the next query.
          where: () => {
            const answer = state.selects.shift() ?? (row === null ? [] : [row]);
            return Object.assign(Promise.resolve(answer), { limit: async () => answer });
          },
        }),
      }),
      insert: () => ({
        values: (values: unknown) => ({
          // Awaitable on its own and chainable to `.returning()`, the way
          // drizzle's builder is: a route that wants the row back must not
          // need a different stub from one that does not.
          onConflictDoUpdate: (config: { set?: unknown }) => {
            state.inserted.push({ values, onConflict: 'update', set: config?.set });
            const answer = state.returns.shift() ?? [];
            return Object.assign(Promise.resolve(answer), { returning: async () => answer });
          },
          // Chainable to `.returning()` like the upsert, because that is how
          // a caller learns whether the row was new: an insert that conflicted
          // returns nothing. The queued rows are taken by `returning()` rather
          // than here, so an insert that never asks for them does not eat the
          // set a later query queued.
          onConflictDoNothing: () => {
            state.inserted.push({ values, onConflict: 'nothing' });
            return Object.assign(Promise.resolve([]), {
              returning: async () => state.returns.shift() ?? [],
            });
          },
        }),
      }),
      delete: () => ({
        // Awaitable on its own and chainable to `.returning()`, like the
        // upsert above: reaping a session wants neither, and retracting a
        // mark counts what it removed. The queued rows are taken by
        // `returning()` rather than here, so a reap that never asks for them
        // does not eat the set a later test queued.
        where: (condition: unknown) => {
          state.deleted += 1;
          state.deletedWhere.push(condition);
          return Object.assign(Promise.resolve([]), {
            returning: async () => state.returns.shift() ?? [],
          });
        },
      }),
      update: () => ({
        set: (values: { expiresAt: Date }) => ({
          where: async () => {
            state.extended.push(values.expiresAt);
          },
        }),
      }),
      // Runs the callback against this same stub. The rows a transaction
      // writes are the thing under test; that they were written inside one is
      // drizzle's business, and verified against the real database instead.
      transaction: async <T>(fn: (tx: Database) => Promise<T>): Promise<T> => fn(state.db),
    } as unknown as Database,
  };

  return state;
}
