import { describe, expect, it } from 'vitest';
import type { TitleState, TitleSummary } from '../api/titles.ts';
import { groupedTitles, topOfList } from './order.ts';

const title = (over: Partial<TitleSummary> & { name: string }): TitleSummary => ({
  id: over.name,
  key: `show:tvdb:${over.name}`,
  kind: 'show',
  year: 2020,
  posterPath: null,
  state: 'unwatched' as TitleState,
  episodes: { total: 8, seen: 0 },
  want: false,
  dropped: false,
  excluded: false,
  onDisk: null,
  lastWatchedAt: null,
  lastWatchedPrecision: null,
  hasGap: false,
  manualOnly: false,
  ...over,
});

const shape = (titles: TitleSummary[]) =>
  groupedTitles(titles).map((group) => [group.label, group.titles.map((t) => t.name)]);

describe('groupedTitles', () => {
  // What is mid-run first, what has not been started next, what is done last.
  it('orders the groups by how much they are owed', () => {
    expect(
      shape([
        title({ name: 'done', state: 'seen' }),
        title({ name: 'new', state: 'unwatched' }),
        title({ name: 'going', state: 'in_progress' }),
      ]),
    ).toEqual([
      ['Still going', ['going']],
      ['Unwatched', ['new']],
      ['Finished', ['done']],
    ]);
  });

  it('leaves out a group with nothing in it, so no heading stands alone', () => {
    expect(shape([title({ name: 'going', state: 'in_progress' })])).toEqual([
      ['Still going', ['going']],
    ]);
    expect(shape([])).toEqual([]);
  });

  // An undated play is not news: sorting it beside last night's would put the
  // least current thing where the most current belongs.
  it('puts the most recent first and the undated last', () => {
    const rows = [
      title({ name: 'never', state: 'seen' }),
      title({ name: 'older', state: 'seen', lastWatchedAt: '2026-01-01T00:00:00.000Z' }),
      title({ name: 'newer', state: 'seen', lastWatchedAt: '2026-06-01T00:00:00.000Z' }),
    ];

    expect(shape(rows)).toEqual([['Finished', ['newer', 'older', 'never']]]);
  });

  it('breaks a tie by name rather than by whatever order it was handed', () => {
    const rows = [title({ name: 'beta', state: 'seen' }), title({ name: 'alpha', state: 'seen' })];

    expect(shape(rows)).toEqual([['Finished', ['alpha', 'beta']]]);
  });
});

describe('topOfList', () => {
  // The rail leads here, so it has to be the row the pane opens on.
  it('is the first row of the first group', () => {
    const rows = [
      title({ name: 'done', state: 'seen', lastWatchedAt: '2026-06-01T00:00:00.000Z' }),
      title({ name: 'going', state: 'in_progress' }),
    ];

    expect(topOfList(rows)?.name).toBe('going');
  });

  it('is nothing at all when the library is empty', () => {
    expect(topOfList([])).toBeUndefined();
  });
});
