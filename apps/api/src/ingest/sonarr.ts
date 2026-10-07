import { type ExternalIds, episodeKey, titleKey } from '@engram/shared';
import { z } from 'zod';

/** What Sonarr did to an episode's file. Mirrors `library_event_kind`. */
export type LibraryEventKind = 'grab' | 'import' | 'delete';

/*
 * The fields of Sonarr's webhook bodies this reads, as `v4.0.20.3012` builds
 * them (`src/NzbDrone.Core/Notifications/Webhook/`). Typed JSON, unlike
 * Tautulli's template: numbers arrive as numbers, property names and enums
 * are camelCase, and `eventType` alone is PascalCase. An id Sonarr has no
 * value for is 0 rather than absent. Whatever the parse ignores is kept in
 * `raw`.
 */
const optionalId = z.number().int().nullish();

const seriesShape = z.object({
  title: z.string().min(1),
  tvdbId: optionalId,
  tmdbId: optionalId,
  imdbId: z.string().nullish(),
  year: optionalId,
});

const episodeShape = z.object({
  seasonNumber: z.number().int().min(0),
  episodeNumber: z.number().int().min(0),
  title: z.string().nullish(),
  // Anything but a real date reads as none: Postgres would refuse it in
  // `episode.air_date`, and a refused write answers Sonarr with a 500.
  airDate: z.iso.date().nullish().catch(null),
});

const episodes = z.array(episodeShape).min(1);
const episodeFile = z.object({ id: z.number().int().positive() });

const grabBody = z.object({ series: seriesShape, episodes, downloadId: z.string().min(1) });
const importBody = z.object({ series: seriesShape, episodes, episodeFile });
const deleteBody = z.object({
  series: seriesShape,
  episodes,
  episodeFile,
  deleteReason: z.string().nullish(),
});
const seriesBody = z.object({ series: seriesShape });
const seriesDeleteBody = z.object({ series: seriesShape, deletedFiles: z.boolean().nullish() });

export interface PlannedSeries {
  key: string;
  kind: 'show';
  ids: ExternalIds;
  name: string;
  /** Sonarr's own year for the series, which is the show's and not an episode's. */
  year: number | null;
}

export interface PlannedEpisode {
  season: number;
  number: number;
  name: string | null;
  /** As Sonarr has it, `YYYY-MM-DD`. Only ever fills a row the backfill has not. */
  airDate: string | null;
}

export interface PlannedLibraryEvent {
  sourceEventId: string;
  kind: LibraryEventKind;
  episode: PlannedEpisode;
  raw: unknown;
}

export type SonarrPlan =
  /** Nothing to write: a test, a trigger this does not read, or a delete an upgrade made. */
  | { ok: true; action: 'none'; eventType: string; why: string }
  | { ok: true; action: 'series-add'; series: PlannedSeries }
  | { ok: true; action: 'series-delete'; series: PlannedSeries; filesDeleted: boolean }
  | {
      ok: true;
      action: 'file';
      kind: LibraryEventKind;
      series: PlannedSeries;
      events: PlannedLibraryEvent[];
    }
  | { ok: false; reason: string };

type Parsed<T> = { ok: true; body: T } | { ok: false; reason: string };

function parse<T>(schema: z.ZodType<T>, body: unknown, eventType: string): Parsed<T> {
  const parsed = schema.safeParse(body);
  if (parsed.success) return { ok: true, body: parsed.data };
  // Paths, never values: a body that failed to parse still names a show.
  const fields = parsed.error.issues.map((issue) => issue.path.join('.') || '(body)');
  return { ok: false, reason: `${eventType} body not read at ${[...new Set(fields)].join(', ')}` };
}

const present = (id: number | null | undefined): string | undefined =>
  id === null || id === undefined || id <= 0 ? undefined : String(id);

/** The show a body names, keyed on tvdb the way the record keys every show. */
function seriesOf(
  series: z.infer<typeof seriesShape>,
): { ok: true; series: PlannedSeries } | { ok: false; reason: string } {
  const ids: ExternalIds = {};
  const tvdb = present(series.tvdbId);
  const tmdb = present(series.tmdbId);
  if (tvdb !== undefined) ids.tvdb = tvdb;
  if (tmdb !== undefined) ids.tmdb = tmdb;
  if (series.imdbId) ids.imdb = series.imdbId;

  const key = titleKey({ kind: 'show', ids });
  // Sonarr keys on tvdb itself, so this is a series it has not finished
  // looking up, and storing it under another id would split the show in two.
  if (key === null) return { ok: false, reason: 'series has no tvdb id' };

  const year =
    series.year === null || series.year === undefined || series.year <= 0 ? null : series.year;
  return { ok: true, series: { key, kind: 'show', ids, name: series.title, year } };
}

/**
 * One event per episode the body names. A file can hold several episodes — a
 * double-length premiere is one file and two episodes — and each is its own
 * fact about its own episode.
 */
