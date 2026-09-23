import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ExternalIds, TitleDetail, TitleSummary } from '../api/titles.ts';
import { backdropUrl, posterUrl } from '../api/titles.ts';
import { STATE_LABEL } from '../wall/TitleCard.tsx';
import { airingLine } from './airing.ts';
import {
  formatAirDay,
  formatDuration,
  formatRuntime,
  formatSince,
  formatWatchedShort,
} from './format.ts';

/**
 * One cell of the stat box: the figure large in mono, its name small and
 * uppercase beneath.
 *
 * Boxed and ruled rather than run together as a sentence, because these are
 * readings off the record and the design treats them as an instrument panel.
 * The cells grow from a 104px basis, so a narrow window wraps them into rows
 * instead of shrinking the numbers.
 */
export function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex-[1_1_104px] border-r border-line px-3.5 py-2.5 last:border-r-0">
      <b className="block font-mono text-[17px] font-medium tracking-[-.02em] whitespace-nowrap tabular-nums">
        {value}
      </b>
      <span className="block whitespace-nowrap text-[9px] tracking-[.11em] text-faint uppercase">
        {label}
      </span>
    </div>
  );
}

/**
 * Whether the files are still there.
 *
 * Absent rather than "unknown" when nothing has reported: no Sonarr webhook
 * exists yet, so a null here means nobody has looked, and a pill saying so on
 * every title would be noise rather than news.
 */
function Presence({ onDisk }: { onDisk: boolean | null }) {
  if (onDisk === null) return null;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
        onDisk ? 'border-line text-dim' : 'border-drift text-drift'
      }`}
    >
      {onDisk ? 'On disk' : 'Not on disk'}
    </span>
  );
}

/**
 * What the title survives a redownload by, and the reason this project exists.
 *
 * Every id it has, named — a bare number says nothing about which catalogue it
 * belongs to, and TMDB numbers films and series in separate namespaces.
 */
function Identity({ ids, kind }: { ids: ExternalIds; kind: TitleSummary['kind'] }) {
  // Canonical first — tvdb for a show, tmdb for a film — because that is the
  // one the title is keyed by and the one that survives a redownload.
  const order =
    kind === 'show' ? (['tvdb', 'tmdb', 'imdb'] as const) : (['tmdb', 'tvdb', 'imdb'] as const);
  const linked = order.flatMap((source) => {
    const id = ids[source];
    return id === null ? [] : [{ source, id, href: cataloguePage(source, id, kind) }];
  });

  if (linked.length === 0) return null;
  return (
    <p className="font-mono text-[10px] text-faint">
      {linked.map(({ source, id, href }, index) => (
        <span key={source}>
          {index > 0 ? ' · ' : null}
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:text-dim hover:underline"
          >
            {source} {id}
          </a>
        </span>
      ))}
    </p>
  );
}

/**
 * The catalogue page an id names. TheTVDB's `?tab=movie&id=` answers with its
 * home page, so both kinds go through its dereferrer, which redirects to the
 * slugged page; TMDB numbers films and series apart, so the kind picks the path.
 */
function cataloguePage(source: keyof ExternalIds, id: string, kind: TitleSummary['kind']): string {
  switch (source) {
    case 'tvdb':
      return `https://thetvdb.com/dereferrer/${kind === 'show' ? 'series' : 'movie'}/${id}`;
    case 'tmdb':
      return `https://www.themoviedb.org/${kind === 'show' ? 'tv' : 'movie'}/${id}`;
    case 'imdb':
      return `https://www.imdb.com/title/${id}`;
  }
}

/**
 * What the title is, in TMDB's words, under what the record says about it.
 *
 * Clamped to two lines with a toggle that opens it in place, and the toggle
 * only where the clamp is actually hiding something: a "more" that reveals
 * nothing is a control that does nothing. Whether it hides anything is read
 * off the box rather than guessed from the length, so it follows the width.
 */
