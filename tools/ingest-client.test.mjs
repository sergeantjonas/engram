import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ingestTarget, postWalk } from './ingest-client.mjs';

const env = {
  ENGRAM_INGEST_URL: 'https://api.engram.test/ingest/plex-library',
  INGEST_SECRET: 's'.repeat(32),
  PLEX_SERVER_ID: 'a'.repeat(40),
};

test('writes a file, not a post, when nothing asks for one', () => {
  assert.equal(ingestTarget({}), null);
});

test('reads a complete target', () => {
  assert.deepEqual(ingestTarget(env), {
    ok: true,
    url: env.ENGRAM_INGEST_URL,
    secret: env.INGEST_SECRET,
    server: env.PLEX_SERVER_ID,
  });
});

// The secret travels in a header.
test('refuses to post over plain http anywhere but localhost', () => {
  const plain = ingestTarget({ ...env, ENGRAM_INGEST_URL: 'http://api.engram.test/ingest' });
  assert.equal(plain.ok, false);
  assert.match(plain.reason, /https/);

  const local = ingestTarget({ ...env, ENGRAM_INGEST_URL: 'http://localhost:2012/ingest' });
  assert.equal(local.ok, true);
});

test('refuses to post without a secret or a server', () => {
  assert.match(ingestTarget({ ...env, INGEST_SECRET: '' }).reason, /INGEST_SECRET/);
  assert.match(ingestTarget({ ...env, PLEX_SERVER_ID: '' }).reason, /PLEX_SERVER_ID/);
});

test('posts the walk as json with the secret as a bearer', async () => {
  let sent;
  const send = async (url, init) => {
    sent = { url, init };
    return new Response(JSON.stringify({ present: 81, gone: 0 }), { status: 200 });
  };

  const stored = await postWalk(ingestTarget(env), { sections: [] }, { send });
  assert.deepEqual(stored, { present: 81, gone: 0 });
  assert.equal(sent.url, env.ENGRAM_INGEST_URL);
  assert.equal(sent.init.method, 'POST');
  assert.equal(sent.init.headers['content-type'], 'application/json');
  assert.equal(sent.init.headers.authorization, `Bearer ${env.INGEST_SECRET}`);
  assert.deepEqual(JSON.parse(sent.init.body), { sections: [] });
});

// The API's own message says why; the secret is in neither side of it.
test('throws with the status and the reason the api gave', async () => {
  const send = async () =>
    new Response(
      JSON.stringify({ error: 'wrong_server', message: 'this walk is of a different Plex server' }),
      { status: 422 },
    );

  await assert.rejects(
    postWalk(ingestTarget(env), { sections: [] }, { send }),
    (err) =>
      /^422 from api\.engram\.test: this walk is of a different Plex server$/.test(err.message) &&
      !err.message.includes(env.INGEST_SECRET),
  );
});

// A proxy's own page can answer 200. Taken as success, the timer would
// report a good night over a walk that never reached the database.
test('refuses a success that carries no counts', async () => {
  const send = async () => new Response('<html>maintenance</html>', { status: 200 });
  await assert.rejects(
    postWalk(ingestTarget(env), { sections: [] }, { send }),
    /no counts in the answer/,
  );
});

test('says why the api could not be reached, not only that it could not', async () => {
  const send = async () => {
    throw new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } });
  };
  await assert.rejects(
    postWalk(ingestTarget(env), { sections: [] }, { send }),
    /^Error: could not reach api\.engram\.test: ECONNREFUSED$/,
  );
});
