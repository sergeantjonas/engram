import type { TitleKind, WatchPrecision } from '@engram/shared';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/client.js';
import { MANUAL_SOURCE } from '../watch/plan.js';

/** What the export will hold, said before it is downloaded. */
export interface RecordSummary {
  titles: number;
  events: number;
  /** Events entered by hand: nothing but the owner's word stands behind them. */
  manual: number;
}

export async function recordSummary(db: Database): Promise<RecordSummary> {
  const rows = await db.execute<Record<string, unknown> & RecordSummary>(sql`
    select
      (select count(*) from title)::int as titles,
      count(*)::int as events,
      count(*) filter (where source = ${MANUAL_SOURCE})::int as manual
    from watch_event
  `);
  return [...rows][0] ?? { titles: 0, events: 0, manual: 0 };
}

/**
 * One event as the export writes it.
 *
 * Named by the title's external key and the episode's place in it, never by
 * Engram's own ids: the file exists to outlive this database, and a uuid means
 * nothing anywhere else. `source` and `sourceEventId` on every row are what
 * lets a claim nothing can re-derive be found — a `manual` row is the owner's
 * word and nothing more.
 *
 * Not the raw ingest payload, the Plex account id, the player or the
 * platform: the first is Plex's internals, keyed to the `ratingKey`s this
 * project refuses to rely on, and the rest is about the device rather than the
 * watching. The nightly database dump keeps all of it.
 */
export interface ExportEvent {
  title: string;
  kind: TitleKind;
  titleName: string;
  year: number | null;
  tmdbId: string | null;
  tvdbId: string | null;
  imdbId: string | null;
  /** Null for a film, and for a show's play the Plex history could not place. */
  season: number | null;
  episode: number | null;
  episodeName: string | null;
  /** As `writtenDate` gives it; null when undated. */
  watchedAt: string | null;
  precision: WatchPrecision;
  source: string;
  sourceEventId: string;
  /** What the source counted, where it counts rather than enumerates; null otherwise. */
  plays: number | null;
  /** False for a play a per-play source saw stop before the end. */
  completed: boolean;
}

/**
 * A date as it would be entered by hand: the instant for an exact play, and a
 * coarse one as the day, month or year it names — `2019`, not the first
 * instant of 2019 it is stored as. That is the shape the mark form reads, so
 * the file is also something Engram could take back in.
 *
 * Coarse values are read in UTC, where they were stored, rather than cut from
 * the string, which Postgres prints in its session's zone.
 */
export function writtenDate(watchedAt: string | null, precision: WatchPrecision): string | null {
  if (watchedAt === null || precision === 'unknown') return null;
  const iso = new Date(watchedAt).toISOString();
  switch (precision) {
    case 'exact':
      return iso;
    case 'day':
      return iso.slice(0, 10);
    case 'month':
      return iso.slice(0, 7);
    case 'year':
      return iso.slice(0, 4);
  }
}

export const CSV_HEADER = [
  'title_key',
  'kind',
  'title',
  'year',
  'tmdb_id',
  'tvdb_id',
  'imdb_id',
  'season',
  'episode',
  'episode_name',
  'watched_at',
  'precision',
  'source',
  'source_event_id',
  'plays',
  'completed',
] as const;

/**
 * One CSV field, quoted when RFC 4180 needs it.
 *
 * Anything from TMDB — a title, an episode name, the IMDb id it hands on —
 * is anyone's to edit, and is also kept from reading as a formula: a
 * spreadsheet runs a cell that starts with `=`, `+`, `-` or `@`, and a leading
 * apostrophe is what those programs themselves use to say "this is text".
 * What Engram writes itself — keys, numbers, dates, sources — never starts
 * that way and is left as it is, since a reader parses it.
 */
