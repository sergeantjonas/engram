import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { Database } from '../db/client.js';
import {
  CSV_HEADER,
  csvField,
  csvLine,
  type ExportEvent,
  recordCsv,
  recordEvents,
  recordJson,
  recordTitles,
  writtenDate,
} from './record.js';

const event = (over: Partial<ExportEvent> = {}): ExportEvent => ({
  title: 'show:tvdb:362696',
  kind: 'show',
  titleName: 'The Witcher',
  year: 2019,
  tmdbId: '71912',
  tvdbId: '362696',
  imdbId: 'tt5180504',
  season: 1,
  episode: 1,
  episodeName: 'The End’s Beginning',
  watchedAt: '2025-12-02T21:00:00.000Z',
  precision: 'exact',
  source: 'plex-history',
  sourceEventId: '/status/sessions/history/12',
  plays: null,
  completed: true,
  ...over,
});

/** An event row as the statement returns it. */
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  sort_at: '2025-12-02T21:00:00+00:00',
  title_key: 'show:tvdb:362696',
  kind: 'show',
  title_name: 'The Witcher',
  year: 2019,
  tmdb_id: '71912',
  tvdb_id: '362696',
  imdb_id: 'tt5180504',
  season: 1,
  number: 1,
  episode_name: null,
  watched_at: '2025-12-02T21:00:00+00:00',
  watched_precision: 'exact',
  source: 'plex-history',
  source_event_id: id,
  plays: null,
  completed: true,
  ...over,
});

/** Answers each statement with the next set of rows, keeping the statements it was handed. */
const replay = (answers: unknown[][]) => {
  const statements: SQL[] = [];
  const db = {
    execute: async (statement: SQL) => {
      statements.push(statement);
      return answers.shift() ?? [];
    },
  } as unknown as Database;
  return { db, statements };
};

/** A statement rendered, so a missing clause or a wrongly bound value shows. */
const rendered = (statement: SQL | undefined) => new PgDialect().sqlToQuery(statement as SQL);

const collect = async <T>(source: AsyncGenerator<T>) => {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
};

describe('writtenDate', () => {
  it('writes a date the way it would be entered, read in UTC whatever zone printed it', () => {
    expect(writtenDate('2025-12-02T22:30:00+01:00', 'exact')).toBe('2025-12-02T21:30:00.000Z');
    expect(writtenDate('2019-06-13T20:00:00-04:00', 'day')).toBe('2019-06-14');
    expect(writtenDate('2019-06-01T00:00:00+00:00', 'month')).toBe('2019-06');
    expect(writtenDate('2019-01-01T00:00:00+00:00', 'year')).toBe('2019');
    expect(writtenDate(null, 'unknown')).toBeNull();
  });
});

describe('csvField', () => {
  it('quotes what RFC 4180 says to, and leaves the rest bare', () => {
    expect(csvField('Holly, Jolly')).toBe('"Holly, Jolly"');
    expect(csvField('The "Weirdo"')).toBe('"The ""Weirdo"""');
    expect(csvField('two\nlines')).toBe('"two\nlines"');
    expect(csvField('plain')).toBe('plain');
    expect(csvField(null)).toBe('');
    expect(csvField(false)).toBe('false');
  });

  it('keeps free text from reading as a formula, and only free text', () => {
    expect(csvField('=HYPERLINK("x")', true)).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvField('-ism', true)).toBe("'-ism");
    expect(csvField('-ism')).toBe('-ism');
  });
});

describe('csvLine', () => {
  it('writes one event as a line under the header, blank where there is nothing', () => {
    const line = csvLine(event({ season: null, episode: null, episodeName: null, plays: 2 }));

    expect(line.endsWith('\r\n')).toBe(true);
    expect(line.trimEnd().split(',')).toHaveLength(CSV_HEADER.length);
    expect(line).toBe(
      'show:tvdb:362696,show,The Witcher,2019,71912,362696,tt5180504,,,,2025-12-02T21:00:00.000Z,exact,plex-history,/status/sessions/history/12,2,true\r\n',
    );
  });
});

