import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  extendedExpiry,
  hashSessionToken,
  isExpired,
  issueSession,
  SESSION_ABSOLUTE_TTL_MS,
  SESSION_EXTEND_AFTER_MS,
  SESSION_TTL_MS,
  type SessionWindow,
} from './session.js';

const now = new Date('2026-09-17T12:00:00.000Z');
const at = (ms: number): Date => new Date(now.getTime() + ms);

const window = (over: Partial<SessionWindow> = {}): SessionWindow => ({
  expiresAt: at(SESSION_TTL_MS),
  absoluteExpiresAt: at(SESSION_ABSOLUTE_TTL_MS),
  ...over,
});

describe('issueSession', () => {
  it('does not repeat a token', () => {
    const minted = new Set(Array.from({ length: 100 }, () => issueSession(now).token));

    expect(minted.size).toBe(100);
  });

  // Pinned, because uniqueness over a hundred draws would still hold if the
  // token shrank to a size worth guessing: 32 bytes is 43 base64url characters.
  it('carries the entropy a bearer token has to have', () => {
    expect(issueSession(now).token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  // The whole point of the table storing a hash: what is issued must never be
  // what is written down.
  it('hands out a token and stores only its hash', () => {
    const session = issueSession(now);

    expect(session.tokenHash).not.toBe(session.token);
    expect(session.tokenHash).toBe(createHash('sha256').update(session.token).digest('hex'));
    expect(session.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('sets both boundaries from the moment it was issued', () => {
    const session = issueSession(now);

    expect(session.expiresAt).toEqual(at(SESSION_TTL_MS));
    expect(session.absoluteExpiresAt).toEqual(at(SESSION_ABSOLUTE_TTL_MS));
  });
});

describe('hashSessionToken', () => {
  it('is stable, so a cookie presented twice finds the same row', () => {
    expect(hashSessionToken('a-token')).toBe(hashSessionToken('a-token'));
    expect(hashSessionToken('a-token')).not.toBe(hashSessionToken('b-token'));
  });
});

describe('isExpired', () => {
  it('is over when either boundary has passed', () => {
    expect(isExpired(window(), now)).toBe(false);
    expect(isExpired(window({ expiresAt: now }), now)).toBe(true);
    expect(isExpired(window({ absoluteExpiresAt: now }), now)).toBe(true);
  });

  // A session in continuous use would otherwise never end, which is the reason
  // the ceiling exists at all.
  it('ends a session still inside its sliding window but past the ceiling', () => {
    const session = window({ expiresAt: at(SESSION_TTL_MS), absoluteExpiresAt: at(-1) });

    expect(isExpired(session, now)).toBe(true);
  });
});

describe('extendedExpiry', () => {
  // Without this, reading a session would be a write on every request.
  it('does not move a window that has barely drifted', () => {
    const session = window({ expiresAt: at(SESSION_TTL_MS - SESSION_EXTEND_AFTER_MS + 1000) });

    expect(extendedExpiry(session, now)).toBeNull();
  });

  it('moves a window that has drifted far enough to be worth a write', () => {
    const session = window({ expiresAt: at(SESSION_TTL_MS - SESSION_EXTEND_AFTER_MS - 1000) });

    expect(extendedExpiry(session, now)).toEqual(at(SESSION_TTL_MS));
  });

  it('never extends past the ceiling', () => {
    const ceiling = at(SESSION_TTL_MS - 1000);
    // Still live, but only just: the window has every reason to move and the
    // ceiling is the only thing stopping it.
    const session = window({ expiresAt: at(1000), absoluteExpiresAt: ceiling });

    expect(extendedExpiry(session, now)).toEqual(ceiling);
  });

  // The caller is meant to delete the row first, but this is reachable on its
  // own and must not be the thing that brings a session back.
  it('does not revive a session that has already run out', () => {
    expect(extendedExpiry(window({ expiresAt: at(-1) }), now)).toBeNull();
    expect(extendedExpiry(window({ absoluteExpiresAt: at(-1) }), now)).toBeNull();
  });

  it('writes nothing once the ceiling has already been reached', () => {
    const reached = at(0);
    const session = window({ expiresAt: reached, absoluteExpiresAt: reached });

    expect(extendedExpiry(session, now)).toBeNull();
  });
});
