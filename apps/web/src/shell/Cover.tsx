import { coverGradient } from './cover.ts';

/**
 * What stands in for a poster TMDB does not have: the name on a gradient of
 * its own, the mockup's generated cover.
 *
 * Hidden from a screen reader, like the poster it replaces — the name is always
 * said beside it. `bare` drops the name where the thumbnail is too small to
 * hold it legibly; the caller sizes it and sets the name's size.
 */
export function Cover({
  name,
  bare = false,
  className = '',
}: {
  name: string;
  bare?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      style={{ backgroundImage: coverGradient(name) }}
      className={`grid place-items-center overflow-hidden text-center leading-tight font-semibold text-tx ${className}`}
    >
      {bare ? null : <span className="line-clamp-4">{name}</span>}
    </span>
  );
}
