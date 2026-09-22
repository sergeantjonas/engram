import { describe, expect, it } from 'vitest';
import type { EpisodeCell } from '../api/titles.ts';
import { seasonFacts } from './season-facts.ts';

const TODAY = '2026-09-22';

const episode = (over: Partial<EpisodeCell> = {}): EpisodeCell => ({
  id: crypto.randomUUID(),
  number: 1,
  name: null,
  airDate: '2019-04-01',
  runtimeMin: null,
  overview: null,
  stillPath: null,
  seen: false,
  playCount: 0,
  manualPlays: 0,
  firstWatchedAt: null,
  firstWatchedPrecision: null,
  lastWatchedAt: null,
  lastWatchedPrecision: null,
  unmatched: false,
  gap: null,
  ...over,
});

const seen = (over: Partial<EpisodeCell> = {}) => episode({ seen: true, ...over });

describe('seasonFacts', () => {
  it('prints a year once and a span as a range', () => {
    expect(seasonFacts([seen(), seen()], TODAY).years).toBe('2019');
    expect(
      seasonFacts([seen({ airDate: '2020-01-10' }), seen(), seen({ airDate: '2019-12-20' })], TODAY)
        .years,
    ).toBe('2019–2020');
  });

  it('prints no range when nothing is dated, and ignores undated cells otherwise', () => {
    expect(seasonFacts([seen({ airDate: null })], TODAY).years).toBeNull();
    expect(seasonFacts([seen({ airDate: null }), seen()], TODAY).years).toBe('2019');
  });

  it('counts every cell and says nothing about a season fully seen', () => {
    const facts = seasonFacts([seen(), seen(), seen()], TODAY);
    expect(facts.count).toBe(3);
    expect(facts.seen).toBe(3);
    expect(facts.state).toBeNull();
  });

  it('names one hole and counts more', () => {
    expect(seasonFacts([seen(), episode()], TODAY).state).toBe('one missing');
    expect(seasonFacts([seen(), episode(), episode(), episode()], TODAY).state).toBe('3 missing');
  });

  it('says none seen when the run has holes and no seen cell', () => {
    expect(seasonFacts([episode(), episode()], TODAY).state).toBe('none seen');
  });

  it('counts a declared skip as a hole: it is still not seen', () => {
    expect(
      seasonFacts([seen(), episode({ gap: { reason: 'skipped', note: null } })], TODAY),
    ).toMatchObject({ holes: 1, state: 'one missing' });
  });

  it('does not count what has not aired or is not on TMDB as a hole', () => {
    const facts = seasonFacts(
      [seen(), episode({ airDate: '2027-01-01' }), episode({ unmatched: true })],
      TODAY,
    );
    expect(facts).toMatchObject({ count: 3, seen: 1, holes: 0, state: null });
  });

  it('has nothing to say about a season none of which has aired', () => {
    expect(seasonFacts([episode({ airDate: '2027-01-01' })], TODAY).state).toBeNull();
  });
});
