import type { WatchMoment } from '../api/titles.ts';
import { Section } from './Section.tsx';

const DAY_MS = 86_400_000;
const WINDOW_DAYS = 365;

/** A day the title was watched on, as a fraction along the window. */
interface Mark {
  day: string;
  left: number;
}

/**
 * Which days inside the window were watched on, and how much of the window the
 * events can actually speak for.
 *
 * Only dated plays at day precision or finer: a coarse entry holds the first
 * instant of its period, so plotting "2019" would put a mark on the 1st of
 * January that no one watched anything on.
 *
 * Days are bucketed in UTC, which for an exact play is not the viewer's day.
 * It decides only which plays collapse into one mark — the position comes from
 * the instant itself — so an evening play landing in tomorrow's bucket moves
 * nothing on screen. It would matter the moment the key were displayed.
 */
export function marksIn(moments: WatchMoment[], now: Date): { marks: Mark[]; startsAt: Date } {
  const startsAt = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);
  const span = now.getTime() - startsAt.getTime();
  const days = new Map<string, number>();

  for (const moment of moments) {
    if (moment.watchedAt === null) continue;
    if (moment.precision !== 'exact' && moment.precision !== 'day') continue;

    const at = Date.parse(moment.watchedAt);
    if (Number.isNaN(at) || at < startsAt.getTime() || at > now.getTime()) continue;

    const day = new Date(at).toISOString().slice(0, 10);
    if (!days.has(day)) days.set(day, (at - startsAt.getTime()) / span);
  }

  return {
    marks: [...days.entries()].map(([day, left]) => ({ day, left })),
    startsAt,
  };
}

const monthLabel = (at: Date, withYear: boolean) =>
  new Intl.DateTimeFormat(undefined, {
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  }).format(at);

/**
 * A year of this title at a glance: where the watching clustered, and how long
 * the quiet stretches were.
 *
 * Nothing at all when no play inside the window carries a usable date — an
 * empty rule under a heading says less than no rule.
 */
export function YearBar({
  moments,
  now = new Date(),
  truncated = false,
}: {
  moments: WatchMoment[];
  now?: Date;
  truncated?: boolean;
}) {
  const { marks, startsAt } = marksIn(moments, now);
  if (marks.length === 0) return null;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((at) => {
    const date = new Date(startsAt.getTime() + at * WINDOW_DAYS * DAY_MS);
    // Year on the ends only, which is where it tells you something.
    return { at, label: monthLabel(date, at === 0 || at === 1) };
  });

  return (
    <Section
      heading="When you watched it"
      // The API caps how many plays it sends, so a long enough binge loses its
      // older months. Said rather than drawn as a shorter year.
      aside={truncated ? 'recent plays only' : undefined}
    >
      <div>
        <div className="relative h-6.5 border border-line bg-surf">
          {marks.map((mark) => (
            <span
              key={mark.day}
              title={mark.day}
              className="absolute top-1.5 bottom-1.5 w-0.5 bg-jade"
              // Pulled back by its own offset so a mark at the end of the
              // window sits inside the bar rather than starting at its edge.
              style={{ left: `${mark.left * 100}%`, transform: `translateX(-${mark.left * 100}%)` }}
            />
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[7.5px] tracking-[.06em] text-faint uppercase">
          {ticks.map((tick) => (
            <span key={tick.at}>{tick.label}</span>
          ))}
        </div>
      </div>
    </Section>
  );
}
