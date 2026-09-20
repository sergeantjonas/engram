import { describe, expect, it } from 'vitest';
import type { EpisodeCell, SeasonGrid } from '../api/titles.ts';
import { titleFigures } from './figures.ts';

const episode = (over: Partial<EpisodeCell> = {}): EpisodeCell => ({
  id: crypto.randomUUID(),
  number: 1,
  name: null,
  airDate: null,
  runtimeMin: null,
  seen: false,
  playCount: 0,
  firstWatchedAt: null,
  firstWatchedPrecision: null,
  lastWatchedAt: null,
  lastWatchedPrecision: null,
  unmatched: false,
  gap: null,
  ...over,
});

const season = (number: number, episodes: EpisodeCell[]): SeasonGrid => ({
  season: number,
  episodes,
});

describe('titleFigures', () => {
  it('sums plays and counts the episodes seen more than once', () => {
    const figures = titleFigures([
      season(1, [
        episode({ seen: true, playCount: 1 }),
        episode({ seen: true, playCount: 3 }),
        episode({ seen: true, playCount: 2 }),
        episode(),
      ]),
    ]);

    expect(figures.plays).toBe(6);
    // Three extra plays across two episodes is still two rewatched episodes.
    expect(figures.rewatched).toBe(2);
  });

  it('leaves specials out, the way the wall fraction does', () => {
    const figures = titleFigures([
      season(0, [episode({ seen: true, playCount: 5 })]),
      season(1, [episode({ seen: true, playCount: 1 })]),
    ]);

    expect(figures.plays).toBe(1);
  });

  it('takes the earliest watch with its own precision, not the finest one present', () => {
    const figures = titleFigures([
      season(1, [
        episode({
          seen: true,
          playCount: 1,
          firstWatchedAt: '2026-09-01T18:30:00.000Z',
          firstWatchedPrecision: 'exact',
        }),
        episode({
          seen: true,
          playCount: 1,
          firstWatchedAt: '2019-01-01T00:00:00.000Z',
          firstWatchedPrecision: 'year',
        }),
      ]),
    ]);

    expect(figures.firstWatchedAt).toBe('2019-01-01T00:00:00.000Z');
    expect(figures.firstWatchedPrecision).toBe('year');
  });

  it('takes its latest boundary off the run, so a special cannot drive it', () => {
    const figures = titleFigures([
      season(0, [
        episode({
          seen: true,
          playCount: 1,
          lastWatchedAt: '2026-09-19T12:00:00.000Z',
          lastWatchedPrecision: 'exact',
        }),
      ]),
      season(1, [
        episode({
          seen: true,
          playCount: 1,
          lastWatchedAt: '2026-03-15T12:00:00.000Z',
          lastWatchedPrecision: 'exact',
        }),
      ]),
    ]);

    expect(figures.lastWatchedAt).toBe('2026-03-15T12:00:00.000Z');
  });

  it('has nothing to report for a film, which has no episode rows', () => {
    expect(titleFigures([])).toMatchObject({
      plays: 0,
      rewatched: 0,
      firstWatchedAt: null,
      lastWatchedAt: null,
    });
  });

  it('has no first watch for a title nothing has been played from', () => {
    const figures = titleFigures([season(1, [episode(), episode()])]);

    expect(figures).toMatchObject({ plays: 0, rewatched: 0, firstWatchedAt: null });
  });
});