export function csvField(value: string | number | boolean | null, text = false): string {
  if (value === null) return '';
  let field = String(value);
  if (text && /^[=+\-@\t\r]/.test(field)) field = `'${field}`;
  return /[",\r\n]/.test(field) ? `"${field.replaceAll('"', '""')}"` : field;
}

export function csvLine(event: ExportEvent): string {
  return `${[
    csvField(event.title),
    csvField(event.kind),
    csvField(event.titleName, true),
    csvField(event.year),
    csvField(event.tmdbId),
    csvField(event.tvdbId),
    csvField(event.imdbId, true),
    csvField(event.season),
    csvField(event.episode),
    csvField(event.episodeName, true),
    csvField(event.watchedAt),
    csvField(event.precision),
    csvField(event.source),
    csvField(event.sourceEventId),
    csvField(event.plays),
    csvField(event.completed),
  ].join(',')}\r\n`;
}

/** How many events one statement reads. The file is written as each page arrives. */
export const EXPORT_PAGE = 1000;

interface EventRow extends Record<string, unknown> {
  id: string;
  sort_at: string;
  title_key: string;
  kind: TitleKind;
  title_name: string;
  year: number | null;
  tmdb_id: string | null;
  tvdb_id: string | null;
  imdb_id: string | null;
  season: number | null;
  number: number | null;
  episode_name: string | null;
  watched_at: string | null;
  watched_precision: WatchPrecision;
  source: string;
  source_event_id: string;
  plays: number | null;
  completed: boolean;
}

const toEvent = (row: EventRow): ExportEvent => ({
  title: row.title_key,
  kind: row.kind,
  titleName: row.title_name,
  year: row.year,
  tmdbId: row.tmdb_id,
  tvdbId: row.tvdb_id,
  imdbId: row.imdb_id,
  season: row.season,
  episode: row.number,
  episodeName: row.episode_name,
  watchedAt: writtenDate(row.watched_at, row.watched_precision),
  precision: row.watched_precision,
  source: row.source,
  sourceEventId: row.source_event_id,
  plays: row.plays,
  completed: row.completed,
});

/**
 * Every event on record, oldest first, a page at a time.
 *
 * Undated first, the way the feed reads an undated play: a remembered watch
 * from before the record existed. Within one instant — and every undated mark
 * shares one — by title and then by episode, so a season entered by hand reads
 * in order rather than in the order of its ids. By the title's key rather than
 * its name: the name is TMDB's and is rewritten when the title is fetched
 * again, and a sort key that moved mid-export would move rows past the cursor.
 *
 * Paged by keyset rather than offset, on the columns it is ordered by —
 * `-infinity` standing in for no date and -1 for a missing episode, so every
 * comparison has a value — which means a row written or removed mid-export
 * cannot shift another into the next page twice or out of it. Each page is
 * still a sort over the whole table, since the order spans three of them; at
 * a few thousand events that is milliseconds, and the point of the pages is
 * the memory, not the plan.
 */
export async function* recordEvents(db: Database, page = EXPORT_PAGE): AsyncGenerator<ExportEvent> {
  let after: EventRow | null = null;
  for (;;) {
    const cursor = after;
    const rows: EventRow[] = [
      ...(await db.execute<EventRow>(sql`
        select
          we.id,
          to_json(coalesce(we.watched_at, '-infinity'::timestamptz)) as sort_at,
          t.key as title_key, t.kind, t.name as title_name, t.year,
          t.tmdb_id, t.tvdb_id, t.imdb_id,
          e.season, e.number, e.name as episode_name,
          to_json(we.watched_at) as watched_at,
          we.watched_precision, we.source, we.source_event_id, we.plays, we.completed
        from watch_event we
          join title t on t.id = we.title_id
          left join episode e on e.id = we.episode_id
        ${
          cursor === null
            ? sql``
            : sql`where (
                coalesce(we.watched_at, '-infinity'::timestamptz), t.key,
                coalesce(e.season, -1), coalesce(e.number, -1), we.id
              ) > (
                ${cursor.sort_at}::timestamptz, ${cursor.title_key}::text,
                ${cursor.season ?? -1}::int, ${cursor.number ?? -1}::int, ${cursor.id}::uuid
              )`
        }
        order by
          coalesce(we.watched_at, '-infinity'::timestamptz), t.key,
          coalesce(e.season, -1), coalesce(e.number, -1), we.id
        limit ${page}
      `)),
    ];
    for (const row of rows) yield toEvent(row);
    const last = rows.at(-1);
    if (last === undefined || rows.length < page) return;
    after = last;
  }
}

/** A title as the JSON export writes it, with what the owner has said about it. */
export interface ExportTitle {
  key: string;
  kind: TitleKind;
  name: string;
  year: number | null;
  ids: { tmdb: string | null; tvdb: string | null; imdb: string | null };
  intent: {
    want: boolean;
    droppedAt: string | null;
    excludedAt: string | null;
    note: string | null;
  };
  /** The holes the owner explained, by where they sit. */
  gaps: { season: number; episode: number; reason: string; note: string | null }[];
}

interface TitleRow extends Record<string, unknown> {
  key: string;
  kind: TitleKind;
  name: string;
  year: number | null;
  tmdb_id: string | null;
  tvdb_id: string | null;
  imdb_id: string | null;
  want: boolean | null;
  dropped_at: string | null;
  excluded_at: string | null;
  note: string | null;
}

interface GapRow extends Record<string, unknown> {
  title_key: string;
  season: number;
  number: number;
  reason: string;
  note: string | null;
}

/**
 * In UTC, as `watchedAt` is written: Postgres prints a timestamp in its
 * session's zone, which is the server's business and not the record's.
 */
const instant = (value: string | null) => (value === null ? null : new Date(value).toISOString());

/**
 * Every title, excluded ones included — "not mine" is part of the record, and
 * the flag says so on the row — with its intent and its explained holes. Two
 * statements rather than a page at a time: a library is hundreds of rows where
 * the events are thousands.
 */
export async function recordTitles(db: Database): Promise<ExportTitle[]> {
  const titles = await db.execute<TitleRow>(sql`
    select
      t.key, t.kind, t.name, t.year, t.tmdb_id, t.tvdb_id, t.imdb_id,
      i.want, to_json(i.dropped_at) as dropped_at, to_json(i.excluded_at) as excluded_at, i.note
    from title t
      left join intent i on i.title_id = t.id
    order by t.key
  `);
  const gaps = await db.execute<GapRow>(sql`
    select t.key as title_key, e.season, e.number, g.reason, g.note
    from episode_gap g
      join episode e on e.id = g.episode_id
      join title t on t.id = e.title_id
    order by t.key, e.season, e.number
  `);

  const byTitle = new Map<string, ExportTitle['gaps']>();
  for (const gap of gaps) {
    const list = byTitle.get(gap.title_key) ?? [];
    list.push({ season: gap.season, episode: gap.number, reason: gap.reason, note: gap.note });
    byTitle.set(gap.title_key, list);
  }

  return [...titles].map((row) => ({
    key: row.key,
    kind: row.kind,
    name: row.name,
    year: row.year,
    ids: { tmdb: row.tmdb_id, tvdb: row.tvdb_id, imdb: row.imdb_id },
    intent: {
      want: row.want ?? false,
      droppedAt: instant(row.dropped_at),
      excludedAt: instant(row.excluded_at),
      note: row.note,
    },
    gaps: byTitle.get(row.key) ?? [],
  }));
}

/** The CSV, one line at a time: the header, then an event per line. */
export async function* recordCsv(db: Database): AsyncGenerator<string> {
  yield `${CSV_HEADER.join(',')}\r\n`;
  for await (const event of recordEvents(db)) yield csvLine(event);
}

/**
 * The JSON, written as it goes: the titles first, read by the caller before
 * the response starts, then the events a page at a time into the array that
 * closes the document. Valid only once the last chunk is out, so a download
 * cut short is one no parser will take for the whole record.
 */
export async function* recordJson(
  db: Database,
  exportedAt: Date,
  titles: ExportTitle[],
): AsyncGenerator<string> {
  const head = { format: 'engram-record', version: 1, exportedAt: exportedAt.toISOString() };
  yield `${JSON.stringify(head).slice(0, -1)},"titles":${JSON.stringify(titles)},"events":[`;
  let first = true;
  for await (const event of recordEvents(db)) {
    yield `${first ? '\n' : ',\n'}${JSON.stringify(event)}`;
    first = false;
  }
  yield '\n]}\n';
}
