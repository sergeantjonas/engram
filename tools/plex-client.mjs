export { parseGuid, parseGuids } from '@engram/shared';

// Shared Plex access for the one-shot tools. plex.tv knows how to reach the
// server from anywhere, so none of this needs LAN access or port forwarding.

const CLIENT_ID = 'engram-tools';

export const plexHeaders = (token) => ({
  Accept: 'application/json',
  'X-Plex-Token': token,
  'X-Plex-Client-Identifier': CLIENT_ID,
  'X-Plex-Product': 'engram',
  'X-Plex-Version': '0.1',
});

export async function getJson(url, token, timeoutMs = 10000) {
  const res = await fetch(url, {
    headers: plexHeaders(token),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const err = new Error(`${res.status} ${res.statusText} for ${url}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function discoverServers(token) {
  const resources = await getJson(
    'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1',
    token,
    20000,
  );
  return resources.filter((r) => (r.provides ?? '').split(',').includes('server'));
}

// Plaintext would put the account-wide token on the wire, so it sorts last of
// all. Relay works but is bandwidth-throttled, so it loses to a direct route.
function connectionScore(conn) {
  const insecure = String(conn.uri ?? '').startsWith('https:') ? 0 : 8;
  return insecure + (conn.relay ? 2 : 0) + (conn.local ? 1 : 0);
}

export async function pickConnection(server, accountToken) {
  const token = server.accessToken ?? accountToken;
  const ranked = [...(server.connections ?? [])].sort(
    (a, b) => connectionScore(a) - connectionScore(b),
  );
  for (const conn of ranked) {
    try {
      await getJson(`${conn.uri}/identity`, token, 6000);
      return { uri: conn.uri, token, relay: !!conn.relay, local: !!conn.local };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

const rowId = (r) => r.historyKey ?? `${r.ratingKey}:${r.viewedAt}`;
const itemId = (r) => r.ratingKey ?? r.key;

// An incomplete archive that reports success is the worst outcome these tools
// can produce, so every exit is either "the server said that was everything" or
// a thrown error.
//
// `get` is injectable so the pagination edge cases can be tested without a server.
async function fetchAllPages(buildUrl, token, options = {}) {
  const { get = getJson, pageSize = 500, maxPages = 1000, onProgress, idOf = itemId } = options;
  const rows = [];
  const seen = new Set();
  let start = 0;
  let total = null;

  for (let pages = 0; ; pages++) {
    if (pages >= maxPages) {
      throw new Error(
        `pagination exceeded ${maxPages} pages — aborting rather than writing a partial archive`,
      );
    }

    const url = buildUrl(start, pageSize);
    const body = await get(url, token, 30000);
    const container = body.MediaContainer ?? {};
    const page = container.Metadata ?? [];

    if (total === null) {
      total = typeof container.totalSize === 'number' ? container.totalSize : null;
      onProgress?.({ phase: 'total', total });
    }

    if (page.length === 0) break;

    // A server that ignores X-Plex-Container-Start would otherwise loop forever.
    const fresh = page.filter((r) => !seen.has(idOf(r)));
    if (fresh.length === 0) {
      throw new Error('server returned only rows already seen — pagination is not advancing');
    }
    for (const r of fresh) {
      seen.add(idOf(r));
      rows.push(r);
    }

    // Advance by what actually came back: servers may clamp the page size, and
    // assuming pageSize here would skip everything past the clamp.
    start += page.length;
    onProgress?.({ phase: 'page', fetched: rows.length, total });

    if (total !== null && rows.length >= total) break;
  }

  if (total !== null && rows.length < total) {
    throw new Error(`incomplete archive: captured ${rows.length} of ${total} rows`);
  }
  return rows;
}

// Ascending order keeps fetched pages stable as new plays land.
export async function fetchAllHistory(uri, token, options = {}) {
  return fetchAllPages(
    (start, size) =>
      `${uri}/status/sessions/history/all` +
      `?sort=viewedAt:asc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`,
    token,
    { ...options, idOf: rowId },
  );
}

export async function fetchSections(uri, token, options = {}) {
  const { get = getJson } = options;
  const body = await get(`${uri}/library/sections`, token, 20000);
  return (body.MediaContainer?.Directory ?? []).map((d) => ({
    key: String(d.key),
    type: d.type,
    title: d.title,
  }));
}

// `includeGuids=1` is what makes a walk cheap: every item arrives carrying its
// imdb / tmdb / tvdb ids, so there is no second call per title the way history
// rows need. Sorted by id rather than by title so paging cannot reshuffle
// under a rename.
export async function fetchSectionItems(uri, token, sectionKey, options = {}) {
  return fetchAllPages(
    (start, size) =>
      `${uri}/library/sections/${sectionKey}/all` +
      `?includeGuids=1&sort=id:asc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`,
    token,
    options,
  );
}

// Every episode of one show, across all its seasons. Watched state lives here
// rather than on the show: 11 of this server's 22 watched shows report a null
// `lastViewedAt` at show level while every watched episode under them carries
// one, so a walk that reads the show row records those as undated.
export async function fetchShowLeaves(uri, token, ratingKey, options = {}) {
  return fetchAllPages(
    (start, size) =>
      `${uri}/library/metadata/${ratingKey}/allLeaves` +
      `?sort=id:asc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`,
    token,
    options,
  );
}
