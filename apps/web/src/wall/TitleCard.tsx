import { Link } from '@tanstack/react-router';
import { posterUrl, type TitleState, type TitleSummary } from '../api/titles.ts';

export const STATE_LABEL: Record<TitleState, string> = {
  unwatched: 'Unwatched',
  in_progress: 'In progress',
  seen: 'Seen',
};

const STATE_BADGE: Record<TitleState, string> = {
  unwatched: 'border border-line bg-raise text-tx',
  in_progress: 'bg-gold text-bg',
  seen: 'bg-jade text-on-jade',
};

export function TitleCard({ title }: { title: TitleSummary }) {
  const poster = posterUrl(title.posterPath);
  const flags = [
    title.want ? 'want' : null,
    title.dropped ? 'dropped' : null,
    title.excluded ? 'excluded' : null,
  ].filter((flag) => flag !== null);

  return (
    <article className="space-y-1.5">
      <Link
        to="/titles/$id"
        params={{ id: title.id }}
        aria-label={`${title.name}, ${STATE_LABEL[title.state]}`}
        className="relative block aspect-2/3 overflow-hidden rounded bg-surf hover:ring-2 hover:ring-dim"
      >
        {poster ? (
          // Decorative: the heading below carries the name for a screen reader,
          // and repeating it here would read every card twice.
          <img src={poster} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center p-3 text-center text-sm text-faint">
            {title.name}
          </span>
        )}
        <span
          className={`absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-xs font-medium ${STATE_BADGE[title.state]}`}
        >
          {STATE_LABEL[title.state]}
        </span>
      </Link>
      <h2 className="truncate text-sm font-medium" title={title.name}>
        {title.name}
      </h2>
      <p className="font-mono text-xs text-dim">
        {title.year ?? 'Year unknown'}
        {title.kind === 'show'
          ? ` · ${title.episodes.seen} of ${title.episodes.total} episodes`
          : ''}
      </p>
      {flags.length > 0 ? <p className="text-xs text-faint">{flags.join(' · ')}</p> : null}
    </article>
  );
}
