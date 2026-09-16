import type { ExternalIds, ExternalSource } from './ids.js';

/**
 * Parses Plex GUIDs into external ids.
 *
 * Plex emits two shapes depending on which agent scanned the library:
 *   modern  `tmdb://111110`
 *   legacy  `com.plexapp.agents.thetvdb://81189/1/1?lang=en`
 *
 * Newer libraries also carry an opaque `plex://episode/abc123`, which anchors
 * nothing outside Plex and is deliberately ignored.
 *
 * Matching is case-insensitive: Plex's observed output is lowercase, but that
 * has never been verified across every agent and the cost of being wrong is a
 * title silently recorded as unidentifiable.
 */

const MODERN = /^(imdb|tmdb|tvdb):\/\/([^/?#]+)/i;
const LEGACY = /^com\.plexapp\.agents\.(themoviedb|thetvdb|imdb):\/\/([^/?#]+)/i;

const MODERN_SOURCES: Record<string, ExternalSource> = {
  imdb: 'imdb',
  tmdb: 'tmdb',
  tvdb: 'tvdb',
};

const LEGACY_AGENTS: Record<string, ExternalSource> = {
  themoviedb: 'tmdb',
  thetvdb: 'tvdb',
  imdb: 'imdb',
};

function match(
  raw: string,
  pattern: RegExp,
  sources: Record<string, ExternalSource>,
): { source: ExternalSource; id: string } | null {
  const found = pattern.exec(raw);
  if (!found?.[1] || !found[2]) return null;
  const source = sources[found[1].toLowerCase()];
  return source ? { source, id: found[2] } : null;
}

export function parseGuid(raw: unknown): { source: ExternalSource; id: string } | null {
  if (typeof raw !== 'string') return null;
  return match(raw, MODERN, MODERN_SOURCES) ?? match(raw, LEGACY, LEGACY_AGENTS);
}

/** Shape of the Plex metadata fields this reads. Everything is optional because
 *  it arrives from an external API and any of it can be absent or malformed. */
export interface PlexGuidCarrier {
  Guid?: unknown;
  guid?: unknown;
}

/**
 * Collects every external id from a Plex metadata object.
 *
 * `Guid[]` entries are read before the top-level `guid`, and the first value
 * for a source wins: an item can carry both a current `Guid[]` entry and a
 * stale legacy `guid` naming an older id for the same title.
 */
export function parseGuids(metadata: PlexGuidCarrier | null | undefined): ExternalIds {
  const ids: ExternalIds = {};

  const record = (raw: unknown): void => {
    const parsed = parseGuid(raw);
    if (parsed) ids[parsed.source] ??= parsed.id;
  };

  const guids: unknown = metadata?.Guid;
  if (Array.isArray(guids)) {
    for (const entry of guids) {
      record((entry as { id?: unknown } | null)?.id);
    }
  }
  record(metadata?.guid);

  return ids;
}
