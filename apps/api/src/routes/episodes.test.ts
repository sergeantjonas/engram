import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { githubStub, testConfig } from '../app.fixture.js';
import { buildApp } from '../app.js';
import {
  OWNER_GITHUB_USER_ID,
  type SessionDb,
  sessionDb,
  signedIn,
} from '../auth/session.fixture.js';

const EPISODE = '97415017-7272-42b9-8b41-169d707f8004';

let app: FastifyInstance | undefined;

const start = (): SessionDb => {
  const stub = sessionDb();
  app = buildApp({ config: testConfig, db: stub.db, tmdb: null, github: githubStub });
  return stub;
};

const put = (server: FastifyInstance, payload: unknown, id = EPISODE) =>
  server.inject({
    method: 'PUT',
    url: `/episodes/${id}/gap`,
    payload: payload as object,
    headers: signedIn,
  });

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('PUT /episodes/:id/gap', () => {
  it('records what the viewer says about a hole', async () => {
    const stub = start();

    const response = await put(app as FastifyInstance, {
      reason: 'missing',
      note: 'never downloaded',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ gap: { reason: 'missing', note: 'never downloaded' } });
    expect(stub.inserted).toEqual([
      expect.objectContaining({
        values: expect.objectContaining({
          episodeId: EPISODE,
          reason: 'missing',
          note: 'never downloaded',
        }),
        onConflict: 'update',
      }),
    ]);
  });

  it('accepts a reason with no note', async () => {
    const stub = start();

    const response = await put(app as FastifyInstance, { reason: 'skipped' });

    expect(response.json()).toEqual({ gap: { reason: 'skipped', note: null } });
    expect(stub.inserted).toEqual([
      expect.objectContaining({ values: expect.objectContaining({ note: null }) }),
    ]);
  });

  // An empty note and no note are the same thing; storing `''` would make the
  // grid render a blank annotation.
  it('treats a blank note as no note', async () => {
    start();

    const response = await put(app as FastifyInstance, { reason: 'skipped', note: '   ' });

    expect(response.json().gap.note).toBeNull();
  });

  // The defining semantic: this is a current answer, so a second opinion
  // replaces the first rather than sitting beside it. Swapping the upsert for
  // an insert-if-absent would leave the first answer in place forever.
  it('overwrites a previous answer rather than adding one', async () => {
    const stub = start();

    await put(app as FastifyInstance, { reason: 'missing', note: 'never downloaded' });
    await put(app as FastifyInstance, { reason: 'skipped' });

    expect(stub.inserted).toHaveLength(2);
    expect(stub.inserted[1]?.onConflict).toBe('update');
    expect(stub.inserted[1]?.set).toMatchObject({ reason: 'skipped', note: null });
  });

  it('refuses a reason that is not one of the two', async () => {
    start();

    expect((await put(app as FastifyInstance, { reason: 'bored' })).statusCode).toBe(400);
    expect((await put(app as FastifyInstance, {})).statusCode).toBe(400);
  });

  it('refuses an id that is not one', async () => {
    start();

    const response = await put(app as FastifyInstance, { reason: 'skipped' }, 'one-piece-s2e5');

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toContain('id');
  });

  it('refuses a note long enough to be something else', async () => {
    start();

    const response = await put(app as FastifyInstance, {
      reason: 'skipped',
      note: 'x'.repeat(501),
    });

    expect(response.statusCode).toBe(400);
  });

  // Checked rather than left to the foreign key, which would surface as a 500
  // quoting a constraint name.
  it('answers 404 for an episode that does not exist', async () => {
    const stub = start();
    // The guard's session lookup, then an empty answer for the episode. The
    // dates have to be real: `null <= now` is true, so a null expiry would read
    // as an expired session and answer 401 before the episode is ever looked up.
    const live = new Date(Date.now() + 86_400_000);
    stub.selects = [
      [{ githubUserId: OWNER_GITHUB_USER_ID, expiresAt: live, absoluteExpiresAt: live }],
      [],
    ];

    const response = await put(app as FastifyInstance, { reason: 'skipped' });

    expect(response.statusCode).toBe(404);
    expect(stub.inserted).toHaveLength(0);
  });

  it('is behind the guard like everything else', async () => {
    start();

    const response = await (app as FastifyInstance).inject({
      method: 'PUT',
      url: `/episodes/${EPISODE}/gap`,
      payload: { reason: 'skipped' },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('DELETE /episodes/:id/gap', () => {
  const del = (server: FastifyInstance, id = EPISODE) =>
    server.inject({ method: 'DELETE', url: `/episodes/${id}/gap`, headers: signedIn });

  // Clearing a comment that was never made is a success: the caller wanted
  // there to be none, and there is none.
  it('clears, and clearing again is still a success', async () => {
    const stub = start();

    expect((await del(app as FastifyInstance)).statusCode).toBe(204);
    expect((await del(app as FastifyInstance)).statusCode).toBe(204);
    expect(stub.deleted).toBe(2);
  });

  it('refuses an id that is not one', async () => {
    start();

    expect((await del(app as FastifyInstance, 'nope')).statusCode).toBe(400);
  });
});
