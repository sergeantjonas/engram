import { describe, expect, it } from 'vitest';
import {
  expireCookie,
  isSecureOrigin,
  parseCookieHeader,
  SESSION_COOKIE,
  serializeCookie,
} from './cookies.js';

const options = { maxAgeMs: 60_000, secure: false, domain: undefined };

describe('isSecureOrigin', () => {
  // The API sits behind a TLS proxy and sees plain HTTP on its own socket, so
  // the SPA's scheme is the only honest signal it has.
  it('follows the scheme the SPA is served over', () => {
    expect(isSecureOrigin('https://engram.example')).toBe(true);
    expect(isSecureOrigin('http://localhost:2011')).toBe(false);
  });
});

describe('serializeCookie', () => {
  it('writes the attributes a session cookie needs', () => {
    const header = serializeCookie(SESSION_COOKIE, 'a-token', options);

    expect(header).toContain(`${SESSION_COOKIE}=a-token`);
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
  });

  // The header takes seconds while every cookie library takes milliseconds, so
  // getting this backwards would make a 30-day session last 43 minutes.
  it('writes Max-Age in seconds', () => {
    expect(serializeCookie('a', 'b', { ...options, maxAgeMs: 30_000 })).toContain('Max-Age=30');
  });

  it('marks the cookie secure only when told to', () => {
    expect(serializeCookie('a', 'b', options)).not.toContain('Secure');
    expect(serializeCookie('a', 'b', { ...options, secure: true })).toContain('Secure');
  });

  it('names a domain only when there is one', () => {
    expect(serializeCookie('a', 'b', options)).not.toContain('Domain');
    expect(serializeCookie('a', 'b', { ...options, domain: 'engram.example' })).toContain(
      'Domain=engram.example',
    );
  });

  it('escapes a value that would otherwise end the cookie early', () => {
    const header = serializeCookie('a', 'one; Path=/evil', options);

    expect(header.split(';')[0]).toBe('a=one%3B%20Path%3D%2Fevil');
  });
});

describe('expireCookie', () => {
  // The attributes have to match the ones it was set with, or the browser
  // clears nothing and keeps the cookie it already has.
  it('clears a cookie with the attributes it was set with', () => {
    const header = expireCookie(SESSION_COOKIE, { secure: true, domain: 'engram.example' });

    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Path=/');
    expect(header).toContain('Secure');
    expect(header).toContain('Domain=engram.example');
  });
});

describe('parseCookieHeader', () => {
  it('reads a header a browser would send', () => {
    expect(parseCookieHeader('engram_session=abc; engram_oauth_state=def')).toEqual({
      engram_session: 'abc',
      engram_oauth_state: 'def',
    });
  });

  it('has nothing to say about a request carrying no cookies', () => {
    expect(parseCookieHeader(undefined)).toEqual({});
    expect(parseCookieHeader('')).toEqual({});
  });

  // A later duplicate is the one an attacker could have tossed in from a
  // sibling subdomain; browsers send the narrower cookie first.
  it('keeps the first of a duplicated name', () => {
    expect(parseCookieHeader('a=mine; a=theirs')).toEqual({ a: 'mine' });
  });

  it('skips a pair that is not one', () => {
    expect(parseCookieHeader('novalue; =orphan; a=b')).toEqual({ a: 'b' });
  });

  it('survives a value that is not an encoding', () => {
    expect(parseCookieHeader('a=100%')).toEqual({ a: '100%' });
  });

  it('reads back what it wrote', () => {
    const value = 'one; Path=/evil';
    const header = serializeCookie('a', value, options).split(';')[0] ?? '';

    expect(parseCookieHeader(header)).toEqual({ a: value });
  });
});
