import { describe, expect, it } from 'vitest';
import { stepAcross, stepAlong } from './walk.ts';

const numbers = [4, 5, 6, 7];

describe('stepAlong', () => {
  it('steps along the season and stops at the ends rather than wrapping', () => {
    expect(stepAlong(numbers, 5, 'ArrowRight')).toBe(6);
    expect(stepAlong(numbers, 5, 'ArrowLeft')).toBe(4);
    expect(stepAlong(numbers, 7, 'ArrowRight')).toBe(7);
    expect(stepAlong(numbers, 4, 'ArrowLeft')).toBe(4);
  });

  it('jumps to either end', () => {
    expect(stepAlong(numbers, 6, 'Home')).toBe(4);
    expect(stepAlong(numbers, 4, 'End')).toBe(7);
  });

  it('answers null for a key that is not a walk, or a cell not in the season', () => {
    expect(stepAlong(numbers, 5, 'Enter')).toBeNull();
    expect(stepAlong(numbers, 99, 'ArrowRight')).toBeNull();
  });
});

describe('stepAcross', () => {
  // Two lines of three and two: the layout is read off the cells' offsets, and
  // the target is the nearest cell on the adjacent line by horizontal position.
  const cell = (offsetTop: number, offsetLeft: number) =>
    ({ offsetTop, offsetLeft }) as HTMLElement;
  const cells = [cell(0, 0), cell(0, 38), cell(0, 76), cell(32, 0), cell(32, 38)];

  it('goes to the nearest cell on the line below or above', () => {
    expect(stepAcross(cells, cells[2] as HTMLElement, 'ArrowDown')).toBe(cells[4]);
    expect(stepAcross(cells, cells[3] as HTMLElement, 'ArrowUp')).toBe(cells[0]);
  });

  it('answers null at the top and bottom, and for a key that is not vertical', () => {
    expect(stepAcross(cells, cells[0] as HTMLElement, 'ArrowUp')).toBeNull();
    expect(stepAcross(cells, cells[4] as HTMLElement, 'ArrowDown')).toBeNull();
    expect(stepAcross(cells, cells[0] as HTMLElement, 'ArrowRight')).toBeNull();
  });
});
