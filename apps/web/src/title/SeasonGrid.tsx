import type { SeasonGrid as Season } from '../api/titles.ts';
import { EpisodeCell } from './EpisodeCell.tsx';

export function SeasonGrid({ season, titleId }: { season: Season; titleId: string }) {
  const seen = season.episodes.filter((episode) => episode.seen).length;
  const heading = season.season === 0 ? 'Specials' : `Season ${season.season}`;
  const grid = (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))] gap-1.5">
      {season.episodes.map((episode) => (
        <li key={episode.id} className="contents">
          <EpisodeCell episode={episode} titleId={titleId} />
        </li>
      ))}
    </ul>
  );

  // Specials are outside the fraction on the wall, so they are folded here
  // too: an OVA that was never played should not read as a hole in the run.
  if (season.season === 0) {
    return (
      <details className="space-y-3">
        <summary className="cursor-pointer text-sm text-neutral-400">
          {heading} · {seen} of {season.episodes.length}
        </summary>
        {grid}
      </details>
    );
  }

  return (
    <section aria-label={heading} className="space-y-3">
      <h2 className="text-sm font-medium">
        {heading}{' '}
        <span className="font-normal text-neutral-400">
          · {seen} of {season.episodes.length}
        </span>
      </h2>
      {grid}
    </section>
  );
}
