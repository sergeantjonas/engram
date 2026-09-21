import {
  type ExternalIds,
  parseGuids,
  type TitleKind,
  titleKey,
  type WatchPrecision,
} from '@engram/shared';

/** An episode as it appears under a show in a dump from `tools/dump-library.mjs`. */
export interface PlexLeaf {
  ratingKey?: string;
  parentIndex?: number;
  index?: number;
  title?: string;
  viewCount?: number;
  lastViewedAt?: number;
}

/** A show or film as the section listing returns it, with `includeGuids=1`. */
export interface PlexLibraryItem {
  ratingKey?: string;
  title?: string;
  year?: number;
  guid?: string;
  Guid?: unknown;
  viewCount?: number;
  viewedLeafCount?: number;
  lastViewedAt?: number;
  /** Present on a watched show only: the watched episodes under it. */
  episodes?: PlexLeaf[];
}

export interface PlexLibrarySection {
  key: string;
  type: string;
  title: string;
  items: PlexLibraryItem[];
}

export interface PlannedTitle {
  key: string;
  kind: TitleKind;
  ids: ExternalIds;
  name: string;
  year: number | null;
}

export interface PlannedEpisode {
  titleKey: string;
  season: number;
  number: number;
  name: string | null;
}

export interface PlannedEvent {
  sourceEventId: string;
  titleKey: string;
  season: number | null;
  number: number | null;
  watchedAt: Date | null;
  watchedPrecision: WatchPrecision;
  /** Plex's `viewCount`: how many plays this one row stands for. */
  plays: number;
  /** A film's own payload, or an episode's with the show it hung off. */
  raw: PlexLibraryItem | { show: { ratingKey: string | null; title: string }; episode: PlexLeaf };
}

export interface DroppedItem {
  reason: string;
  ratingKey: string | null;
  name: string;
}

/**
 * A show whose episodes do not add up to what its own row claims.
 *
 * Presence and identity still stand — those come from the section listing,
 * which was read fine — but some part of this show's viewing is missing from
 * the dump, so the events written for it are known to be short. Reported
 * loudly rather than written quietly: a walk that records four of nine
 * episodes and says nothing is the failure this whole pipeline exists to
 * avoid.
 */
export interface IncompleteShow {
  ratingKey: string | null;
  name: string;
  /** What the show row claims is watched. */
  expected: number;
  /** What its episodes actually carry. */
  found: number;
}

export interface LibraryPlan {
  titles: PlannedTitle[];
  episodes: PlannedEpisode[];
  events: PlannedEvent[];
  /** Canonical keys of every title the walk saw, watched or not. */
  presence: string[];
  /** Items that could not be placed at all. Reported rather than silently lost. */
  dropped: DroppedItem[];
  /** Shows placed, but with fewer watched episodes than they claim. */
  incomplete: IncompleteShow[];
}

const KIND_BY_SECTION: Record<string, TitleKind | undefined> = { show: 'show', movie: 'movie' };

/**
 * The check constraint ties `unknown` precision to a null date, so the two are
 * decided together or the insert fails on a row the planner thought was fine.
 */
function watchedAt(at: number | undefined): Pick<PlannedEvent, 'watchedAt' | 'watchedPrecision'> {
  // A zeroed field is Plex saying nothing, not Plex saying 1970.
  return typeof at === 'number' && at > 0
    ? { watchedAt: new Date(at * 1000), watchedPrecision: 'exact' }
    : { watchedAt: null, watchedPrecision: 'unknown' };
}

/**
 * Turns a Plex library dump into rows to write.
 *
 * Pure: no database, no clock, no filesystem. Unlike the history dump this
 * needs no resolution report — `includeGuids=1` puts the external ids on every
 * item, so identity is decided here rather than by a second pass.
 */
