import type { TitleKind } from '@engram/shared';

const BASE_URL = 'https://api.themoviedb.org/3';
const TIMEOUT_MS = 8000;

/** TMDB's `media_type`, narrowed to the two kinds Engram stores. */
const TITLE_KINDS: Record<string, TitleKind> = { tv: 'show', movie: 'movie' };

/** A search hit, reduced to what the add screen shows and what creating a title needs. */
export interface TmdbCandidate {
  kind: TitleKind;
  tmdbId: string;
  name: string;
  year: number | null;
  /**
   * The path as TMDB gives it, e.g. `/AoGsDM02UVt0npBA8OvpDcZbaMi.jpg`, matching
   * `title.poster_path`. The image CDN needs no key, so whoever renders it builds
   * the URL and picks a size; keeping a full one here would freeze that choice.
   */
  posterPath: string | null;
  overview: string | null;
}

/**
 * A failure that came from TMDB rather than from Engram.
 *
 * Carries the upstream status and nothing else on purpose: the API key travels
 * as a query parameter, so a message or `cause` holding the request URL would
 * put a credential into the log the first time a route reported a failure.
 */
export class TmdbError extends Error {
  readonly upstreamStatus: number | null;

  constructor(message: string, upstreamStatus: number | null = null) {
    super(message);
    this.name = 'TmdbError';
    this.upstreamStatus = upstreamStatus;
  }
}

export interface TmdbClientOptions {
  apiKey: string;
  /** Injected so the client is testable without a network or a key. */
  fetch?: typeof globalThis.fetch;
  baseUrl?: string;
  timeoutMs?: number;
}

export interface TmdbClient {
  search(query: string): Promise<TmdbCandidate[]>;
}

/** A row of `/search/multi`, typed as loosely as the endpoint actually behaves. */
interface MultiSearchRow {
  media_type?: string;
  id?: number;
  name?: string;
  title?: string;
  first_air_date?: string;
  release_date?: string;
  poster_path?: string | null;
  overview?: string;
}

const yearOf = (date: string | undefined): number | null => {
  const year = Number.parseInt(date?.slice(0, 4) ?? '', 10);
  return Number.isNaN(year) ? null : year;
};

const candidateOf = (row: MultiSearchRow): TmdbCandidate | null => {
  const kind = TITLE_KINDS[row.media_type ?? ''];
  const name = row.name ?? row.title;
  // `/search/multi` also returns people, which have neither a kind we store nor
  // a title to store them under.
  if (!kind || !name || typeof row.id !== 'number') return null;

  return {
    kind,
    tmdbId: String(row.id),
    name,
    year: yearOf(kind === 'show' ? row.first_air_date : row.release_date),
    posterPath: row.poster_path ?? null,
    overview: row.overview || null,
  };
};

export function createTmdbClient(options: TmdbClientOptions): TmdbClient {
  const { apiKey, fetch = globalThis.fetch, baseUrl = BASE_URL, timeoutMs = TIMEOUT_MS } = options;

  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(`${baseUrl}${path}`);
    // v3 keys authenticate by query parameter; the same key sent as a bearer
    // token is rejected with 401.
    url.searchParams.set('api_key', apiKey);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      throw new TmdbError('TMDB is unreachable');
    }

    if (!response.ok) throw new TmdbError(`TMDB responded ${response.status}`, response.status);

    try {
      return await response.json();
    } catch {
      // A gateway answering 200 with an HTML page parses as a SyntaxError, and
      // that is not a TmdbError: it would escape the route's handler and come
      // back as a 500 quoting the upstream body.
      throw new TmdbError('TMDB sent an unreadable body', response.status);
    }
  }

  return {
    async search(query) {
      const body = (await get('/search/multi', { query })) as { results?: MultiSearchRow[] } | null;
      const rows = body?.results ?? [];
      // Upstream order is popularity, which is the ranking the add screen wants.
      return rows.map(candidateOf).filter((c): c is TmdbCandidate => c !== null);
    },
  };
}
