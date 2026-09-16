import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGuids, fetchAllHistory } from './plex-client.mjs';

const rows = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ historyKey: `/h/${offset + i}`, viewedAt: offset + i }));

// Serves `total` rows, but never more than `clamp` per page, and optionally
// ignores the requested offset the way a misbehaving server would.
function stubServer({ total, clamp = 500, ignoreOffset = false, reportTotal = true }) {
  return async (url) => {
    const start = ignoreOffset ? 0 : Number(new URL(url).searchParams.get('X-Plex-Container-Start'));
    const size = Math.min(clamp, Number(new URL(url).searchParams.get('X-Plex-Container-Size')));
    const page = rows(Math.max(0, Math.min(size, total - start)), start);
    return { MediaContainer: { ...(reportTotal ? { totalSize: total } : {}), Metadata: page } };
  };
}

test('captures every row when the server clamps the page size', async () => {
  const got = await fetchAllHistory('http://x', 't', { get: stubServer({ total: 1200, clamp: 100 }) });
  assert.equal(got.length, 1200);
});

test('throws rather than writing a partial archive when rows are missing', async () => {
  const get = async () => ({ MediaContainer: { totalSize: 900, Metadata: rows(100) } });
  await assert.rejects(
    fetchAllHistory('http://x', 't', { get, maxPages: 5 }),
    /pagination is not advancing/,
  );
});

test('does not loop forever when the server ignores the offset', async () => {
  const get = stubServer({ total: 5000, clamp: 500, ignoreOffset: true });
  await assert.rejects(fetchAllHistory('http://x', 't', { get }), /not advancing/);
});

test('stops on an empty page when the server reports no total', async () => {
  const got = await fetchAllHistory('http://x', 't', {
    get: stubServer({ total: 750, reportTotal: false }),
  });
  assert.equal(got.length, 750);
});

test('handles a history shorter than one page', async () => {
  const got = await fetchAllHistory('http://x', 't', { get: stubServer({ total: 86 }) });
  assert.equal(got.length, 86);
});

test('parses modern guids', () => {
  assert.deepEqual(
    parseGuids({ Guid: [{ id: 'imdb://tt11737520' }, { id: 'tmdb://111110' }, { id: 'tvdb://392276' }] }),
    { imdb: 'tt11737520', tmdb: '111110', tvdb: '392276' },
  );
});

test('parses legacy agent guids', () => {
  assert.deepEqual(
    parseGuids({ guid: 'com.plexapp.agents.thetvdb://81189/1/1?lang=en' }),
    { tvdb: '81189' },
  );
});

test('prefers the Guid[] entry over a stale legacy top-level guid', () => {
  assert.deepEqual(
    parseGuids({ Guid: [{ id: 'tvdb://392276' }], guid: 'com.plexapp.agents.thetvdb://81189/1/1' }),
    { tvdb: '392276' },
  );
});

test('returns empty for unknown agents rather than garbage', () => {
  assert.deepEqual(parseGuids({ guid: 'com.plexapp.agents.none://12345' }), {});
  assert.deepEqual(parseGuids({ guid: 'plex://episode/abc123' }), {});
});

test('survives malformed metadata', () => {
  // A present item misread as an error is recorded as permanently lost.
  assert.deepEqual(parseGuids(undefined), {});
  assert.deepEqual(parseGuids({ Guid: { id: 'tmdb://1' } }), {});
  assert.deepEqual(parseGuids({ Guid: [null, { id: 42 }] }), {});
});
