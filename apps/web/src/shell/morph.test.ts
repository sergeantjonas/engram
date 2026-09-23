import { describe, expect, it } from 'vitest';
import { markMorph } from './morph.ts';

describe('markMorph', () => {
  it('moves the mark rather than adding a second, which would abort the transition', () => {
    const first = document.createElement('div');
    const second = document.createElement('div');

    markMorph(first);
    markMorph(second);

    expect(first.hasAttribute('data-morph')).toBe(false);
    expect(second.hasAttribute('data-morph')).toBe(true);
    markMorph(null);
    expect(second.hasAttribute('data-morph')).toBe(false);
  });
});
