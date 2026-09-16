import { type ExternalIds, type TitleKind, titleKey, type WatchPrecision } from '@engram/shared';

/** A row as it appears in a dump written by `tools/dump-plex-history.mjs`. */
export interface PlexHistoryRow {
  historyKey?: string;
  key?: string;
  grandparentKey?: string;
  grandparentTitle?: string;
  parentIndex?: number;
  index?: number;
  title?: string;
  type?: string;
  viewedAt?: number;
  accountID?: number;
}

/** An entry from a report written by `tools/resolve-ids.mjs`. */
export interface ResolvedTitle {
  key: string;
  name: string;
  year?: number;
  ids: ExternalIds;
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
  watchedAt: Date;
  watchedPrecision: WatchPrecision;
  accountId: string | null;
  raw: PlexHistoryRow;
}

export interface DroppedRow {
  reason: string;
  historyKey: string | null;
  name: string;
}

export interface ImportPlan {
  titles: PlannedTitle[];
  episodes: PlannedEpisode[];
  events: PlannedEvent[];
  /** Rows that could not be placed at all. Reported rather than silently lost. */
  dropped: DroppedRow[];
  /**
   * Events recorded against the show but not a specific episode, because the
   * row carried no season or episode number. Kept rather than dropped — the
   * fact that something was watched is worth more than the precision lost —
   * but they surface as title-level rows in `watch_state`, so readers must not
   * sum them alongside per-episode rows.
   */
  degraded: number;
}

const rowName = (row: PlexHistoryRow): string => row.grandparentTitle ?? row.title ?? '(untitled)';

/**
 * Turns a Plex history dump plus its resolution report into rows to write.
 *
 * Pure: no database, no clock, no filesystem. The database writer resolves
 * these canonical keys to ids, so the mapping can be tested on real dumps
 * without any infrastructure.
 */
export function planImport(rows: PlexHistoryRow[], resolved: ResolvedTitle[]): ImportPlan {
  const byPlexKey = new Map(resolved.map((entry) => [entry.key, entry]));

  const titles = new Map<string, PlannedTitle>();
  const episodes = new Map<string, PlannedEpisode>();
  const events: PlannedEvent[] = [];
  const dropped: DroppedRow[] = [];
  let degraded = 0;

  for (const row of rows) {
    const name = rowName(row);
    const historyKey = row.historyKey ?? null;

    // Without a stable source id the row cannot be deduplicated, so re-running
    // the import would duplicate it.
    if (!historyKey) {
      dropped.push({ reason: 'no historyKey', historyKey, name });
      continue;
    }

    if (typeof row.viewedAt !== 'number') {
      dropped.push({ reason: 'no viewedAt', historyKey, name });
      continue;
    }

    const isMovie = row.type === 'movie';
    // Only a movie may fall back to its own key: for an episode, row.key points
    // at the episode's metadata, whose guids identify the episode rather than
    // the show, and would mint a phantom title that looks like a clean import.
    const plexKey = row.grandparentKey ?? (isMovie ? row.key : undefined);
    if (!plexKey) {
      dropped.push({ reason: 'episode has no grandparentKey', historyKey, name });
      continue;
    }

    const entry = byPlexKey.get(plexKey);
    if (!entry) {
      dropped.push({ reason: 'title not in resolution report', historyKey, name });
      continue;
    }

    const kind: TitleKind = isMovie ? 'movie' : 'show';
    const key = titleKey({ kind, ids: entry.ids });
    if (!key) {
      dropped.push({ reason: `no ${kind === 'show' ? 'tvdb' : 'tmdb'} id`, historyKey, name });
      continue;
    }

    if (!titles.has(key)) {
      titles.set(key, {
        key,
        kind,
        ids: entry.ids,
        name: entry.name ?? name,
        year: entry.year ?? null,
      });
    }

    const season = typeof row.parentIndex === 'number' ? row.parentIndex : null;
    const number = typeof row.index === 'number' ? row.index : null;
    const hasEpisode = kind === 'show' && season !== null && number !== null;

    if (kind === 'show' && !hasEpisode) degraded++;

    if (hasEpisode) {
      const episodeKey = `${key}/${season}/${number}`;
      if (!episodes.has(episodeKey)) {
        episodes.set(episodeKey, { titleKey: key, season, number, name: row.title ?? null });
      }
    }

    events.push({
      sourceEventId: historyKey,
      titleKey: key,
      season: hasEpisode ? season : null,
      number: hasEpisode ? number : null,
      watchedAt: new Date(row.viewedAt * 1000),
      // A dump row is dropped above unless it carries viewedAt, so anything
      // reaching here has a real instant behind it rather than a remembered one.
      watchedPrecision: 'exact',
      accountId: row.accountID === undefined ? null : String(row.accountID),
      raw: row,
    });
  }

  return {
    titles: [...titles.values()],
    episodes: [...episodes.values()],
    events,
    dropped,
    degraded,
  };
}
