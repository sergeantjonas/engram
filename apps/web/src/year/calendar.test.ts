import { describe, expect, it } from 'vitest';
import { addDays, cellsOf, monthStarts, shadeOf, stepDay } from './calendar.ts';

describe('cellsOf', () => {
  it('lays a year out in week columns, Monday first', () => {
    // 1 January 2025 was a Wednesday.
    const cells = cellsOf(2025, '2026-06-01');

    expect(cells).toHaveLength(365);
    expect(cells[0]).toEqual({ day: '2025-01-01', week: 0, weekday: 2 });
    // The following Monday opens the second column.
    expect(cells[5]).toEqual({ day: '2025-01-06', week: 1, weekday: 0 });
    expect(cells.at(-1)).toEqual({ day: '2025-12-31', week: 52, weekday: 2 });
    expect(cellsOf(2024, '2026-06-01')).toHaveLength(366);
  });

  it('stops the running year at today, and draws nothing of one not begun', () => {
    expect(cellsOf(2026, '2026-03-02').at(-1)?.day).toBe('2026-03-02');
    expect(cellsOf(2027, '2026-03-02')).toEqual([]);
  });
});

describe('monthStarts', () => {
  it('names the column each month begins in', () => {
    const starts = monthStarts(cellsOf(2025, '2026-06-01'));

    expect(starts).toHaveLength(12);
    expect(starts[0]).toEqual({ month: 1, week: 0 });
    // 1 February 2025, a Saturday, sits in the fifth column.
    expect(starts[1]).toEqual({ month: 2, week: 4 });
  });
});

describe('stepDay', () => {
  const first = '2025-01-01';
  const last = '2025-12-31';

  it('walks days down a column and weeks along a row', () => {
    expect(stepDay('2025-06-14', 'ArrowDown', first, last)).toBe('2025-06-15');
    expect(stepDay('2025-06-14', 'ArrowUp', first, last)).toBe('2025-06-13');
    expect(stepDay('2025-06-14', 'ArrowRight', first, last)).toBe('2025-06-21');
    expect(stepDay('2025-06-14', 'ArrowLeft', first, last)).toBe('2025-06-07');
    expect(stepDay('2025-06-14', 'Home', first, last)).toBe(first);
    expect(stepDay('2025-06-14', 'End', first, last)).toBe(last);
  });

  it('holds at the year’s ends and ignores keys that are not a walk', () => {
    expect(stepDay('2025-12-28', 'ArrowRight', first, last)).toBe(last);
    expect(stepDay('2025-01-01', 'ArrowUp', first, last)).toBe(first);
    expect(stepDay('2025-06-14', 'Enter', first, last)).toBeNull();
  });
});

describe('addDays', () => {
  it('crosses months, years and a leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
    // A daylight-saving change is not a day that is 23 hours long here.
    expect(addDays('2025-03-29', 2)).toBe('2025-03-31');
  });
});

describe('shadeOf', () => {
  it('steps by fixed counts, so one bulk day cannot wash out the rest', () => {
    expect([0, 1, 2, 3, 4, 7, 8, 78].map(shadeOf)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
  });
});
