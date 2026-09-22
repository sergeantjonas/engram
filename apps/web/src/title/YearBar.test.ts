import { describe, expect, it } from 'vitest';
import type { WatchMoment } from '../api/titles.ts';
import { marksIn } from './YearBar.tsx';

const now = new Date('2026-09-20T12:00:00.000Z');
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();

const moment = (over: Partial<WatchMoment> = {}): WatchMoment => ({
  id: crypto.randomUUID(),
  season: 1,
  number: 1,
  name: null,
  watchedAt: daysAgo(10),
  precision: 'exact',
  source: 'plex-history',
  rewatch: false,
  ...over,
});

describe('marksIn', () => {
  it('puts one mark on a day however many plays it holds', () => {
    const { marks } = marksIn(
      [
        moment({ watchedAt: '2026-09-10T09:00:00.000Z' }),
        moment({ watchedAt: '2026-09-10T20:00:00.000Z' }),
        moment({ watchedAt: '2026-09-11T09:00:00.000Z' }),
      ],
      now,
      'UTC',
    );

    expect(marks.map((mark) => mark.day)).toEqual(['2026-09-10', '2026-09-11']);
  });

  // The day is the viewer's: 22:30 UTC is already the next day in Brussels.
  it('reads the day in the viewer’s zone', () => {
    const late = [moment({ watchedAt: '2026-09-10T22:30:00.000Z' })];

    expect(marksIn(late, now, 'UTC').marks[0]?.day).toBe('2026-09-10');
    expect(marksIn(late, now, 'Europe/Brussels').marks[0]?.day).toBe('2026-09-11');
  });

  // A coarse entry holds the first instant of its period, so a 2019 watch
  // would land on the 1st of January — a day nobody watched anything on.
  it('plots only the dates precise enough to be a day', () => {
    const { marks } = marksIn(
      [
        moment({ watchedAt: daysAgo(5), precision: 'month' }),
        moment({ watchedAt: daysAgo(6), precision: 'year' }),
        moment({ watchedAt: null, precision: 'unknown' }),
        moment({ watchedAt: daysAgo(7), precision: 'day' }),
      ],
      now,
    );

    expect(marks).toHaveLength(1);
  });

  it('drops what falls outside the year, and places what is left along it', () => {
    const { marks } = marksIn(
      [moment({ watchedAt: daysAgo(400) }), moment({ watchedAt: daysAgo(182) })],
      now,
    );

    expect(marks).toHaveLength(1);
    // Half a year back is about halfway along.
    expect(marks[0]?.left).toBeGreaterThan(0.45);
    expect(marks[0]?.left).toBeLessThan(0.55);
  });
});
