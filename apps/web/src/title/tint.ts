import { queryOptions } from '@tanstack/react-query';

/**
 * The title page takes a cast from its poster's colour, read here in the
 * browser rather than stored.
 *
 * Read from TMDB's smallest poster, not the one on the page. TMDB answers
 * with CORS headers only a request that sends an Origin, and does not vary its
 * cache on one, so a read of the drawn poster would be served the copy the
 * wall fetched without them, which a canvas refuses. A size nothing draws is
 * only ever fetched to be read.
 */
const readableUrl = (posterPath: string) => `https://image.tmdb.org/t/p/w92${posterPath}`;

/** Too dark, or too grey, to say anything about a poster's colour. */
const DARKEST = 40;
const GREYEST = 24;

/**
 * The lightest a tint may be, in OKLab. Mixed at 15% into `--surf`, a cream or
 * yellow poster would otherwise take the dim numbers on an unseen episode cell
 * to 4.1:1; at this cap the worst of any colour is 4.6:1, above AA.
 */
const LIGHTEST = 0.75;

const toLinear = (channel: number) => {
  const v = channel / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toChannel = (v: number) =>
  Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));

/**
 * Darkened to `LIGHTEST` when it is lighter, keeping its hue. Scaling linear
 * RGB by `f` scales every OKLab coordinate by the cube root of `f`, so one
 * factor lands the lightness exactly and leaves the hue where it was.
 */
function capped(r: number, g: number, b: number): [number, number, number] {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  if (lightness <= LIGHTEST) return [r, g, b];
  const f = (LIGHTEST / lightness) ** 3;
  return [toChannel(lr * f), toChannel(lg * f), toChannel(lb * f)];
}

/**
 * The poster's colour as `rgb(r g b)`, or null when it has none worth taking.
 *
 * Not the average, which for most posters is a brown: pixels are sorted into
 * coarse buckets, three bits a channel, each weighted by how vivid it is, and
 * the heaviest bucket's mean is the answer, darkened if it is too light to
 * sit under text. Black, white and grey carry no weight at all, so a poster
 * made of them gives null and the page is left as it is.
 */
export function dominantColour(pixels: ArrayLike<number>): string | null {
  const buckets = new Map<number, { r: number; g: number; b: number; weight: number }>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const r = pixels[i] ?? 0;
    const g = pixels[i + 1] ?? 0;
    const b = pixels[i + 2] ?? 0;
    if ((pixels[i + 3] ?? 0) < 128) continue;
    const max = Math.max(r, g, b);
    const chroma = max - Math.min(r, g, b);
    if (max < DARKEST || chroma < GREYEST) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, weight: 0 };
    bucket.r += r * chroma;
    bucket.g += g * chroma;
    bucket.b += b * chroma;
    bucket.weight += chroma;
    buckets.set(key, bucket);
  }
  let best: { r: number; g: number; b: number; weight: number } | undefined;
  for (const bucket of buckets.values()) {
    if (best === undefined || bucket.weight > best.weight) best = bucket;
  }
  if (best === undefined) return null;
  const { weight } = best;
  const [r, g, b] = capped(
    Math.round(best.r / weight),
    Math.round(best.g / weight),
    Math.round(best.b / weight),
  );
  return `rgb(${r} ${g} ${b})`;
}

async function readTint(posterPath: string): Promise<string | null> {
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = readableUrl(posterPath);
  await image.decode();
  // Half the smallest poster is still three thousand pixels, which is plenty
  // to find a colour in.
  const width = Math.max(1, Math.round(image.naturalWidth / 2));
  const height = Math.max(1, Math.round(image.naturalHeight / 2));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (context === null) return null;
  context.drawImage(image, 0, 0, width, height);
  return dominantColour(context.getImageData(0, 0, width, height).data);
}

/**
 * Kept for the session, since a poster's colour does not change. A read that
 * fails, from a network error or a refused canvas, is kept too, as no tint:
 * left as an error it would be read again on every visit and every hover.
 */
export const tintQuery = (posterPath: string | null) =>
  queryOptions({
    queryKey: ['tint', posterPath],
    queryFn: () => (posterPath === null ? null : readTint(posterPath).catch(() => null)),
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
