import { Link } from '@tanstack/react-router';
import { posterUrl, type TitleState, type TitleSummary } from '../api/titles.ts';
import { Tip } from '../shell/Tooltip.tsx';
import { formatSince } from '../title/format.ts';
import type { KindFilter } from './facets.ts';

export const STATE_LABEL: Record<TitleState, string> = {
  unwatched: 'Unwatched',
  in_progress: 'In progress',
  seen: 'Seen',
};

/**
 * State is a bar under the poster rather than a badge over it, so the artwork
 * is never covered. It carries no text: the link's `aria-label` is what states
 * the title's state, and it has to keep doing so for as long as this is colour.
 */
export const STATE_BAR: Record<TitleState, string> = {
  unwatched: 'bg-line',
  in_progress: 'bg-gold',
  seen: 'bg-jade',
};

/**
 * A run's bar is how far through it the viewer is: jade for the share seen
 * over the empty bar's line, so 8 of 424 and 400 of 424 do not read alike.
 * Finished is full whatever the count says, and the ends are held for the
 * rest: a run begun is never narrower than a sliver and one not finished never
 * quite full, or one episode in would pass for none and one short for done. A
 * film has no share to draw and keeps the one colour, and so does a run with
 * no episodes stored.
 */
function StateBar({ title }: { title: TitleSummary }) {
  const { seen, total } = title.episodes;
  if (title.kind === 'movie' || total === 0) {
    return <span className={`block h-[3px] ${STATE_BAR[title.state]}`} />;
  }
  const share = title.state === 'seen' ? 100 : (seen / total) * 100;
  return (
    <span className="block h-[3px] bg-line">
      {title.state === 'unwatched' ? null : (
        <span
          className={`block h-full bg-jade ${title.state === 'seen' ? '' : 'min-w-0.5 max-w-[calc(100%-3px)]'}`}
          style={{ width: `${share}%` }}
        />
      )}
    </span>
  );
}

/** What the bar draws, for anything reading the link rather than looking at it. */
const progressLabel = (title: TitleSummary) =>
  title.kind === 'show' && title.state === 'in_progress' && title.episodes.total > 0
    ? `, ${title.episodes.seen} of ${title.episodes.total} episodes`
    : '';

/**
 * "Demon Slayer: Kimetsu no Yaiba Infinity Castle" under a 118px tile is a
 * wall of type. The part before the colon identifies it; the rest is on hover
 * and on the title page.
 */
const shortTitle = (name: string) => name.split(':')[0]?.trim() ?? name;

export function TitleCard({ title, kind }: { title: TitleSummary; kind: KindFilter | undefined }) {
  const poster = posterUrl(title.posterPath);
  const since = formatSince(title.lastWatchedAt, title.lastWatchedPrecision);
  const flags = [
    title.want ? 'want' : null,
    title.dropped ? 'dropped' : null,
    title.excluded ? 'excluded' : null,
  ].filter((flag) => flag !== null);

  return (
    <article>
      <Link
        to="/titles/$id"
        params={{ id: title.id }}
        // The pane on the other side opens on what the wall was showing,
        // rather than widening back out the moment a title is opened.
        search={kind ? { kind } : {}}
        aria-label={`${title.name}, ${STATE_LABEL[title.state]}${progressLabel(title)}`}
        className="block rounded-t hover:ring-2 hover:ring-dim"
      >
        <div
          // Greyscaled rather than badged: a title whose files are gone should
          // read as faded from the shelf at a glance across the whole wall.
          className={`aspect-2/3 overflow-hidden rounded-t bg-surf ${
            title.onDisk === false ? 'brightness-[.45] grayscale' : ''
          }`}
        >
          {poster ? (
            // Decorative: the heading below carries the name for a screen
            // reader, and repeating it here would read every card twice.
            <img src={poster} alt="" loading="lazy" className="size-full object-cover" />
          ) : (
            <span className="flex size-full items-center justify-center p-3 text-center text-xs text-faint">
              {title.name}
            </span>
          )}
        </div>
        <StateBar title={title} />
      </Link>
      {/* Two lines' worth of height whether the name needs it or not, so a row
          of one-line names does not sit ragged against its two-line neighbour. */}
      <div className="mt-1.5 flex min-h-[30px] items-start justify-between gap-2">
        {/* Mouse-only, and deliberately: the heading is not focusable and
            three hundred cards must not add three hundred tab stops. Anything
            reading the page rather than looking at it gets the whole name off
            the link above, which carries it in full. */}
        <Tip label={title.name}>
          <h2 className="line-clamp-2 text-xs leading-tight font-medium">
            {shortTitle(title.name)}
          </h2>
        </Tip>
        {since ? <span className="shrink-0 font-mono text-[10px] text-dim">{since}</span> : null}
      </div>
      {flags.length > 0 ? (
        <p className="mt-0.5 font-mono text-[10px] text-faint">{flags.join(' · ')}</p>
      ) : null}
    </article>
  );
}
