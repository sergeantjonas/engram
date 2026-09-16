import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fetchAllHistory } from './plex-client.mjs';

const rows = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ historyKey: `/h/${offset + i}`, viewedAt: offset + i }));

// Serves `total` rows, but never more than `clamp` per page, and optionally
// ignores the requested offset the way a misbehaving server would.
function stubServer({ total, clamp = 500, ignoreOffset = false, reportTotal = true }) {
  return async (url) => {
    const start = ignoreOffset
      ? 0
      : Number(new URL(url).searchParams.get('X-Plex-Container-Start'));
    const size = Math.min(clamp, Number(new URL(url).searchParams.get('X-Plex-Container-Size')));
    const page = rows(Math.max(0, Math.min(size, total - start)), start);
    return { MediaContainer: { ...(reportTotal ? { totalSize: total } : {}), Metadata: page } };
  };
}

test('captures every row when the server clamps the page size', async () => {
  const got = await fetchAllHistory('http://x', 't', {
    get: stubServer({ total: 1200, clamp: 100 }),
  });
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
