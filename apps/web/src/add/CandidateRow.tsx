import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { posterUrl, type TmdbCandidate } from '../api/titles.ts';

export function CandidateRow({
  candidate,
  selected,
  onSelect,
  onAdd,
  onWant,
  pending,
  disabled,
  error,
  heading: Heading = 'h2',
  focus = null,
  onFocused,
}: {
  candidate: TmdbCandidate;
  selected: boolean;
  onSelect: () => void;
  onAdd: () => void;
  onWant: () => void;
  /** What this row is being written as, so it says so rather than just greying out. */
  pending: 'add' | 'want' | null;
  disabled: boolean;
  error: string | null;
  /** One level below whatever it is listed under: a collection's films sit under its heading. */
  heading?: 'h2' | 'h3';
  /** Which of this row's controls the keyboard is to land on, if any. */
  focus?: 'want' | 'record' | null;
  onFocused?: () => void;
}) {
  const poster = posterUrl(candidate.posterPath);
  const stored = candidate.storedTitleId;
  const wantRef = useRef<HTMLButtonElement>(null);
  const recordRef = useRef<HTMLAnchorElement>(null);

  // Held until the control can take it: the row may not have become stored
  // yet, or its buttons may still be disabled by the write that sent focus
  // here, and a focus that lands nowhere would drop to the page.
  useEffect(() => {
    const target =
      focus === 'want' && stored === null && !disabled
        ? wantRef.current
        : focus === 'record' && stored !== null
          ? recordRef.current
          : null;
    if (!target) return;
    target.focus();
    onFocused?.();
  }, [focus, stored, disabled, onFocused]);

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
        {/* Where a series is from and what it is called there are what tell
            a remake from its original: two rows reading "The Office 2005 ·
            series" and "2001 · series" leave the year to carry all of it. */}
        <Heading className="font-medium">
          {candidate.name}{' '}
          <span className="font-normal text-dim">
            {candidate.year ?? 'year unknown'} · {candidate.kind === 'show' ? 'series' : 'film'}
            {candidate.originCountry ? ` · ${candidate.originCountry}` : ''}
          </span>
        </Heading>
        {candidate.original ? (
          // Its own language, so a screen reader says it right and CJK text
          // takes the glyphs of the language it is in.
          <p lang={candidate.original.language ?? undefined} className="text-sm text-dim">
            {candidate.original.name}
          </p>
        ) : null}
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
        // Add is the jade one because it is what this screen is for: saying
        // what was watched. Want records an intention and nothing else.
        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            aria-label={`Add ${candidate.name}`}
            className="rounded bg-jade px-3 py-1 text-sm font-medium text-on-jade disabled:opacity-50"
          >
            {pending === 'add' ? 'Adding…' : 'Add'}
          </button>
          <button
            ref={wantRef}
            type="button"
            onClick={onWant}
            disabled={disabled}
            aria-label={`Want ${candidate.name}`}
            className="rounded border border-line px-3 py-1 text-sm hover:border-dim disabled:opacity-50"
          >
            {pending === 'want' ? 'Saving…' : 'Want'}
          </button>
        </div>
      ) : (
        // A title already held is one click from where the search was heading
        // anyway, so the row points at it rather than offering to add it twice.
        <Link
          ref={recordRef}
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
