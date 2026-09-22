import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ACTIVITY_PAGE, activityPage, type WatchMoment } from '../api/titles.ts';
import { formatMoment } from './format.ts';
import { Section } from './Section.tsx';

/** How many plays the feed shows before it is asked for the rest. The heading says how many there are. */
const SHOWN = 5;

const episodeLabel = (moment: WatchMoment) =>
  moment.season === null || moment.number === null ? null : `S${moment.season}E${moment.number}`;

/**
 * The plays, as they happened.
 *
 * The figures above say what the record adds up to; this says what it is made
 * of. A rewatch is called out because it is the one thing the grid above
 * cannot show — a cell is seen or it is not, however many times.
 *
 * Five to begin with, and the rest on request, in pages: the feed is the raw
 * evidence and the only view that names each event's source, so it has to be
 * reachable in full, and a title watched daily for years must not put all of
 * it on the page at once.
 */
export function Activity({
  titleId,
  moments,
  plays,
  titleName,
}: {
  titleId: string;
  /** The newest plays, as the detail carries them. */
  moments: WatchMoment[];
  /** How many there are in all, counted by the API over the same set. */
  plays: number;
  /** What a play with no episode is called — a film's events name none. */
  titleName: string;
}) {
  const [all, setAll] = useState(false);
  // Paged from the start rather than from where the detail's slice ends, so
  // the list is one query's answer and cannot double a play at the seam.
  const rest = useInfiniteQuery({
    // Under the title's own key, so a mark, which settles the title, refetches
    // the pages held here with it.
    queryKey: ['title', titleId, 'activity'],
    queryFn: ({ pageParam }) => activityPage(titleId, pageParam),
    initialPageParam: 0,
    // A short page is the end, and so is reaching the known total: a total
    // that is a round fifty would otherwise offer one more page of nothing.
    getNextPageParam: (last, pages) =>
      last.moments.length < ACTIVITY_PAGE || pages.length * ACTIVITY_PAGE >= plays
        ? undefined
        : pages.length * ACTIVITY_PAGE,
    enabled: all,
  });

  if (moments.length === 0) return null;

  // The five stay up until the first page has arrived: what is on screen is
  // decided by what has been answered, not by what was asked for.
  const paged = rest.data?.pages.flatMap((page) => page.moments);
  const shown = paged ?? moments.slice(0, SHOWN);
  const aside = paged
    ? `${Math.min(paged.length, plays)} of ${plays}`
    : `last ${Math.min(SHOWN, moments.length)} of ${plays}`;

  return (
    <Section heading="Activity" aside={aside}>
      <ul className="border-t border-line">
        {shown.map((moment) => (
          <Moment key={moment.id} moment={moment} titleName={titleName} />
        ))}
      </ul>
      {/* The way to the rest, only while there is a rest: a feed of five
          plays has nothing more to show, and a page that came back short is
          the end. */}
      {!all && plays > SHOWN ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="font-mono text-[10px] tracking-[.08em] text-faint underline-offset-4 hover:text-tx hover:underline"
        >
          show all {plays}
        </button>
      ) : null}
      {all && rest.hasNextPage ? (
        <button
          type="button"
          disabled={rest.isFetchingNextPage}
          onClick={() => void rest.fetchNextPage()}
          className="font-mono text-[10px] tracking-[.08em] text-faint underline-offset-4 hover:text-tx hover:underline disabled:opacity-50"
        >
          show {ACTIVITY_PAGE} more
        </button>
      ) : null}
      {rest.error ? (
        <p role="alert" className="text-xs text-gap-tx">
          {rest.error.message}{' '}
          <button
            type="button"
            onClick={() => void rest.refetch()}
            className="underline underline-offset-4 hover:text-tx"
          >
            try again
          </button>
        </p>
      ) : null}
    </Section>
  );
}

function Moment({ moment, titleName }: { moment: WatchMoment; titleName: string }) {
  const episode = episodeLabel(moment);
  return (
    <li className="flex items-baseline gap-2.5 border-b border-line py-1.5 text-xs">
      {/* Wide enough for an older date and its time on one line at 10px,
          the floor for anything read — `Nov 28, 2025 · 15:09` — in English
          and Dutch; French and German month names run longer and wrap. On a
          phone the name needs the width more, so there the time wraps. */}
      <time
        dateTime={moment.watchedAt ?? undefined}
        className="w-24 flex-none font-mono text-[10px] text-faint sm:w-36"
      >
        {formatMoment(moment.watchedAt, moment.precision)}
      </time>
      {episode === null ? null : (
        <span className="flex-none font-mono text-[10px] text-dim">{episode}</span>
      )}
      <span className="min-w-0 flex-1 truncate">{moment.name ?? titleName}</span>
      {moment.rewatch ? (
        <span className="flex-none font-mono text-[9px] tracking-[.06em] text-gold">rewatch</span>
      ) : null}
      {/* Only the hand-entered ones are marked. Plex is where almost
          everything comes from, so saying so on every line would be noise; a
          row someone typed is worth knowing about. */}
      {moment.source === 'manual' ? (
        <span className="flex-none font-mono text-[9px] tracking-[.06em] text-jade">by hand</span>
      ) : null}
    </li>
  );
}
