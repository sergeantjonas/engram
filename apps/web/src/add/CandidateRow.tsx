import { Link } from '@tanstack/react-router';
import { posterUrl, type TmdbCandidate } from '../api/titles.ts';

export function CandidateRow({
  candidate,
  selected,
  onSelect,
  onAdd,
  adding,
  disabled,
  error,
}: {
  candidate: TmdbCandidate;
  selected: boolean;
  onSelect: () => void;
  onAdd: () => void;
  /** This row is the one being added, so it says so rather than just greying out. */
  adding: boolean;
  disabled: boolean;
  error: string | null;
}) {
  const poster = posterUrl(candidate.posterPath);
  const stored = candidate.storedTitleId;

  return (
    <article className="flex items-start gap-3">
      {stored === null ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onSelect}
          // Named for the title, so a screen reader hears which of twenty rows
          // this box belongs to.
          aria-label={`Select ${candidate.name}`}
          className="mt-1 shrink-0"
        />
      ) : (
        // Holds the column open so the posters of a mixed list still line up.
        <span className="w-[13px] shrink-0" />
      )}
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
      {stored === null ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          aria-label={`Add ${candidate.name}`}
          className="h-fit shrink-0 rounded bg-jade px-3 py-1 text-sm font-medium text-on-jade disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      ) : (
        // A title already held is one click from where the search was heading
        // anyway, so the row points at it rather than offering to add it twice.
        <Link
          to="/titles/$id"
          params={{ id: stored }}
          className="h-fit shrink-0 text-sm text-dim underline-offset-4 hover:text-tx hover:underline"
        >
          On the record →
        </Link>
      )}
    </article>
  );
}
