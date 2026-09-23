import { describe, expect, it } from 'vitest';
import { dominantColour } from './tint.ts';

/** RGBA pixels, `count` of each colour. */
const pixels = (...runs: Array<[count: number, rgba: [number, number, number, number]]>) =>
  runs.flatMap(([count, rgba]) => Array.from({ length: count }, () => rgba).flat());

describe('dominantColour', () => {
  it('takes the vivid colour over a larger dark and grey ground', () => {
    // Most posters: a lot of near-black, some grey type, one colour.
    const poster = pixels(
      [600, [12, 10, 9, 255]],
      [200, [128, 128, 128, 255]],
      [100, [200, 40, 30, 255]],
    );
    expect(dominantColour(poster)).toBe('rgb(200 40 30)');
  });

  it('weights a colour by how vivid it is, not only by how much of it there is', () => {
    const poster = pixels([300, [120, 100, 90, 255]], [200, [40, 110, 220, 255]]);
    expect(dominantColour(poster)).toBe('rgb(40 110 220)');
  });

  it('gives nothing for a poster with no colour in it', () => {
    const poster = pixels(
      [500, [8, 8, 8, 255]],
      [300, [240, 240, 240, 255]],
      [200, [90, 92, 95, 255]],
    );
    expect(dominantColour(poster)).toBeNull();
  });

  it('ignores what is too dark to show its colour', () => {
    expect(dominantColour(pixels([100, [35, 5, 5, 255]]))).toBeNull();
  });

  it('darkens a colour too light to sit under text, and keeps its hue', () => {
    // Cream, which mixed into a surface would take the dim type on it below AA.
    const cream = dominantColour(pixels([100, [250, 240, 200, 255]]));
    const [r = 0, g = 0, b = 0] = (cream?.match(/\d+/g) ?? []).map(Number);
    expect(r).toBeLessThan(250);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it('ignores what is transparent', () => {
    expect(dominantColour(pixels([100, [200, 40, 30, 0]]))).toBeNull();
  });
});
