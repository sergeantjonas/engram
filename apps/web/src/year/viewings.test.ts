import { describe, expect, it } from 'vitest';
import type { HistoryPlay, HistoryTitle } from '../api/history.ts';
import {
  dayOf,
  dayTotals,
  finishedIn,
  todayIn,
  viewingsOf,
  yearFigures,
  yearsOf,
} from './viewings.ts';

const ZONE = 'Europe/Brussels';

const play = (over: Partial<HistoryPlay> = {}): HistoryPlay => ({
  id: crypto.randomUUID(),
  titleId: 't1',
  season: 1,
  number: 1,
  name: null,
  runtimeMin: 50,
  watchedAt: '2025-06-14T19:00:00+00:00',
  precision: 'exact',
  source: 'plex-history',
  ...over,
});

const title = (over: Partial<HistoryTitle> = {}): HistoryTitle => ({
  id: 't1',
  kind: 'show',
  name: 'Untitled',
  posterPath: null,
  state: 'seen',
  ...over,
});

describe('dayOf', () => {
  it('reads an instant in the viewer’s zone and a day as it was written', () => {
    // Half past midnight in Brussels, still the evening before in UTC.
    expect(dayOf('2025-06-14T22:30:00+00:00', 'exact', ZONE)).toBe('2025-06-15');
    expect(dayOf('2025-06-14T22:30:00+00:00', 'exact', 'UTC')).toBe('2025-06-14');
    // Stored as the date's first instant in UTC, which is the day before in
    // New York; the date as written wins, however the instant was printed.
    expect(dayOf('2025-06-14T00:00:00+00:00', 'day', 'America/New_York')).toBe('2025-06-14');
    expect(dayOf('2025-06-13T20:00:00-04:00', 'day', ZONE)).toBe('2025-06-14');
  });

  it('gives a month, a year or no date no day', () => {
    expect(dayOf('2025-06-01T00:00:00+00:00', 'month', ZONE)).toBeNull();
    expect(dayOf('2025-01-01T00:00:00+00:00', 'year', ZONE)).toBeNull();
    expect(dayOf(null, 'unknown', ZONE)).toBeNull();
  });
});

describe('viewingsOf', () => {
  it('counts two sources describing one day’s watching once', () => {
    const viewings = viewingsOf(
      [
        play({ watchedAt: '2025-06-14T19:00:00+00:00', source: 'plex-history' }),
        play({ watchedAt: '2025-06-14T19:48:00+00:00', source: 'plex-library' }),
      ],
      ZONE,
    );

    expect(viewings).toHaveLength(1);
    expect(viewings[0]).toMatchObject({
      day: '2025-06-14',
      plays: 1,
      at: '2025-06-14T19:00:00+00:00',
      timed: true,
      sources: ['plex-history', 'plex-library'],
    });
    // A day entered by hand knows no time of day.
    expect(
      viewingsOf([play({ watchedAt: '2025-06-14T00:00:00+00:00', precision: 'day' })], ZONE)[0]
        ?.timed,
    ).toBe(false);
  });

  it('keeps the time of a play over the midnight of a day entered by hand', () => {
    const [viewing] = viewingsOf(
      [
        play({ watchedAt: '2025-06-14T00:00:00+00:00', precision: 'day', source: 'manual' }),
        play({ watchedAt: '2025-06-14T19:30:00+00:00' }),
      ],
      ZONE,
    );

    expect(viewing).toMatchObject({ at: '2025-06-14T19:30:00+00:00', timed: true });
  });

  it('counts a per-play source’s rows on one day as that many plays', () => {
    const [viewing] = viewingsOf(
      [
        play({ watchedAt: '2025-06-14T09:00:00+00:00' }),
        play({ watchedAt: '2025-06-14T19:00:00+00:00' }),
        play({ watchedAt: '2025-06-14T19:40:00+00:00', source: 'plex-library' }),
      ],
      ZONE,
    );

    expect(viewing?.plays).toBe(2);
  });

  it('keeps episodes, titles and days apart', () => {
    const viewings = viewingsOf(
      [
        play(),
        play({ number: 2 }),
        play({ titleId: 't2' }),
        play({ watchedAt: '2025-06-15T19:00:00+00:00' }),
      ],
      ZONE,
    );

    expect(viewings).toHaveLength(4);
  });

  it('lets a coarse claim stand for a viewing only where nothing finer covers it', () => {
    const viewings = viewingsOf(
      [
        play({ watchedAt: '2025-06-14T19:00:00+00:00' }),
        // The same watching remembered by hand: June 2025, and 2025.
        play({ watchedAt: '2025-06-01T00:00:00+00:00', precision: 'month', source: 'manual' }),
        play({ watchedAt: '2025-01-01T00:00:00+00:00', precision: 'year', source: 'manual' }),
        // A month claim for an episode with nothing finer, and the year claim
        // it covers.
        play({
          number: 2,
          watchedAt: '2019-03-01T00:00:00+00:00',
          precision: 'month',
          source: 'manual',
        }),
        play({
          number: 2,
          watchedAt: '2019-01-01T00:00:00+00:00',
          precision: 'year',
          source: 'manual',
        }),
      ],
      ZONE,
    );

    expect(viewings.map((viewing) => [viewing.number, viewing.day, viewing.year])).toEqual([
      [2, null, 2019],
      [1, '2025-06-14', 2025],
    ]);
  });

  it('names every source behind a coarse claim it keeps', () => {
    const [viewing] = viewingsOf(
      [
        play({ watchedAt: '2019-03-01T00:00:00+00:00', precision: 'month', source: 'manual' }),
        play({ watchedAt: '2019-03-01T00:00:00+00:00', precision: 'month', source: 'trakt' }),
      ],
      ZONE,
    );

    expect(viewing).toMatchObject({ day: null, period: '2019-03', plays: 1 });
    expect(viewing?.sources).toEqual(['manual', 'trakt']);
  });

  // West of UTC a day entered by hand starts at an instant that is still the
  // evening before, so ordering by instant would put it after that evening.
  it('orders by the calendar before the instant', () => {
    const viewings = viewingsOf(
      [
        play({ number: 1, watchedAt: '2025-01-01T00:00:00+00:00', precision: 'day' }),
        play({ number: 2, watchedAt: '2025-01-01T03:00:00+00:00' }),
      ],
      'America/New_York',
    );

    expect(viewings.map((viewing) => viewing.day)).toEqual(['2024-12-31', '2025-01-01']);
  });
});