function Overview({ text }: { text: string | null }) {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  // Measured only while clamped, and before paint: open, the box fits its
  // text by definition, and a reading taken then would drop the "less" the
  // viewer is about to click. Re-running on collapse restores the clamp's
  // reading in the same frame, so the toggle never blinks out under focus.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || expanded || typeof ResizeObserver === 'undefined') return;
    const measure = () => setClipped(node.scrollHeight > node.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [expanded]);

  if (text === null) return null;
  return (
    <div className="mt-3 max-w-prose">
      <p ref={ref} id={id} className={`text-sm text-dim ${expanded ? '' : 'line-clamp-2'}`}>
        {text}
      </p>
      {clipped || expanded ? (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((value) => !value)}
          className="text-xs text-faint underline decoration-line underline-offset-2 hover:text-tx"
        >
          {expanded ? 'less' : 'more'}
        </button>
      ) : null}
    </div>
  );
}

export function TitleHeader({
  title,
  ids,
  backdropPath,
  overview,
  runtimeMin,
  director,
  cast,
  airing,
  figures,
  today,
}: Pick<
  TitleDetail,
  | 'title'
  | 'ids'
  | 'backdropPath'
  | 'overview'
  | 'runtimeMin'
  | 'director'
  | 'cast'
  | 'airing'
  | 'figures'
> & {
  /** Today as `YYYY-MM-DD`, the page's one clock. */
  today: string;
}) {
  const poster = posterUrl(title.posterPath);
  const backdrop = backdropUrl(backdropPath);
  const isShow = title.kind === 'show';
  const run = airingLine(title, airing, today);
  const { plays, rewatched, watchedMin, untimed, firstWatchedAt, firstWatchedPrecision } = figures;
  const { lastWatchedPrecision } = figures;

  const since = formatSince(figures.lastWatchedAt, lastWatchedPrecision);
  // A coarse entry formats as the period itself, not a duration, so "since
  // last" beside "2019" would read as nineteen years having passed.
  const sinceLabel =
    lastWatchedPrecision === 'exact' || lastWatchedPrecision === 'day'
      ? 'since last'
      : 'last watched';

  const figureCells = [
    plays > 0 ? { value: String(plays), label: plays === 1 ? 'play' : 'plays' } : null,
    // The total belongs to the Episodes heading below, which is where the run
    // itself is. A cell holds one figure.
    isShow && title.episodes.seen > 0
      ? { value: String(title.episodes.seen), label: 'episodes seen' }
      : null,
    rewatched > 0 ? { value: String(rewatched), label: 'rewatched' } : null,
    // A show's sum is a figure; a film's would only repeat the runtime the
    // meta line already states, beside a play count of one. A floor when some
    // of what was seen carries no runtime, and the label says so rather than
    // letting the figure pass for the whole.
    isShow && watchedMin > 0
      ? { value: formatDuration(watchedMin), label: untimed > 0 ? 'watched, at least' : 'watched' }
      : null,
    firstWatchedAt !== null
      ? { value: formatWatchedShort(firstWatchedAt, firstWatchedPrecision), label: 'first watched' }
      : null,
    since !== null ? { value: since, label: sinceLabel } : null,
  ].filter((cell) => cell !== null);

  return (
    <header>
      {/* The still is the page's ground, so it bleeds past the 18px the rest
          of the content is padded by and fades into the page rather than
          ending at an edge. Nothing but atmosphere sits on it — the name and
          everything else stay on the solid part below.

          The height grows with the width instead of holding the mockup's
          158px. A backdrop is 16:9, so a full-bleed band crops it to whatever
          fraction its height is of the scaled image: 158px was a third of it
          in an 800px frame and is a sixth in a 1700px window, which is a strip
          of the middle rather than a picture. Fifteen percent of the width
          keeps roughly the fraction the design was drawn at, floored so a
          narrow window still gets a band and capped so a wide one does not get
          a poster. */}
      {backdrop === null ? null : (
        <div
          aria-hidden="true"
          className="relative -mx-[18px] -mt-[18px] -mb-[46px] h-[clamp(158px,15vw,300px)] bg-cover bg-[center_28%] after:absolute after:inset-0 after:bg-gradient-to-t after:from-bg after:from-3% after:via-bg/55 after:via-60% after:to-bg/10"
          style={{ backgroundImage: `url(${backdrop})` }}
        />
      )}

      {/* Poster and name only, so what rises into the hero is a fixed height.
          With the stat box in this row its column would be the taller one, and
          the name would climb to wherever the figures happened to reach — over
          the part of the image the gradient has not finished covering. */}
      <div className="relative flex items-end gap-4">
        <div
          data-morph=""
          className="w-23 shrink-0 overflow-hidden bg-surf shadow-[0_8px_24px_rgba(0,0,0,.6)]"
        >
          {poster ? (
            <img src={poster} alt="" className="aspect-2/3 size-full object-cover" />
          ) : (
            <div className="aspect-2/3" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="space-y-2">
            <h1 className="text-2xl font-semibold">{title.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-dim">{title.year ?? '????'}</span>
              <span className="text-xs text-faint">·</span>
              <span className="text-xs text-dim">{isShow ? 'Series' : 'Film'}</span>
              {runtimeMin !== null ? (
                <>
                  <span className="text-xs text-faint">·</span>
                  <span className="font-mono text-xs text-dim">{formatRuntime(runtimeMin)}</span>
                </>
              ) : null}
              <span className="text-xs text-faint">·</span>
              <span className="text-xs text-dim">{STATE_LABEL[title.state]}</span>
              {/* Where the run stands, after where the record stands: a fact
                  about the show rather than about the viewer. */}
              {run.status !== null ? (
                <>
                  <span className="text-xs text-faint">·</span>
                  <span className="text-xs text-dim">
                    {run.status}
                    {run.endedYear !== null ? (
                      <>
                        {' '}
                        <span className="font-mono">{run.endedYear}</span>
                      </>
                    ) : null}
                  </span>
                </>
              ) : null}
              {run.nextAirDate !== null ? (
                <>
                  <span className="text-xs text-faint">·</span>
                  <span className="text-xs text-dim">
                    next <span className="font-mono">{formatAirDay(run.nextAirDate, today)}</span>
                  </span>
                  {run.asOf !== null ? (
                    <span className="text-xs text-faint">
                      as of <span className="font-mono">{formatAirDay(run.asOf, today)}</span>
                    </span>
                  ) : null}
                </>
              ) : null}
              <Presence onDisk={title.onDisk} />
            </div>
            <Identity ids={ids} kind={title.kind} />
          </div>
        </div>
      </div>

      {/* Below the poster row rather than beside the ids: the row's height is
          what keeps the name off the hero, and a synopsis that opens in place
          would push it up there. Keyed on the title because the route swaps
          `data` in place when the pane navigates, and one title's "more" must
          not arrive open on the next. */}
      <Overview key={title.id} text={overview} />

      {/* Who made it, in one line under what it is about. Names in the text
          colour, the joining words dim, so the line reads as names. */}
      {director !== null || cast.length > 0 ? (
        <p className="mt-2 text-xs text-dim">
          {director !== null ? (
            <>
              Directed by <span className="text-tx">{director}</span>
            </>
          ) : null}
          {director !== null && cast.length > 0 ? ' · ' : null}
          {cast.length > 0 ? (
            <>
              with <span className="text-tx">{cast.join(', ')}</span>
            </>
          ) : null}
        </p>
      ) : null}

      {/* Only the readings that exist, and no box at all when none do: an empty
          ruled strip under a title nobody has watched says less than nothing. */}
      {figureCells.length > 0 ? (
        <div className="mt-3 flex flex-wrap border border-line">
          {figureCells.map((cell) => (
            <Figure key={cell.label} value={cell.value} label={cell.label} />
          ))}
        </div>
      ) : null}

      {title.excluded ? <p className="mt-2 text-sm text-faint">Excluded from the wall.</p> : null}
    </header>
  );
}
