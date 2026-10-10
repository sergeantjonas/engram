import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchAllHistory,
  fetchSectionItems,
  fetchSections,
  fetchShowLeaves,
  pickConnection,
} from './plex-client.mjs';

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

test('asks for history oldest first', async () => {
  // Ascending order is what keeps fetched pages stable as new plays land, and
  // the paging tests above would pass just as well without it.
  const asked = [];
  const serve = stubServer({ total: 86 });
  await fetchAllHistory('http://x', 't', {
    get: (url, token, timeout) => {
      asked.push(url);
      return serve(url, token, timeout);
    },
  });
  assert.ok(asked.every((url) => new URL(url).searchParams.get('sort') === 'viewedAt:asc'));
});

// Library items are identified by ratingKey rather than historyKey, so the
// paging guard needs its own identity or every page reads as already seen.
const items = (n, offset = 0) =>
  Array.from({ length: n }, (_, i) => ({ ratingKey: String(offset + i), title: `t${offset + i}` }));

function stubLibrary({ total, clamp = 500, reportTotal = true }) {
  return async (url) => {
    const params = new URL(url).searchParams;
    const start = Number(params.get('X-Plex-Container-Start'));
    const size = Math.min(clamp, Number(params.get('X-Plex-Container-Size')));
    return {
      MediaContainer: {
        ...(reportTotal ? { totalSize: total } : {}),
        Metadata: items(Math.max(0, Math.min(size, total - start)), start),
      },
    };
  };
}

test('pages a section by ratingKey and asks for guids inline', async () => {
  const asked = [];
  const get = async (url, token, timeout) => {
    asked.push(url);
    return stubLibrary({ total: 52, clamp: 20 })(url, token, timeout);
  };
  const got = await fetchSectionItems('http://x', 't', '1', { get });
  assert.equal(got.length, 52);
  assert.ok(asked.every((url) => new URL(url).searchParams.get('includeGuids') === '1'));
});

// The import reads an item missing from a section as gone from disk, so a
// listing that cannot be proved whole is refused rather than taken at its end.
test('refuses a section listed without a total', async () => {
  await assert.rejects(
    fetchSectionItems('http://x', 't', '1', {
      get: stubLibrary({ total: 52, reportTotal: false }),
    }),
    /no totalSize/,
  );
});

test('refuses a show whose episodes are listed without a total', async () => {
  await assert.rejects(
    fetchShowLeaves('http://x', 't', '748', {
      get: stubLibrary({ total: 16, reportTotal: false }),
    }),
    /no totalSize/,
  );
});

test('pages a show with more episodes than one page holds', async () => {
  const got = await fetchShowLeaves('http://x', 't', '748', {
    get: stubLibrary({ total: 424, clamp: 100 }),
  });
  assert.equal(got.length, 424);
});

// The probe carries the token, so an http candidate must never be tried at
// all — refusing it after it answered would already be too late.
test('never tries a plaintext connection when told not to', async () => {
  const asked = [];
  const get = async (url) => {
    asked.push(url);
    return {};
  };
  const server = {
    connections: [
      { uri: 'http://203.0.113.5:6066', local: false },
      { uri: 'https://a-b-c.plex.direct:6066', local: false },
    ],
  };

  const conn = await pickConnection(server, 't', { plaintext: false, get });
  assert.equal(conn.uri, 'https://a-b-c.plex.direct:6066');
  assert.ok(asked.every((url) => url.startsWith('https:')));

  const none = await pickConnection({ connections: [{ uri: 'http://203.0.113.5:6066' }] }, 't', {
    plaintext: false,
    get,
  });
  assert.equal(none, null);
  assert.equal(asked.length, 1);
});

test('reads sections down to key, type and title', async () => {
  const get = async () => ({
    MediaContainer: {
      Directory: [
        { key: 2, type: 'movie', title: 'Movies' },
        { key: 1, type: 'show', title: 'TV Shows' },
      ],
    },
  });
  assert.deepEqual(await fetchSections('http://x', 't', { get }), [
    { key: '2', type: 'movie', title: 'Movies' },
    { key: '1', type: 'show', title: 'TV Shows' },
  ]);
});
