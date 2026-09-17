import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgres://engram:engram@localhost:55432/engram',
  WEBHOOK_SECRET: 'a-secret-of-at-least-16-chars',
};

describe('loadConfig', () => {
  it('accepts a complete environment', () => {
    const config = loadConfig({ ...base });
    expect(config.DATABASE_URL).toBe(base.DATABASE_URL);
    expect(config.PORT).toBe(2012);
  });

  // This API is publicly reachable so the media stack can post webhooks to it;
  // starting without a secret would leave the watch history open to anyone.
  it('refuses to start without a webhook secret', () => {
    const { WEBHOOK_SECRET: _omitted, ...withoutSecret } = base;
    expect(() => loadConfig(withoutSecret)).toThrow(/WEBHOOK_SECRET/);
  });

  it('refuses a webhook secret short enough to guess', () => {
    expect(() => loadConfig({ ...base, WEBHOOK_SECRET: 'short' })).toThrow(/at least 16/);
  });

  it('refuses to start without a database url', () => {
    const { DATABASE_URL: _omitted, ...withoutUrl } = base;
    expect(() => loadConfig(withoutUrl)).toThrow(/DATABASE_URL/);
  });

  // Binding every interface on a public VPS would expose unauthenticated routes.
  it('binds loopback unless told otherwise', () => {
    expect(loadConfig({ ...base }).HOST).toBe('127.0.0.1');
  });

  it('never echoes secret values in validation errors', () => {
    const secret = 'super-secret-value-here';
    try {
      loadConfig({ WEBHOOK_SECRET: secret });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