describe('dayTotals', () => {
  it('sums plays per day and leaves the undayed out', () => {
    const totals = dayTotals(
      viewingsOf(
        [
          play(),
          play({ number: 2 }),
          play({ number: 2, watchedAt: '2025-06-14T21:00:00+00:00' }),
          play({ watchedAt: '2025-06-01T00:00:00+00:00', precision: 'month', number: 3 }),
        ],
        ZONE,
      ),
    );

    expect([...totals]).toEqual([['2025-06-14', 3]]);
  });
});

describe('finishedIn', () => {
  it('finishes a run on the latest of its regular episodes’ first viewings', () => {
    const viewings = viewingsOf(
      [
        play({ number: 1, watchedAt: '2024-11-02T20:00:00+00:00' }),
        play({ number: 2, watchedAt: '2025-01-03T20:00:00+00:00' }),
        // A rewatch of the pilot later still does not move the finish.
        play({ number: 1, watchedAt: '2026-02-01T20:00:00+00:00' }),
        // Nor does a special.
        play({ season: 0, number: 1, watchedAt: '2026-03-01T20:00:00+00:00' }),
      ],
      ZONE,
    );

    expect(finishedIn(viewings, [title()])).toEqual(new Map([['t1', 2025]]));
  });

  it('finishes a film at its first viewing, and nothing that is not finished', () => {
    const viewings = viewingsOf(
      [
        play({ titleId: 'f1', season: null, number: null, watchedAt: '2023-05-01T20:00:00+00:00' }),
        play({ titleId: 'f1', season: null, number: null, watchedAt: '2025-05-01T20:00:00+00:00' }),
        play({ titleId: 't2' }),
      ],
      ZONE,
    );

    expect(
      finishedIn(viewings, [
        title({ id: 'f1', kind: 'movie' }),
        title({ id: 't2', state: 'in_progress' }),
      ]),
    ).toEqual(new Map([['f1', 2023]]));
  });
});

describe('yearFigures', () => {
  it('sums a year’s plays, episodes and minutes, and says what it could not place or time', () => {
    const viewings = viewingsOf(
      [
        play({ number: 1, runtimeMin: 50 }),
        play({ number: 1, runtimeMin: 50, watchedAt: '2025-06-14T21:00:00+00:00' }),
        play({ number: 2, runtimeMin: null }),
        play({ number: 3, watchedAt: '2025-08-01T00:00:00+00:00', precision: 'month' }),
        play({ number: 4, watchedAt: '2024-06-14T19:00:00+00:00' }),
      ],
      ZONE,
    );

    expect(yearFigures(viewings, new Map([['t1', 2025]]), 2025)).toEqual({
      plays: 4,
      episodes: 3,
      minutes: 150,
      untimed: 1,
      finished: 1,
      undayed: 1,
    });
  });
});

describe('yearsOf', () => {
  it('runs from the first dated year to this one, newest first, empty years kept', () => {
    const viewings = viewingsOf([play({ watchedAt: '2022-03-01T20:00:00+00:00' })], ZONE);

    expect(yearsOf(viewings, '2025-09-22')).toEqual([2025, 2024, 2023, 2022]);
    expect(yearsOf([], '2025-09-22')).toEqual([2025]);
  });
});

describe('todayIn', () => {
  it('dates today in the viewer’s zone', () => {
    expect(todayIn(ZONE, new Date('2025-12-31T23:30:00Z'))).toBe('2026-01-01');
  });
});
