import { describe, expect, it } from 'vitest';
import type { Airing } from '../api/titles.ts';
import { airingLine } from './airing.ts';

const TODAY = '2026-09-22';

const airing = (over: Partial<Airing> = {}): Airing => ({
  lastAirDate: null,
  next: null,
  fetchedAt: `${TODAY}T08:00:00+00:00`,
  ...over,
});

describe('airingLine', () => {
  it('says nothing for a title TMDB has not described', () => {
    expect(airingLine({ status: null, year: 2020 }, airing(), TODAY)).toEqual({
      status: null,
      endedYear: null,
      nextAirDate: null,
      asOf: null,
    });
  });

  it('puts the status in the header’s words', () => {
    const word = (status: string) => airingLine({ status, year: 2020 }, airing(), TODAY).status;
    expect(word('Returning Series')).toBe('Returning');
    expect(word('Canceled')).toBe('Cancelled');
    expect(word('Ended')).toBe('Ended');
    expect(word('In Production')).toBe('In production');
  });

  it('says nothing about a released film, whose year already says it', () => {
    expect(airingLine({ status: 'Released', year: 1995 }, airing(), TODAY).status).toBeNull();
  });

  it('dates a closed run by its last episode, unless that is the year it started', () => {
    const ended = airing({ lastAirDate: '2015-05-08' });
    expect(airingLine({ status: 'Ended', year: 2009 }, ended, TODAY).endedYear).toBe('2015');
    expect(airingLine({ status: 'Canceled', year: 2009 }, ended, TODAY).endedYear).toBe('2015');
    expect(airingLine({ status: 'Ended', year: 2015 }, ended, TODAY).endedYear).toBeNull();
    expect(
      airingLine({ status: 'Returning Series', year: 2009 }, ended, TODAY).endedYear,
    ).toBeNull();
  });

  it('names the next episode’s date while it is ahead, today included', () => {
    const next = (airDate: string | null) =>
      airingLine(
        { status: 'Returning Series', year: 2020 },
        airing({ next: { season: 3, number: 1, airDate } }),
        TODAY,
      ).nextAirDate;
    expect(next('2026-10-15')).toBe('2026-10-15');
    expect(next(TODAY)).toBe(TODAY);
    expect(next('2026-09-21')).toBeNull();
    expect(next(null)).toBeNull();
  });

  it('states the fetch date unless the claim was fetched today', () => {
    const line = (fetchedAt: string) =>
      airingLine(
        { status: 'Returning Series', year: 2020 },
        airing({ next: { season: 3, number: 1, airDate: '2026-10-15' }, fetchedAt }),
        TODAY,
      ).asOf;
    expect(line('2026-09-22T01:00:00+00:00')).toBeNull();
    expect(line('2026-09-21T23:00:00+00:00')).toBe('2026-09-21');
  });

  it('has no fetch date to state when there is no next episode to claim', () => {
    expect(
      airingLine(
        { status: 'Ended', year: 2009 },
        airing({ fetchedAt: '2026-01-01T00:00:00+00:00' }),
        TODAY,
      ).asOf,
    ).toBeNull();
  });
});
