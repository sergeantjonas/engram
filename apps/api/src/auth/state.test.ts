import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NEXT,
  newNonce,
  STATE_TTL_MS,
  type StateClaims,
  safeNextPath,
  signState,
  verifyState,
} from './state.js';

const SECRET = 'a'.repeat(64);
const now = new Date('2026-09-17T12:00:00.000Z');

const claims = (over: Partial<StateClaims> = {}): StateClaims => ({
  nonce: 'a-nonce',
  next: '/titles',
  exp: now.getTime() + STATE_TTL_MS,
  ...over,
});

describe('newNonce', () => {
  it('does not repeat', () => {
    const minted = new Set(Array.from({ length: 100 }, newNonce));

    expect(minted.size).toBe(100);
  });

  // Pinned, because uniqueness over a hundred draws would still hold if the
  // nonce shrank to a size worth guessing: 16 bytes is 22 base64url characters.
  it('carries the entropy that makes it worth checking', () => {
    expect(newNonce()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});

describe('signState / verifyState', () => {
  it('returns the claims it was given', () => {
    const token = signState(claims(), SECRET);

    expect(verifyState(token, SECRET, now)).toEqual(claims());
  });

  it('refuses a token signed with another secret', () => {
    const token = signState(claims(), 'b'.repeat(64));

    expect(verifyState(token, SECRET, now)).toBeNull();
  });

  // The signature is what makes the payload around the nonce trustworthy; if a
  // rewritten `next` survived, the state would be an open redirect again.
  it('refuses a payload edited after signing', () => {
    const token = signState(claims(), SECRET);
    const [payload, signature] = token.split('.');
    const edited = Buffer.from(JSON.stringify(claims({ next: '//evil.example' }))).toString(
      'base64url',
    );

    expect(verifyState(`${edited}.${signature}`, SECRET, now)).toBeNull();
    expect(payload).not.toBe(edited);
  });

  it('refuses an edited signature', () => {
    const token = signState(claims(), SECRET);
    const [payload, signature] = token.split('.');
    const flipped = `${signature?.slice(0, -1)}${signature?.endsWith('A') ? 'B' : 'A'}`;

    expect(verifyState(`${payload}.${flipped}`, SECRET, now)).toBeNull();
  });

  // `timingSafeEqual` throws on a length mismatch, so a signature of the wrong
  // size has to be turned away before it gets there.
  it('refuses a signature of the wrong length without throwing', () => {
    const token = signState(claims(), SECRET);
    const [payload, signature] = token.split('.');

    const wrongLength = [
      signature?.slice(0, 10),
      '',
      // One character, two UTF-8 bytes: the string lengths match and the byte
      // lengths do not, which is the case that makes the comparison throw
      // rather than return.
      `${signature?.slice(0, -1)}é`,
      `${signature?.slice(0, -2)}🙂`,
    ];

    for (const candidate of wrongLength) {
      expect(() => verifyState(`${payload}.${candidate}`, SECRET, now), candidate).not.toThrow();
      expect(verifyState(`${payload}.${candidate}`, SECRET, now), candidate).toBeNull();
    }
  });

  it('refuses a token that has run out', () => {
    const token = signState(claims({ exp: now.getTime() }), SECRET);

    expect(verifyState(token, SECRET, now)).toBeNull();
    expect(verifyState(token, SECRET, new Date(now.getTime() - 1))).not.toBeNull();
  });

  it('refuses anything that is not a token', () => {
    for (const token of [undefined, '', '.', '.signature', 'no-dot', 'a.b.c']) {
      expect(verifyState(token, SECRET, now), String(token)).toBeNull();
    }
  });

  // Genuinely signed with this secret, so the HMAC check passes and the shape
  // check is the only thing standing between the payload and the caller.
  it('refuses a correctly signed payload that is not a set of claims', () => {
    const properlySigned = (json: string): string => {
      const payload = Buffer.from(json).toString('base64url');
      const signature = createHmac('sha256', SECRET).update(payload).digest('base64url');
      return `${payload}.${signature}`;
    };

    for (const json of [
      'null',
      '"a string"',
      'not json at all',
      '{"nonce":"n","next":"/"}',
      '{"nonce":"n","next":"/","exp":"soon"}',
    ]) {
      expect(verifyState(properlySigned(json), SECRET, now), json).toBeNull();
    }

    // The same construction with a whole set of claims does come back, so the
    // rejections above are the shape check rather than a broken signature.
    expect(verifyState(properlySigned(JSON.stringify(claims())), SECRET, now)).toEqual(claims());
  });
});

describe('safeNextPath', () => {
  it('keeps a path on this site', () => {
    expect(safeNextPath('/titles/123')).toBe('/titles/123');
    expect(safeNextPath('/search?q=one+piece')).toBe('/search?q=one+piece');
  });

  // The login route takes `next` from whoever calls it, so the whole link can
  // be crafted; without this the endpoint is an open redirect.
  it('refuses to leave the site', () => {
    for (const next of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      'titles',
    ]) {
      expect(safeNextPath(next), next).toBe(DEFAULT_NEXT);
    }
  });

  it('refuses a value that would inject a header', () => {
    expect(safeNextPath('/titles\r\nLocation: https://evil.example')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/titles\nSet-Cookie: a=b')).toBe(DEFAULT_NEXT);
  });

  // Node refuses to put these in a header at all, so passing one through would
  // turn a crafted link into a 500 rather than a redirect. A real path arrives
  // percent-encoded and is unaffected.
  it('refuses what a header cannot carry, and keeps its encoded form', () => {
    expect(safeNextPath('/☃')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/\u2028')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/\u202e')).toBe(DEFAULT_NEXT);
    expect(safeNextPath('/%E2%98%83')).toBe('/%E2%98%83');
  });

  it('refuses a path too long to be real', () => {
    expect(safeNextPath(`/${'a'.repeat(512)}`)).toBe(DEFAULT_NEXT);
  });

  it('falls back rather than failing, so a bad link still signs you in', () => {
    for (const next of [undefined, null, '', 42, {}]) {
      expect(safeNextPath(next), String(next)).toBe(DEFAULT_NEXT);
    }
  });
});
