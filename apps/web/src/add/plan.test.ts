import { describe, expect, it } from 'vitest';
import type { AddedSeason } from '../api/titles.ts';
import {
  type BatchEntry,
  batchClauses,
  describeBatch,
  describePlan,
  markable,
  planBatch,
  planFilm,
  planSeasons,
} from './plan.ts';

const seasons: AddedSeason[] = [
  { season: 0, episodeCount: 12 },
  { season: 1, episodeCount: 8 },
  { season: 2, episodeCount: 10 },
];

const plan = (chosen: number[], when = '') => planSeasons(seasons, new Set(chosen), when);

describe('planSeasons', () => {
  it('counts the episodes the chosen seasons hold', () => {
    expect(plan([1]).writes).toBe(8);
    expect(plan([1, 2]).writes).toBe(18);
    expect(plan([]).writes).toBe(0);
  });

  it('asks for one season at a time when only some are chosen', () => {
    expect(plan([2]).scopes).toEqual([{ season: 2 }]);
  });

  // Exactly what a whole-title mark covers, so it goes as one request.
  it('collapses every regular season into a single whole-title mark', () => {
    expect(plan([1, 2]).scopes).toEqual(['all']);
  });

  // `all` steps over season 0, so a selection including it is not that mark.
  it('does not collapse when the specials are chosen too', () => {
    expect(plan([0, 1, 2]).scopes).toEqual([{ season: 0 }, { season: 1 }, { season: 2 }]);
  });

  it('keeps the specials addressable on their own', () => {
    expect(plan([0]).scopes).toEqual([{ season: 0 }]);
    expect(plan([0]).writes).toBe(12);
  });

  // A whole-title mark over a title holding only specials is one the API
  // refuses outright, so it must never be what this asks for.
  it('never collapses a title that is nothing but specials', () => {
    const only = [{ season: 0, episodeCount: 3 }];
    expect(planSeasons(only, new Set([0]), '').scopes).toEqual([{ season: 0 }]);
  });

  it('asks for nothing when there is nothing on record to ask about', () => {
    expect(planSeasons([], new Set([1]), '').scopes).toEqual([]);
    expect(planSeasons([], new Set([1]), '').writes).toBe(0);
  });

  // The precision the API will store, read here with the API's own function so
  // the bar cannot describe a write that is not the one about to happen.
  it('reads the precision off the shape of the date', () => {
    expect(plan([1], '2019').precision).toBe('year');
    expect(plan([1], '2019-06').precision).toBe('month');
    expect(plan([1], '2019-06-14').precision).toBe('day');
    expect(plan([1], '').precision).toBe('unknown');
  });

  it('reports a date it cannot read rather than falling back to undated', () => {
    expect(plan([1], 'summer 2019').precision).toBeNull();
    expect(plan([1], '2019-02-30').precision).toBeNull();
  });
});

describe('planFilm', () => {
  it('marks the whole title, which is all a film has', () => {
    expect(planFilm(true, '2019')).toEqual({ scopes: ['all'], writes: 1, precision: 'year' });
  });

  it('asks for nothing when it was not seen', () => {
    expect(planFilm(false, '').scopes).toEqual([]);
  });
});

describe('describePlan', () => {
  it('states the whole write before it happens', () => {
    expect(describePlan(plan([1, 2], '2019'), 'episode')).toBe(
      'writes 18 episodes · source manual · precision year · presence not on disk',
    );
  });

  it('says when the date is what stands in the way', () => {
    expect(describePlan(plan([1], 'summer 2019'), 'episode')).toContain('precision unreadable');
  });

  it('counts a film in plays, which is the only thing it can write', () => {
    expect(describePlan(planFilm(true, ''), 'play')).toContain('writes 1 play ·');
  });
});

const film = (id: string, name = id): BatchEntry => ({
  added: { title: { id, name }, seasons: [] },
  kind: 'movie',
});

const show = (id: string, seasons: AddedSeason[]): BatchEntry => ({
  added: { title: { id, name: id }, seasons },
  kind: 'show',
});

const batch = (entries: BatchEntry[], chosen: string[], when = '') =>
  planBatch(entries, new Set(chosen), when);

describe('planBatch', () => {
  it('asks for one whole-title mark per ticked title, in the order listed', () => {
    const entries = [film('a'), film('b'), film('c')];

    expect(batch(entries, ['c', 'a']).marks).toEqual([
      { titleId: 'a', name: 'a' },
      { titleId: 'c', name: 'c' },
    ]);
  });

  it('counts a film as a play and a show as its regular episodes', () => {
    const plan = batch([film('a'), show('b', seasons)], ['a', 'b']);

    expect(plan.plays).toBe(1);
    // The specials are left out, because a whole-title mark steps over them.
    expect(plan.episodes).toBe(18);
  });

  // A whole-title mark over a title holding only specials is one the API
  // refuses outright, so it must never be what this asks for.
  it('leaves out a show that has nothing but specials', () => {
    const only = show('a', [{ season: 0, episodeCount: 3 }]);

    expect(markable(only)).toBe(false);
    expect(batch([only], ['a']).marks).toEqual([]);
  });

  it('reads the precision off the shape of the shared date', () => {
    expect(batch([film('a')], ['a'], '2019').precision).toBe('year');
    expect(batch([film('a')], ['a'], 'summer 2019').precision).toBeNull();
  });
});

describe('describeBatch', () => {
  it('names both kinds of row when the selection holds both', () => {
    expect(describeBatch(batch([film('a'), show('b', seasons)], ['a', 'b'], '2019'))).toBe(
      'writes 18 episodes and 1 play · source manual · precision year · presence not on disk',
    );
  });

  it('reads like the single-title bar when only one kind is ticked', () => {
    expect(describeBatch(batch([film('a'), film('b')], ['a', 'b'], ''))).toBe(
      'writes 2 plays · source manual · precision unknown · presence not on disk',
    );
  });

  it('says nothing is written when nothing is ticked', () => {
    expect(describeBatch(batch([film('a')], []))).toContain('writes nothing ·');
  });
});

describe('batchClauses', () => {
  // The bar sets what the write carries apart from the words around it, and a
  // date it cannot read is stated without being one of those values.
  it('does not count an unreadable date among the values the write carries', () => {
    const clauses = batchClauses(batch([film('a')], ['a'], 'summer 2019'));

    expect(clauses.find((clause) => clause.label === 'precision')).toEqual({
      label: 'precision',
      value: 'unreadable',
      carried: false,
    });
    expect(clauses.filter((clause) => !clause.carried)).toHaveLength(1);
  });
});
