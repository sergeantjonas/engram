// Posting a library walk to Engram, which is how the nightly walk on the
// Bytesized slot reaches a database it cannot touch directly.

/**
 * Where a walk is posted, read from the environment. Null when nothing asks
 * for a post, so the walk writes its file to tools/out/.
 */
export function ingestTarget(env) {
  const raw = env.ENGRAM_INGEST_URL;
  if (!raw) return null;

  const url = URL.parse(raw);
  if (!url) return { ok: false, reason: 'ENGRAM_INGEST_URL is not a URL' };
  // The secret travels in a header, so plain HTTP would carry it across the
  // internet readable. Loopback is the one place that costs nothing.
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    return { ok: false, reason: 'ENGRAM_INGEST_URL must be https, or http to localhost' };
  }
  if (!env.INGEST_SECRET) return { ok: false, reason: 'INGEST_SECRET is not set' };
  // A post names one server and sweeps what that server lacks, so it is
  // never left to whichever servers the token happens to reach.
  if (!env.PLEX_SERVER_ID) {
    return { ok: false, reason: 'PLEX_SERVER_ID is not set — a posted walk is of one server' };
  }
  return { ok: true, url: url.href, secret: env.INGEST_SECRET, server: env.PLEX_SERVER_ID };
}

/**
 * Posts one walk and answers what Engram wrote. Throws on anything but a
 * 2xx, with the status and the API's own message — which never carries the
 * secret — so the log on the slot says why without a second request.
 */
export async function postWalk(target, dump, { send = fetch, timeoutMs = 120000 } = {}) {
  const host = new URL(target.url).host;
  let res;
  try {
    res = await send(target.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${target.secret}` },
      body: JSON.stringify(dump),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // `fetch failed` alone is all the message says; the code behind it —
    // refused, unresolved, a certificate — is on the cause.
    throw new Error(`could not reach ${host}: ${err.cause?.code ?? err.message}`);
  }

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const why = typeof body?.message === 'string' ? body.message : (body?.error ?? res.statusText);
    throw new Error(`${res.status} from ${host}: ${why}`);
  }
  // The route always answers with what it wrote. A success without the counts
  // came from something else — a proxy page, a captive portal — and cannot be
  // taken as the walk having landed.
  if (typeof body?.present !== 'number') {
    throw new Error(`${res.status} from ${host}: no counts in the answer`);
  }
  return body;
}