describe('recordEvents', () => {
  it('reads page after page until one comes back short', async () => {
    const { db, statements } = replay([[row('a'), row('b')], [row('c'), row('d')], [row('e')]]);

    const events = await collect(recordEvents(db, 2));

    expect(events.map((each) => each.sourceEventId)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(statements).toHaveLength(3);
  });

  it('asks once more after a full last page, and stops on the empty answer', async () => {
    const { db, statements } = replay([[row('a'), row('b')]]);

    expect(await collect(recordEvents(db, 2))).toHaveLength(2);
    expect(statements).toHaveLength(2);
  });

  // What the pages actually ask for, rather than what the stub answers: a
  // cursor bound to the wrong row, or dropped, would repeat the first page
  // for ever against a real database.
  it('starts the next page after the last row, a film’s missing episode as -1', async () => {
    const film = row('f', {
      sort_at: '-infinity',
      title_key: 'movie:tmdb:438631',
      season: null,
      number: null,
    });
    const { db, statements } = replay([[row('a'), film], []]);

    await collect(recordEvents(db, 2));

    const [first, second] = statements.map(rendered);
    expect(first?.sql).not.toContain('where');
    expect(first?.params).toEqual([2]);
    expect(second?.sql).toContain('where (');
    expect(second?.params).toEqual(['-infinity', 'movie:tmdb:438631', -1, -1, 'f', 2]);
  });

  it('names the title by its key and the date as it was entered', async () => {
    const { db } = replay([
      [
        row('m', {
          sort_at: '-infinity',
          watched_at: null,
          watched_precision: 'unknown',
          source: 'manual',
        }),
        row('y', { watched_at: '2019-01-01T00:00:00+00:00', watched_precision: 'year' }),
      ],
    ]);

    const [undated, coarse] = await collect(recordEvents(db));

    expect(undated).toMatchObject({ title: 'show:tvdb:362696', watchedAt: null, source: 'manual' });
    expect(coarse?.watchedAt).toBe('2019');
  });
});

describe('recordCsv', () => {
  it('opens on the header', async () => {
    const { db } = replay([[row('a')]]);

    const [header, first] = await collect(recordCsv(db));

    expect(header).toBe(`${CSV_HEADER.join(',')}\r\n`);
    expect(first?.startsWith('show:tvdb:362696,show,The Witcher,')).toBe(true);
  });
});

describe('recordTitles and recordJson', () => {
  it('writes one document, titles with what was said of them, then every event', async () => {
    const { db } = replay([
      [
        {
          key: 'show:tvdb:362696',
          kind: 'show',
          name: 'The Witcher',
          year: 2019,
          tmdb_id: '71912',
          tvdb_id: '362696',
          imdb_id: 'tt5180504',
          want: null,
          dropped_at: '2026-01-01T00:00:00+00:00',
          excluded_at: null,
          note: 'lost the thread',
        },
      ],
      [{ title_key: 'show:tvdb:362696', season: 2, number: 3, reason: 'skipped', note: null }],
      [row('a'), row('b')],
    ]);

    const titles = await recordTitles(db);
    const text = (await collect(recordJson(db, new Date('2026-09-22T12:00:00Z'), titles))).join('');
    const document = JSON.parse(text);

    expect(document).toMatchObject({
      format: 'engram-record',
      version: 1,
      exportedAt: '2026-09-22T12:00:00.000Z',
    });
    expect(document.titles).toEqual([
      {
        key: 'show:tvdb:362696',
        kind: 'show',
        name: 'The Witcher',
        year: 2019,
        ids: { tmdb: '71912', tvdb: '362696', imdb: 'tt5180504' },
        intent: {
          want: false,
          droppedAt: '2026-01-01T00:00:00+00:00',
          excludedAt: null,
          note: 'lost the thread',
        },
        gaps: [{ season: 2, episode: 3, reason: 'skipped', note: null }],
      },
    ]);
    expect(document.events.map((each: ExportEvent) => each.sourceEventId)).toEqual(['a', 'b']);
  });

  it('is still a document when there are no events', async () => {
    const { db } = replay([[]]);

    const text = (await collect(recordJson(db, new Date(), []))).join('');

    expect(JSON.parse(text)).toMatchObject({ titles: [], events: [] });
  });
});