function eventsOf(
  series: PlannedSeries,
  kind: LibraryEventKind,
  occurrence: string,
  list: z.infer<typeof episodes>,
  body: Record<string, unknown>,
): PlannedLibraryEvent[] {
  // The body's own entries, by position: a parse keeps the list's order.
  const rawEpisodes = Array.isArray(body.episodes) ? body.episodes : [];
  return list.map((ep, i) => {
    const slot = episodeKey({
      title: { kind: 'show', ids: series.ids },
      season: ep.seasonNumber,
      episode: ep.episodeNumber,
    });
    return {
      // Never null here: the series already keyed on these same ids.
      sourceEventId: `${slot}@${kind}@${occurrence}`,
      kind,
      episode: {
        season: ep.seasonNumber,
        number: ep.episodeNumber,
        name: ep.title ?? null,
        airDate: ep.airDate ?? null,
      },
      // The body with only this row's episode in it. A season pack names
      // every episode, overview and all, and kept whole on each row it would
      // be stored once per episode; across its rows it is still all there.
      raw: { ...body, episodes: [rawEpisodes[i]] },
    };
  });
}

/**
 * Turns one Sonarr webhook body into what it implies for the record.
 *
 * Pure: no database, no network, no clock.
 *
 * Sonarr sends no event id, so the id is built from what each event does
 * carry. A grab is one release for one episode, so `downloadId` and the
 * episode name it once however often it arrives; an import or a delete is
 * one file, and `episodeFile.id` does the same. Nothing is dated here — the
 * payload carries no time, and the row's arrival is the event's.
 */
export function planSonarrEvent(body: unknown): SonarrPlan {
  const fields = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const eventType = typeof fields.eventType === 'string' ? fields.eventType : '(absent)';

  switch (eventType) {
    case 'Grab': {
      const read = parse(grabBody, body, eventType);
      if (!read.ok) return read;
      const keyed = seriesOf(read.body.series);
      if (!keyed.ok) return keyed;
      const { series } = keyed;
      const events = eventsOf(series, 'grab', read.body.downloadId, read.body.episodes, fields);
      return { ok: true, action: 'file', kind: 'grab', series, events };
    }

    case 'Download': {
      // *On Import Complete* sends this same event type, once per release
      // with every file in it. Only *On Import* is read — one body per file,
      // with the file's own id — so a trigger turned on by mistake is
      // ignored rather than counted twice.
      if ('episodeFiles' in fields) {
        return { ok: true, action: 'none', eventType, why: 'import complete is not read' };
      }
      const read = parse(importBody, body, eventType);
      if (!read.ok) return read;
      const keyed = seriesOf(read.body.series);
      if (!keyed.ok) return keyed;
      const { series } = keyed;
      // An upgrade is recorded like any import: a new file did arrive. Whether
      // it is worth saying is for the alerts, which read `isUpgrade` off `raw`.
      const occurrence = String(read.body.episodeFile.id);
      const events = eventsOf(series, 'import', occurrence, read.body.episodes, fields);
      return { ok: true, action: 'file', kind: 'import', series, events };
    }

    case 'EpisodeFileDelete': {
      const read = parse(deleteBody, body, eventType);
      if (!read.ok) return read;
      // The old file of an upgrade, whose replacement arrives as an import.
      // Recorded, it could land after that import and read as the episode
      // gone. Sonarr sends these only when told to, and it is not told to.
      if (read.body.deleteReason?.toLowerCase() === 'upgrade') {
        return { ok: true, action: 'none', eventType, why: 'deleted for an upgrade' };
      }
      const keyed = seriesOf(read.body.series);
      if (!keyed.ok) return keyed;
      const { series } = keyed;
      const occurrence = String(read.body.episodeFile.id);
      const events = eventsOf(series, 'delete', occurrence, read.body.episodes, fields);
      return { ok: true, action: 'file', kind: 'delete', series, events };
    }

    case 'SeriesAdd': {
      const read = parse(seriesBody, body, eventType);
      if (!read.ok) return read;
      const keyed = seriesOf(read.body.series);
      if (!keyed.ok) return keyed;
      return { ok: true, action: 'series-add', series: keyed.series };
    }

    case 'SeriesDelete': {
      const read = parse(seriesDeleteBody, body, eventType);
      if (!read.ok) return read;
      const keyed = seriesOf(read.body.series);
      if (!keyed.ok) return keyed;
      return {
        ok: true,
        action: 'series-delete',
        series: keyed.series,
        filesDeleted: read.body.deletedFiles === true,
      };
    }

    // The settings page's own button. Its series is made up, so it is never
    // planned as one; arriving at all is what it tests.
    case 'Test':
      return { ok: true, action: 'none', eventType, why: 'test' };

    default:
      return { ok: true, action: 'none', eventType, why: 'not a trigger this reads' };
  }
}
