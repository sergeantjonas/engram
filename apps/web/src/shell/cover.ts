/**
 * The hue a title's cover is drawn in, from its name alone: the same name draws
 * the same cover on every screen, and nothing has to be stored for it.
 *
 * FNV-1a over the UTF-16 code units, then murmur3's finaliser: FNV-1a alone
 * leaves a last character's weight in the low bits, so "Toy Story 2" and
 * "Toy Story 4" would land a couple of degrees apart, and the mix spreads it
 * before the circle takes its remainder.
 */
export function coverHue(name: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < name.length; index++) {
    hash ^= name.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return (hash >>> 0) % 360;
}

/**
 * The mockup's generated cover: a 160° fall from a mid tone to a near-black of
 * one hue. Low in chroma, so it sits with the artwork rather than with the
 * state colours, and the mid tone is dark enough that `--tx` on it clears 7:1
 * at every hue.
 */
export function coverGradient(name: string): string {
  const hue = coverHue(name);
  return `linear-gradient(160deg, oklch(0.42 0.06 ${hue}), oklch(0.25 0.035 ${hue}))`;
}
