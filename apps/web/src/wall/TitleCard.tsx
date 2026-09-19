import { posterUrl, type TitleState, type TitleSummary } from '../api/titles.ts';

export const STATE_LABEL: Record<TitleState, string> = {
  unwatched: 'Unwatched',
  in_progress: 'In progress',
  seen: 'Seen',
};

const STATE_BADGE: Record<TitleState, string> = {
  unwatched: 'bg-neutral-700 text-neutral-100',
  in_progress: 'bg-amber-400 text-amber-950',
  seen: 'bg-emerald-500 text-emerald-950',
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
      <div className="relative aspect-2/3 overflow-hidden rounded bg-neutral-800">
        {poster ? (
          // Decorative: the heading below carries the name for a screen reader,
          // and repeating it here would read every card twice.
          <img src={poster} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center p-3 text-center text-sm text-neutral-500">
            {title.name}
          </span>
        )}
        <span
          className={`absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-xs font-medium ${STATE_BADGE[title.state]}`}
        >
          {STATE_LABEL[title.state]}
        </span>
      </div>
      <h2 className="truncate text-sm font-medium" title={title.name}>
        {title.name}
      </h2>
      <p className="text-xs text-neutral-400">
        {title.year ?? 'Year unknown'}
        {title.kind === 'show'
          ? ` · ${title.episodes.seen} of ${title.episodes.total} episodes`
          : ''}
      </p>
      {flags.length > 0 ? <p className="text-xs text-neutral-500">{flags.join(' · ')}</p> : null}
    </article>
  );
}
