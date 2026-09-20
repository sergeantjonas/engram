import type { WatchMoment } from '../api/titles.ts';
import { formatMoment } from './format.ts';
import { Section } from './Section.tsx';

/** How many plays the feed shows. The heading says how many there are. */
const SHOWN = 5;

const episodeLabel = (moment: WatchMoment) =>
  moment.season === null || moment.number === null ? null : `S${moment.season}E${moment.number}`;

/**
 * The last few plays, as they happened.
 *
 * The figures above say what the record adds up to; this says what it is made
 * of. A rewatch is called out because it is the one thing the grid above
 * cannot show — a cell is seen or it is not, however many times.
 */
export function Activity({
  moments,
  plays,
  titleName,
}: {
  moments: WatchMoment[];
  plays: number;
  /** What a play with no episode is called — a film's events name none. */
  titleName: string;
}) {
  if (moments.length === 0) return null;

  return (
    <Section heading="Activity" aside={`last ${Math.min(SHOWN, moments.length)} of ${plays}`}>
      <ul className="border-t border-line">
        {moments.slice(0, SHOWN).map((moment) => {
          const episode = episodeLabel(moment);
          return (
            <li
              key={moment.id}
              className="flex items-baseline gap-2.5 border-b border-line py-1.5 text-xs"
            >
              <time
                dateTime={moment.watchedAt ?? undefined}
                className="w-24 flex-none font-mono text-[8.5px] text-faint"
              >
                {formatMoment(moment.watchedAt, moment.precision)}
              </time>
              {episode === null ? null : (
                <span className="flex-none font-mono text-[10px] text-dim">{episode}</span>
              )}
              <span className="min-w-0 flex-1 truncate">{moment.name ?? titleName}</span>
              {moment.rewatch ? (
                <span className="flex-none font-mono text-[9px] tracking-[.06em] text-gold">
                  rewatch
                </span>
              ) : null}
              {/* Only the hand-entered ones are marked. Plex is where almost
                  everything comes from, so saying so on every line would be
                  noise; a row someone typed is worth knowing about. */}
              {moment.source === 'manual' ? (
                <span className="flex-none font-mono text-[9px] tracking-[.06em] text-jade">
                  by hand
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
