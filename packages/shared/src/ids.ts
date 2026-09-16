/**
 * Canonical identity for a watchable work.
 *
 * Plex ratingKeys are ephemeral — delete a series and re-add it and every key
 * changes — so nothing Plex-internal is ever used as identity. External ids
 * survive a delete-and-redownload cycle, which is the whole premise here.
 */

export type ExternalSource = 'tmdb' | 'tvdb' | 'imdb';

export type ExternalIds = Partial<Record<ExternalSource, string>>;

export type TitleKind = 'show' | 'movie';

export interface TitleRef {
  kind: TitleKind;
  ids: ExternalIds;
}

export interface EpisodeRef {
  title: TitleRef;
  season: number;
  episode: number;
}

const ALL_SOURCES = ['tmdb', 'tvdb', 'imdb'] as const;

/**
 * The single source that defines identity, per kind.
 *
 * Exactly one source can define a key. A fallback chain would mean the same
 * work keys differently depending on which ids happened to be known when it was
 * first seen — a show recorded from Plex before its tvdb id was resolved would
 * never reunite with the same show arriving from a Sonarr webhook.
 *
 * tvdb for shows and tmdb for movies because those are what Sonarr and Radarr
 * key on natively, so their payloads need no translation.
 */
const CANONICAL_SOURCE: Record<TitleKind, ExternalSource> = {
  show: 'tvdb',
  movie: 'tmdb',
};

export function canonicalSource(kind: TitleKind): ExternalSource {
  return CANONICAL_SOURCE[kind];
}

/**
 * Ordered ids usable to look a title up against an external API.
 *
 * Distinct from keying on purpose: resolution may fall back, identity may not.
 */
const RESOLUTION_ORDER: Record<TitleKind, readonly ExternalSource[]> = {
  show: ['tvdb', 'tmdb', 'imdb'],
  movie: ['tmdb', 'imdb', 'tvdb'],
};

export function resolutionCandidates(ref: TitleRef): ExternalSource[] {
  return RESOLUTION_ORDER[ref.kind].filter((source) => Boolean(ref.ids[source]));
}

/**
 * Stable string key for a title, e.g. `show:tvdb:392276`.
 *
 * The kind is part of the key because tmdb numbers movies and series in
 * separate namespaces: tmdb 603 is a film and also a series.
 *
 * Returns null when the canonical id is unknown. A title that cannot be keyed
 * cannot be tracked across a redownload, so callers must route it to
 * resolution rather than storing it under some other id.
 */
export function titleKey(ref: TitleRef): string | null {
  const source = CANONICAL_SOURCE[ref.kind];
  const id = ref.ids[source];
  if (!id) return null;
  return `${ref.kind}:${source}:${id}`;
}

// Long-running anime pass four digits: ONE PIECE is in the owner's own history.
const EPISODE_DIGITS = 4;
const SEASON_DIGITS = 2;

/**
 * Stable string key for an episode, e.g. `show:tvdb:392276/s01e0004`.
 *
 * Padded so keys sort lexicographically in episode order.
 */
export function episodeKey(ref: EpisodeRef): string | null {
  const base = titleKey(ref.title);
  if (!base) return null;
  const season = String(ref.season).padStart(SEASON_DIGITS, '0');
  const episode = String(ref.episode).padStart(EPISODE_DIGITS, '0');
  return `${base}/s${season}e${episode}`;
}

/**
 * True when two references describe the same work.
 *
 * A conflict on any shared source beats agreement on another: two titles that
 * disagree on tvdb are different works even if a stale tmdb id matches, and
 * merging them would corrupt history irreversibly.
 *
 * Not transitive — `{tmdb:1}` matches `{tmdb:1,tvdb:5}` matches `{tvdb:5}`,
 * while the outer pair share nothing. Any grouping pass over this would be
 * order-dependent, so resolve through stored canonical ids instead.
 */
export function sameTitle(a: TitleRef, b: TitleRef): boolean {
  if (a.kind !== b.kind) return false;

  let agreed = false;
  for (const source of ALL_SOURCES) {
    const left = a.ids[source];
    const right = b.ids[source];
    if (!left || !right) continue;
    if (left !== right) return false;
    agreed = true;
  }
  return agreed;
}

/**
 * Merge known ids, keeping the existing value wherever both sides disagree.
 *
 * A conflicting incoming id is dropped silently, and a genuine re-identification
 * is indistinguishable here from a bad rescan. Callers that care must compare
 * before merging.
 */
export function mergeIds(existing: ExternalIds, incoming: ExternalIds): ExternalIds {
  const merged: ExternalIds = { ...existing };
  for (const source of ALL_SOURCES) {
    const value = merged[source] ?? incoming[source];
    if (value !== undefined) merged[source] = value;
  }
  return merged;
}
