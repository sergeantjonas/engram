import { describe, expect, it } from 'vitest';
import { coverGradient, coverHue } from './cover.ts';

describe('coverHue', () => {
  it('gives a name the same hue every time, inside the circle', () => {
    const hue = coverHue('John Wick: Chapter 2');
    expect(coverHue('John Wick: Chapter 2')).toBe(hue);
    expect(hue).toBeGreaterThanOrEqual(0);
    expect(hue).toBeLessThan(360);
  });

  it('sets names that share a stem apart, a sequel’s number included', () => {
    const apart = (a: string, b: string) => {
      const turn = Math.abs(coverHue(a) - coverHue(b));
      return Math.min(turn, 360 - turn);
    };
    // Side by side on a wall or in a collection, two covers a few degrees
    // apart would read as one colour.
    for (const [a, b] of [
      ['Dune', 'Dune: Part Two'],
      ['Toy Story 2', 'Toy Story 4'],
      ['Deadpool', 'Deadpool 2'],
      ['John Wick: Chapter 3 - Parabellum', 'John Wick: Chapter 4'],
    ] as const) {
      expect(apart(a, b)).toBeGreaterThanOrEqual(20);
    }
  });
});

describe('coverGradient', () => {
  it('falls from a mid tone to a near-black of the name’s one hue', () => {
    const hue = coverHue('Better Call Saul');
    expect(coverGradient('Better Call Saul')).toBe(
      `linear-gradient(160deg, oklch(0.42 0.06 ${hue}), oklch(0.25 0.035 ${hue}))`,
    );
  });
});
