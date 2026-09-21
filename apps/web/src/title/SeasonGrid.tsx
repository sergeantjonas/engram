import type { SeasonGrid as Season } from '../api/titles.ts';
import { useIsOwner } from '../auth/useIsOwner.ts';
import { EpisodeCell } from './EpisodeCell.tsx';
import { MarkWatchedButton } from './MarkWatched.tsx';

const HEADING = 'font-mono text-[9.5px] tracking-[.08em] text-dim';

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
          <EpisodeCell
            episode={episode}
            season={season.season}
            titleId={titleId}
            isOwner={isOwner}
          />
        </li>
      ))}
    </ul>
  );

  // Backfilling a decade of television one cell at a time is how a feature
  // like this quietly never gets used, so the season is the unit. The season
  // is named in the label rather than left to the heading beside it: a page of
  // seasons is otherwise a page of identical buttons to anything not reading
  // in two dimensions.
  const markSeason = isOwner ? (
    <MarkWatchedButton
      titleId={titleId}
      scope={{ season: season.season }}
      label={`mark ${heading.toLowerCase()} watched`}
      name={`Mark ${heading.toLowerCase()} watched`}
      complete={seen === season.episodes.length}
      className="font-mono text-[9.5px] tracking-[.08em] text-faint underline-offset-4 hover:text-jade hover:underline"
    />
  ) : null;

  // Specials are outside the fraction on the wall, so they are folded here
  // too: an OVA that was never played should not read as a hole in the run.
  if (season.season === 0) {
    return (
      <details className="space-y-1.5">
        <summary className={HEADING}>
          {heading} · {seen} of {season.episodes.length}
        </summary>
        {/* Under the summary rather than beside it: a button inside a
            `summary` is a control that also toggles the disclosure. */}
        {markSeason}
        {grid}
      </details>
    );
  }

  return (
    <section aria-label={heading} className="space-y-1.5">
      <div className="flex items-baseline gap-3">
        {/* Under the page's Episodes heading, not beside it. */}
        <h3 className={HEADING}>
          {heading} · {seen} of {season.episodes.length}
        </h3>
        {markSeason}
      </div>
      {grid}
    </section>
  );
}
