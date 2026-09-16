// Shared Plex access for the one-shot tools. plex.tv knows how to reach the
// server from anywhere, so none of this needs LAN access or port forwarding.

const CLIENT_ID = 'engram-tools';

export const plexHeaders = (token) => ({
  'Accept': 'application/json',
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

// Plex exposes external ids as Guid children, in modern (tmdb://1396) and
// legacy agent (com.plexapp.agents.thetvdb://81189/1/1?lang=en) shapes. The
// Guid[] entries are read first and win, because a legacy top-level guid on the
// same item can name an older id for the same title.
export function parseGuids(metadata) {
  const out = {};
  const record = (raw) => {
    if (typeof raw !== 'string') return;
    const modern = raw.match(/^(imdb|tmdb|tvdb):\/\/([^/?]+)/);
    if (modern) {
      out[modern[1]] ??= modern[2];
      return;
    }
    const legacy = raw.match(/^com\.plexapp\.agents\.(themoviedb|thetvdb|imdb):\/\/([^/?]+)/);
    if (legacy) {
      const key = { themoviedb: 'tmdb', thetvdb: 'tvdb', imdb: 'imdb' }[legacy[1]];
      out[key] ??= legacy[2];
    }
  };

  const guids = Array.isArray(metadata?.Guid) ? metadata.Guid : [];
  for (const g of guids) record(g?.id);
  record(metadata?.guid);
  return out;
}

const rowId = (r) => r.historyKey ?? `${r.ratingKey}:${r.viewedAt}`;

// An incomplete archive that reports success is the worst outcome this tool can
// produce, so every exit is either "the server said that was everything" or a
// thrown error. Ascending order keeps fetched pages stable as new plays land.
//
// `get` is injectable so the pagination edge cases can be tested without a server.
export async function fetchAllHistory(uri, token, options = {}) {
  const { get = getJson, pageSize = 500, maxPages = 1000, onProgress } = options;
  const rows = [];
  const seen = new Set();
  let start = 0;
  let total = null;

  for (let pages = 0; ; pages++) {
    if (pages >= maxPages) {
      throw new Error(`pagination exceeded ${maxPages} pages — aborting rather than writing a partial archive`);
    }

    const url =
      `${uri}/status/sessions/history/all` +
      `?sort=viewedAt:asc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`;
    const body = await get(url, token, 30000);
    const container = body.MediaContainer ?? {};
    const page = container.Metadata ?? [];

    if (total === null) {
      total = typeof container.totalSize === 'number' ? container.totalSize : null;
      onProgress?.({ phase: 'total', total });
    }

    if (page.length === 0) break;

    // A server that ignores X-Plex-Container-Start would otherwise loop forever.
    const fresh = page.filter((r) => !seen.has(rowId(r)));
    if (fresh.length === 0) {
      throw new Error('server returned only rows already seen — pagination is not advancing');
    }
    for (const r of fresh) {
      seen.add(rowId(r));
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
