import type { ExternalIds, TitleKind } from '@engram/shared';

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

/** A season as the details call summarises it, before its episodes are fetched. */
export interface TmdbSeason {
  season: number;
  episodeCount: number;
}

/** Everything storing a title needs, from one call. */
export interface TmdbTitleDetails {
  kind: TitleKind;
  ids: ExternalIds;
  name: string;
  year: number | null;
  posterPath: string | null;
  /** The wide still a title page opens with. Absent far more often than a poster. */
  backdropPath: string | null;
  overview: string | null;
  /** As TMDB words it: `Returning Series`, `Ended`, `Canceled`, `Released`. */
  status: string | null;
  /** The most recent aired episode's date. Null for a movie. */
  lastAirDate: string | null;
  /** What TMDB expects next, or null when nothing is scheduled. */
  nextEpisode: TmdbNextEpisode | null;
  /** A movie's running time in minutes. Null for a show, which has it per episode. */
  runtimeMin: number | null;
  /** Empty for a movie. Includes season 0, which is where specials live. */
  seasons: TmdbSeason[];
}

export interface TmdbNextEpisode {
  season: number;
  number: number;
  /** Announced episodes are sometimes listed before they are dated. */
  airDate: string | null;
}

export interface TmdbEpisode {
  season: number;
  number: number;
  name: string | null;
  /** `YYYY-MM-DD`, matching the `date` column it is stored in. */
  airDate: string | null;
  runtimeMin: number | null;
  tmdbEpisodeId: string | null;
  overview: string | null;
  /** A 16:9 frame from the episode, as a path like `posterPath`. */
  stillPath: string | null;
}

export interface TmdbClient {
  search(query: string): Promise<TmdbCandidate[]>;
  details(kind: TitleKind, tmdbId: string): Promise<TmdbTitleDetails>;
  seasonEpisodes(tmdbId: string, season: number): Promise<TmdbEpisode[]>;
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

/** A details response, typed as loosely as the endpoint actually behaves. */
interface DetailsBody {
  name?: string;
  title?: string;
  first_air_date?: string;
  release_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  imdb_id?: string | null;
  status?: string | null;
  last_air_date?: string | null;
  /** A movie's field; a show carries `episode_run_time`, a list that is usually empty. */
  runtime?: number | null;
  next_episode_to_air?: {
    season_number?: number;
    episode_number?: number;
    air_date?: string | null;
  } | null;
  external_ids?: { tvdb_id?: number | null; imdb_id?: string | null };
  seasons?: { season_number?: number; episode_count?: number }[];
}

interface SeasonBody {
  episodes?: {
    season_number?: number;
    episode_number?: number;
    name?: string;
    air_date?: string;
    runtime?: number | null;
    id?: number;
    overview?: string;
    still_path?: string | null;
  }[];
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

/** Only an episode TMDB has numbered can be pointed at; a date alone cannot. */
function nextEpisodeOf(row: DetailsBody['next_episode_to_air']): TmdbNextEpisode | null {
  if (!row || typeof row.season_number !== 'number' || typeof row.episode_number !== 'number') {
    return null;
  }
  return { season: row.season_number, number: row.episode_number, airDate: row.air_date || null };
}

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

    async details(kind, tmdbId) {
      const path = kind === 'show' ? `/tv/${tmdbId}` : `/movie/${tmdbId}`;
      // One call rather than two: the tvdb id a show is keyed on lives behind
      // /external_ids, and appending it costs nothing extra.
      const body = (await get(path, { append_to_response: 'external_ids' })) as DetailsBody | null;
      const name = body?.name ?? body?.title;
      if (!body || !name) throw new TmdbError('TMDB returned a title with no name');

      const ids: ExternalIds = { tmdb: tmdbId };
      // A show with no tvdb id reports it as 0 or null rather than omitting it,
      // and either way it cannot be the canonical id.
      if (body.external_ids?.tvdb_id) ids.tvdb = String(body.external_ids.tvdb_id);
      const imdb = body.external_ids?.imdb_id ?? body.imdb_id;
      if (imdb) ids.imdb = imdb;

      return {
        kind,
        ids,
        name,
        year: yearOf(kind === 'show' ? body.first_air_date : body.release_date),
        posterPath: body.poster_path ?? null,
        backdropPath: body.backdrop_path ?? null,
        overview: body.overview || null,
        status: body.status || null,
        lastAirDate: body.last_air_date || null,
        nextEpisode: nextEpisodeOf(body.next_episode_to_air),
        // TMDB writes 0 for a runtime it does not know.
        runtimeMin:
          kind === 'movie' && typeof body.runtime === 'number' && body.runtime > 0
            ? body.runtime
            : null,
        seasons: (body.seasons ?? [])
          .filter((s) => typeof s.season_number === 'number' && (s.episode_count ?? 0) > 0)
          .map((s) => ({ season: s.season_number as number, episodeCount: s.episode_count ?? 0 })),
      };
    },

    async seasonEpisodes(tmdbId, season) {
      const body = (await get(`/tv/${tmdbId}/season/${season}`, {})) as SeasonBody | null;
      const episodes: TmdbEpisode[] = [];

      for (const row of body?.episodes ?? []) {
        if (typeof row.episode_number !== 'number') continue;
        episodes.push({
          // The response repeats the season on every episode; trusting it over
          // the argument keeps a redirected or merged season honest.
          season: typeof row.season_number === 'number' ? row.season_number : season,
          number: row.episode_number,
          name: row.name || null,
          airDate: row.air_date || null,
          runtimeMin: typeof row.runtime === 'number' ? row.runtime : null,
          tmdbEpisodeId: typeof row.id === 'number' ? String(row.id) : null,
          overview: row.overview || null,
          stillPath: row.still_path ?? null,
        });
      }

      return episodes;
    },
  };
}
