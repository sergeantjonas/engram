import type { SeasonGrid as Season } from '../api/titles.ts';
import { useIsOwner } from '../auth/useIsOwner.ts';
import { EpisodeCell } from './EpisodeCell.tsx';

export function SeasonGrid({ season, titleId }: { season: Season; titleId: string }) {
  // Asked once per season rather than once per cell: ONE PIECE is 1100
  // episodes, and that many subscriptions to the same query is a thousand
  // observers doing the same bookkeeping for one answer.
  const isOwner = useIsOwner();
  const seen = season.episodes.filter((episode) => episode.seen).length;
  const heading = season.season === 0 ? 'Specials' : `Season ${season.season}`;
  // Fixed 34×28 cells that wrap, not a grid that stretches to the container.
  // A season is a shape to be read at a glance — where the run breaks, how far
  // it got — and cells that grow to fill the width turn that shape into a row
  // of buttons whose meaning changes with the window.
  const grid = (
    <ul className="flex flex-wrap gap-1">
      {season.episodes.map((episode) => (
        <li key={episode.id}>
          <EpisodeCell episode={episode} titleId={titleId} isOwner={isOwner} />
        </li>
      ))}
    </ul>
  );

  // Specials are outside the fraction on the wall, so they are folded here
  // too: an OVA that was never played should not read as a hole in the run.
  if (season.season === 0) {
    return (
      <details className="space-y-1.5">
        <summary className="cursor-pointer font-mono text-[9.5px] tracking-[.08em] text-dim">
          {heading} · {seen} of {season.episodes.length}
        </summary>
        {grid}
      </details>
    );
  }

  return (
    <section aria-label={heading} className="space-y-1.5">
      {/* Under the page's Episodes heading, not beside it. */}
      <h3 className="font-mono text-[9.5px] tracking-[.08em] text-dim">
        {heading} · {seen} of {season.episodes.length}
      </h3>
      {grid}
    </section>
  );
}
