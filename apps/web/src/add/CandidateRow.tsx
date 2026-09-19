import { posterUrl, type TmdbCandidate } from '../api/titles.ts';

export function CandidateRow({
  candidate,
  onAdd,
  adding,
  disabled,
  error,
}: {
  candidate: TmdbCandidate;
  onAdd: () => void;
  /** This row is the one being added, so it says so rather than just greying out. */
  adding: boolean;
  disabled: boolean;
  error: string | null;
}) {
  const poster = posterUrl(candidate.posterPath);

  return (
    <article className="flex gap-4">
      <div className="w-16 shrink-0 overflow-hidden rounded bg-surf">
        {poster ? (
          <img src={poster} alt="" loading="lazy" className="aspect-2/3 size-full object-cover" />
        ) : (
          <div className="aspect-2/3" />
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h2 className="font-medium">
          {candidate.name}{' '}
          <span className="font-normal text-dim">
            {candidate.year ?? 'year unknown'} · {candidate.kind === 'show' ? 'series' : 'film'}
          </span>
        </h2>
        {candidate.overview ? (
          <p className="line-clamp-2 text-sm text-dim">{candidate.overview}</p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-gap-tx">
            {error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={disabled}
        // Named for the title, so a screen reader hears which of twenty rows
        // this button belongs to.
        aria-label={`Add ${candidate.name}`}
        className="h-fit shrink-0 rounded bg-jade px-3 py-1 text-sm font-medium text-on-jade disabled:opacity-50"
      >
        {adding ? 'Adding…' : 'Add'}
      </button>
    </article>
  );
}
