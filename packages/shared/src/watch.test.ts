import { describe, expect, it } from 'vitest';
import { manualEventId, parseWatchedAt } from './watch.js';

const iso = (moment: ReturnType<typeof parseWatchedAt>) => moment?.watchedAt?.toISOString() ?? null;

describe('parseWatchedAt', () => {
  it('reads the precision off the shape of what was written', () => {
    expect(parseWatchedAt('2019')?.precision).toBe('year');
    expect(parseWatchedAt('2019-06')?.precision).toBe('month');
    expect(parseWatchedAt('2019-06-14')?.precision).toBe('day');
    expect(parseWatchedAt('2019-06-14T21:03:00Z')?.precision).toBe('exact');
  });

  // The UI renders "2019" back from this; the stored instant is an artefact of
  // needing one orderable column, not a claim about January.
  it('stores the first instant of the period a coarse date names', () => {
    expect(iso(parseWatchedAt('2019'))).toBe('2019-01-01T00:00:00.000Z');
    expect(iso(parseWatchedAt('2019-06'))).toBe('2019-06-01T00:00:00.000Z');
    expect(iso(parseWatchedAt('2019-06-14'))).toBe('2019-06-14T00:00:00.000Z');
  });

  it('treats an absent date as the ordinary case rather than an error', () => {
    expect(parseWatchedAt(null)).toEqual({ watchedAt: null, precision: 'unknown' });
    expect(parseWatchedAt(undefined)).toEqual({ watchedAt: null, precision: 'unknown' });
    expect(parseWatchedAt('  ')).toEqual({ watchedAt: null, precision: 'unknown' });
  });

  // Date.UTC rolls these forward instead of failing, which would store a date
  // the viewer never named.
  it('refuses a day that does not exist', () => {
    expect(parseWatchedAt('2019-02-30')).toBeNull();
    expect(parseWatchedAt('2019-13-01')).toBeNull();
    expect(parseWatchedAt('2019-00')).toBeNull();
  });

  // An ISO instant rolls an impossible day rather than failing, exactly as a
  // bare date does, so the calendar check has to cover both.
  it('refuses a day that does not exist inside an instant either', () => {
    expect(parseWatchedAt('2019-02-30T12:00:00Z')).toBeNull();
    expect(parseWatchedAt('2019-06-31T00:00:00Z')).toBeNull();
    expect(parseWatchedAt('2019-06-14T25:00:00Z')).toBeNull();
  });

  it('keeps a leap day that does', () => {
    expect(iso(parseWatchedAt('2020-02-29'))).toBe('2020-02-29T00:00:00.000Z');
  });

  // Without an offset the same string is two different moments on a laptop and
  // on the server.
  it('refuses an instant that names no offset', () => {
    expect(parseWatchedAt('2019-06-14T21:03:00')).toBeNull();
    expect(parseWatchedAt('2019-06-14T21:03:00+02:00')?.precision).toBe('exact');
  });

  it('refuses anything it cannot read', () => {
    expect(parseWatchedAt('June 2019')).toBeNull();
    expect(parseWatchedAt('19')).toBeNull();
    expect(parseWatchedAt('2019-6-4')).toBeNull();
  });
});

describe('manualEventId', () => {
  it('names the episode a mark is about', () => {
    expect(
      manualEventId({ titleKey: 'show:tvdb:392276', slot: { season: 2, episode: 5 }, on: null }),
    ).toBe('manual:show:tvdb:392276:S2E5');
  });

  it('leaves the slot off a movie, which has no episode to name', () => {
    expect(manualEventId({ titleKey: 'movie:tmdb:603', slot: null, on: null })).toBe(
      'manual:movie:tmdb:603',
    );
  });

  // The property the whole design rests on: marking a season twice is a no-op
  // against UNIQUE (source, source_event_id) rather than a doubled play count.
  it('is stable across submissions of the same undated mark', () => {
    const entry = { titleKey: 'show:tvdb:392276', slot: { season: 2, episode: 5 }, on: null };
    expect(manualEventId(entry)).toBe(manualEventId({ ...entry }));
  });

  it('appends a date, so a rewatch is a second event rather than a no-op', () => {
    const entry = { titleKey: 'show:tvdb:392276', slot: { season: 2, episode: 5 }, on: null };
    expect(manualEventId({ ...entry, on: '2019-06' })).toBe('manual:show:tvdb:392276:S2E5:2019-06');
    expect(manualEventId({ ...entry, on: '2019-06' })).not.toBe(manualEventId(entry));
  });

  // `parseWatchedAt` trims, so this has to as well: the same undated mark sent
  // as blank and as null would otherwise pass the unique constraint twice.
  it('treats a blank date as no date, the way the parser does', () => {
    const entry = { titleKey: 'show:tvdb:392276', slot: { season: 2, episode: 5 }, on: null };
    expect(manualEventId({ ...entry, on: '  ' })).toBe(manualEventId(entry));
    expect(manualEventId({ ...entry, on: ' 2019 ' })).toBe(manualEventId({ ...entry, on: '2019' }));
  });

  // Same instant, different claim: collapsing them would drop the day silently.
  it('keeps a year and the first of January apart', () => {
    const entry = { titleKey: 'movie:tmdb:603', slot: null, on: null };
    expect(manualEventId({ ...entry, on: '2019' })).not.toBe(
      manualEventId({ ...entry, on: '2019-01-01' }),
    );
  });
});
