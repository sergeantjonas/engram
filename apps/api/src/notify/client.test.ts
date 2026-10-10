import { describe, expect, it } from 'vitest';
import { createNotifyClient } from './client.js';

const SECRET = 's'.repeat(64);
const message = { key: 'ready@show:tvdb:452595/s01e0004', title: 'S01E04 is ready' };

const client = (answer: () => Response | Promise<Response>, seen: Request[] = []) =>
  createNotifyClient({
    origin: 'https://notify.test',
    secret: SECRET,
    fetch: (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
      seen.push(new Request(input, init));
      return answer();
    }) as typeof globalThis.fetch,
  });

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('createNotifyClient', () => {
  it('posts the message to /messages under its own secret', async () => {
    const seen: Request[] = [];
    await client(() => json({ duplicate: false }, 202), seen).post(message);

    const [request] = seen;
    expect(request?.method).toBe('POST');
    expect(request?.url).toBe('https://notify.test/messages');
    expect(request?.headers.get('authorization')).toBe(`Bearer ${SECRET}`);
    expect(await request?.json()).toEqual(message);
  });

  it('counts a 202 as taken, whether or not the hub had the key already', async () => {
    expect(await client(() => json({ duplicate: false }, 202)).post(message)).toEqual({
      outcome: 'taken',
      duplicate: false,
    });
    expect(await client(() => json({ duplicate: true }, 202)).post(message)).toEqual({
      outcome: 'taken',
      duplicate: true,
    });
  });

  it('counts a 400 or a 413 as the message refused, with the reason the hub gave', async () => {
    const said = { error: 'bad_request', message: 'title: Too big: expected string to have <=256' };
    expect(await client(() => json(said, 400)).post(message)).toEqual({
      outcome: 'refused',
      status: 400,
      reason: said.message,
    });
    expect(await client(() => new Response('<html>', { status: 413 })).post(message)).toEqual({
      outcome: 'refused',
      status: 413,
      reason: null,
    });
  });

  // A proxy answering in the hub's place must not mark alerts delivered.
  it('does not count a 200 as taken', async () => {
    expect(await client(() => new Response('', { status: 200 })).post(message)).toEqual({
      outcome: 'unavailable',
      status: 200,
    });
  });

  // A secret the hub does not know, or the hub down: nothing is wrong with
  // the message, so it is kept.
  it('counts a 401, a 5xx and no answer as the hub unavailable', async () => {
    expect(await client(() => json({}, 401)).post(message)).toEqual({
      outcome: 'unavailable',
      status: 401,
    });
    expect(await client(() => new Response('', { status: 502 })).post(message)).toEqual({
      outcome: 'unavailable',
      status: 502,
    });
    expect(await client(() => Promise.reject(new TypeError('fetch failed'))).post(message)).toEqual(
      { outcome: 'unavailable', status: null },
    );
  });
});