export function planLibrary(sections: PlexLibrarySection[]): LibraryPlan {
  const titles = new Map<string, PlannedTitle>();
  const episodes = new Map<string, PlannedEpisode>();
  // Keyed rather than pushed: one work can sit in two sections — a film in
  // Movies and Movies 4K — and both copies key to the same id. Two rows would
  // be the same claim twice, so they merge into the fullest one.
  const events = new Map<string, PlannedEvent>();
  const presence = new Set<string>();
  const dropped: DroppedItem[] = [];
  const incomplete: IncompleteShow[] = [];

  const claim = (event: PlannedEvent): void => {
    const seen = events.get(event.sourceEventId);
    if (seen === undefined) {
      events.set(event.sourceEventId, event);
      return;
    }
    events.set(event.sourceEventId, {
      ...event,
      plays: Math.max(seen.plays, event.plays),
      // The payload travels with the date it explains, or the row beside it
      // describes a different copy than the one the date came from.
      ...(seen.watchedAt !== null && (event.watchedAt === null || seen.watchedAt > event.watchedAt)
        ? { watchedAt: seen.watchedAt, watchedPrecision: seen.watchedPrecision, raw: seen.raw }
        : {}),
    });
  };

  for (const section of sections) {
    const kind = KIND_BY_SECTION[section.type];
    // Photos and music share the endpoint and have no place in this record.
    if (kind === undefined) continue;

    for (const item of section.items) {
      const name = item.title ?? '(untitled)';
      const ratingKey = item.ratingKey ?? null;

      // Identity is the canonical source alone. An unkeyable title goes
      // nowhere rather than being stored under whichever id happened to exist.
      const ids = parseGuids(item);
      const key = titleKey({ kind, ids });
      if (key === null) {
        dropped.push({ reason: `no ${kind === 'show' ? 'tvdb' : 'tmdb'} id`, ratingKey, name });
        continue;
      }

      // First copy wins, as in the history importer: a second section's
      // metadata is not better, only later.
      if (!titles.has(key)) titles.set(key, { key, kind, ids, name, year: item.year ?? null });
      presence.add(key);

      if (kind === 'movie') {
        const plays = item.viewCount ?? 0;
        if (plays < 1) continue;
        claim({
          sourceEventId: `plex-library:${key}`,
          titleKey: key,
          season: null,
          number: null,
          ...watchedAt(item.lastViewedAt),
          plays,
          raw: item,
        });
        continue;
      }

      // The show row's own count against what its episodes carry. They agree
      // for every item on this server, which is what makes a disagreement
      // worth reporting: it means the leaves call was skipped, truncated or
      // failed, and the events below are short by the difference. Presence and
      // identity stand either way — those came from the section listing, which
      // read fine, and presence is never inferred from a watch.
      const leaves = item.episodes ?? [];
      const expected = item.viewedLeafCount ?? 0;
      let found = 0;

      for (const leaf of leaves) {
        const plays = leaf.viewCount ?? 0;
        if (plays < 1) continue;

        const season = leaf.parentIndex;
        const number = leaf.index;
        if (season === undefined || number === undefined) {
          dropped.push({
            reason: 'episode has no season or number',
            ratingKey: leaf.ratingKey ?? null,
            name: `${name} — ${leaf.title ?? '(untitled)'}`,
          });
          continue;
        }

        // Season 0 is kept. A whole-title mark excludes specials because it
        // infers them; this observed one being watched.
        episodes.set(`${key}/${season}/${number}`, {
          titleKey: key,
          season,
          number,
          name: leaf.title ?? null,
        });
        claim({
          sourceEventId: `plex-library:${key}:S${season}E${number}`,
          titleKey: key,
          season,
          number,
          ...watchedAt(leaf.lastViewedAt),
          plays,
          // The show travels with the leaf. An episode payload names no show,
          // so stored alone it could not be re-keyed if this parser turned out
          // to have mis-identified the series it hung off.
          raw: { show: { ratingKey, title: name }, episode: leaf },
        });
        found++;
      }

      // Counted from the episodes that produced an event rather than from the
      // ones that looked watched, so a leaf dropped just above still reads as
      // the shortfall it is.
      if (found < expected) incomplete.push({ ratingKey, name, expected, found });
    }
  }

  return {
    titles: [...titles.values()],
    episodes: [...episodes.values()],
    events: [...events.values()],
    presence: [...presence],
    dropped,
    incomplete,
  };
}
