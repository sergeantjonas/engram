import { type KeyboardEvent, useRef, useState } from 'react';
import type { EpisodeCell as Episode, SeasonGrid as Season } from '../api/titles.ts';
import { useIsOwner } from '../auth/useIsOwner.ts';
import { EpisodeCell } from './EpisodeCell.tsx';
import { MarkWatchedButton } from './MarkWatched.tsx';
import { seasonFacts } from './season-facts.ts';
import { stepAcross, stepAlong } from './walk.ts';

const HEADING = 'font-mono text-[10px] tracking-[.08em] uppercase text-dim';

/** What TMDB gives no date for, gathered at the end rather than left loose. */
const UNDATED = '—';

const airYear = (episode: Episode) => episode.airDate?.slice(0, 4) ?? UNDATED;

/**
 * The years to break a season across, or nothing if it should stay one block.
 *
 * Counted on real years only. An episode TMDB has no date for must not be able
 * to split a season that otherwise ran inside a single year — that would be one
 * missing field turning a tidy grid into two labelled groups for no reason. It
 * does get a group of its own once the season is being broken up anyway, last,
 * because it belongs nowhere in the run.
 */
function airYears(episodes: Episode[]): string[] {
  const dated = [...new Set(episodes.map(airYear))].filter((year) => year !== UNDATED);
  if (dated.length < 2) return [];
  return episodes.some((episode) => episode.airDate === null) ? [...dated, UNDATED] : dated;
}

export function SeasonGrid({
  season,
  titleId,
  today,
}: {
  season: Season;
  titleId: string;
  /** Today as `YYYY-MM-DD`, so every cell on the page shares one clock. */
  today: string;
}) {
  // Asked once per season rather than once per cell: ONE PIECE is 1100
  // episodes, and that many subscriptions to the same query is a thousand
  // observers doing the same bookkeeping for one answer.
  const isOwner = useIsOwner();
  // One tab stop per season, not one per cell: ONE PIECE is 1100 buttons, and
  // a reader tabbing past it should pass it in one step. The active cell is
  // the season's tab stop and the arrows move it; a popover, once open, is
  // moved by the same keys to the neighbour rather than closed and reopened,
  // so reading a season is holding an arrow. Held here because a cell cannot
  // know its neighbours, and the open popover has to follow the focus.
  const [active, setActive] = useState<number | null>(null);
  const [opened, setOpened] = useState<number | null>(null);
  // Set while an open popover is being handed to the neighbour. The closing
  // panel would otherwise return focus to its own cell a tick later, and the
  // panel just opened would read that as focus leaving it and dismiss itself.
  const handing = useRef(false);
  const frame = useRef<HTMLElement | null>(null);
  // A callback rather than the object: the frame is a `section` for a season
  // and a `details` for the specials, and one ref object cannot be typed as both.
  const setFrame = (element: HTMLElement | null) => {
    frame.current = element;
  };
  const numbers = season.episodes.map((episode) => episode.number);
  const tabStop = active ?? numbers[0] ?? null;

  const walk = (from: number, event: KeyboardEvent) => {
    const cells = [...(frame.current?.querySelectorAll<HTMLElement>('[data-episode]') ?? [])];
    const here = cells.find((cell) => Number(cell.dataset.episode) === from);
    const across = here ? stepAcross(cells, here, event.key) : null;
    const to = across ? Number(across.dataset.episode) : stepAlong(numbers, from, event.key);
    if (to === null) return;
    // Swallowed even at the ends, or Home and End scroll the page; but there
    // is nothing to hand on, and a flag set now would block the next close.
    event.preventDefault();
    if (to === from) return;
    setActive(to);
    if (opened !== null) {
      handing.current = true;
      setOpened(to);
    } else {
      // Focus follows straight away rather than after a render: the key was
      // pressed on a button, and the next one is already in the document.
      cells.find((cell) => Number(cell.dataset.episode) === to)?.focus();
    }
  };

  const onCloseAutoFocus = (event: Event) => {
    if (!handing.current) return;
    event.preventDefault();
    handing.current = false;
  };

  const facts = seasonFacts(season.episodes, today);
  const { seen } = facts;
  const heading = season.season === 0 ? 'Specials' : `Season ${season.season}`;
  // Fixed 34×28 cells that wrap, not a grid that stretches to the container.
  // A season is a shape to be read at a glance — where the run breaks, how far
  // it got — and cells that grow to fill the width turn that shape into a row
  // of buttons whose meaning changes with the window.
  // Where a shift-click's range would start: after the last seen cell before
  // this one, or at the season's first. Computed over the whole season, not
  // the year row a cell is drawn in.
  const rangeStart = (episode: Episode): number => {
    const before = season.episodes.filter((e) => e.seen && e.number < episode.number);
    return before.length === 0
      ? (season.episodes[0]?.number ?? episode.number)
      : Math.max(...before.map((e) => e.number)) + 1;
  };
  const cells = (episodes: Episode[]) => (
    <ul className="flex flex-wrap gap-1">
      {episodes.map((episode) => (
        <li key={episode.id}>
          <EpisodeCell
            episode={episode}
            season={season.season}
            titleId={titleId}
            isOwner={isOwner}
            today={today}
            rangeFrom={rangeStart(episode)}
            tabStop={tabStop === episode.number}
            open={opened === episode.number}
            onOpenChange={(next) => {
              // A close only clears the cell that is open: a late dismissal
              // from the cell just left must not shut the one just opened.
              setOpened((current) =>
                next ? episode.number : current === episode.number ? null : current,
              );
              if (next) setActive(episode.number);
            }}
            onWalk={(event) => walk(episode.number, event)}
            onCloseAutoFocus={onCloseAutoFocus}
          />
        </li>
      ))}
    </ul>
  );

  // Broken up by the year each episode aired, but only where that tells the
  // viewer something: a season that ran across years has those years as its
  // landmarks, and one that did not has nothing to landmark. Bleach's season 1
  // is 366 identical cells otherwise, and "which episode is which" has no
  // answer short of clicking each one.
  const years = airYears(season.episodes);
  const grid =
    years.length === 0 ? (
      cells(season.episodes)
    ) : (
      <div className="space-y-1.5">
        {years.map((year) => (
          <div key={year} className="flex gap-2.5">
            <span className="w-8 shrink-0 pt-1.5 text-right font-mono text-[9px] text-faint">
              {year}
            </span>
            {cells(season.episodes.filter((episode) => airYear(episode) === year))}
          </div>
        ))}
      </div>
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
      what={heading.toLowerCase()}
      label={`mark ${heading.toLowerCase()} watched`}
      complete={seen === season.episodes.length}
      className="font-mono text-[10px] tracking-[.08em] text-faint underline-offset-4 hover:text-jade hover:underline"
    />
  ) : null;

  // Specials are outside the fraction on the wall, so they are folded here
  // too: an OVA that was never played should not read as a hole in the run.
  // The page also puts them last — see the order the seasons are drawn in.
  if (season.season === 0) {
    return (
      <details ref={setFrame} className="space-y-1.5">
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
    <section ref={setFrame} aria-label={heading} className="space-y-1.5">
      <div className="flex items-baseline gap-3">
        {/* Under the page's Episodes heading, not beside it. */}
        {/* Derived from the cells, since no season row exists to hold it: the
            years it aired across, its size, then only what is owed — a season
            with no hole in the run says nothing more. */}
        <h3 className={HEADING}>
          {[heading, facts.years, `${facts.count} ep`, facts.state]
            .filter((part) => part !== null)
            .join(' · ')}
        </h3>
        {markSeason}
      </div>
      {grid}
    </section>
  );
}
