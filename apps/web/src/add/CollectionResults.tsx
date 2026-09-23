import type { InfiniteData, UseInfiniteQueryResult, UseQueryResult } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  type CollectionSearchPage,
  type CollectionTitles,
  candidateKey,
  posterUrl,
  type TmdbCandidate,
} from '../api/titles.ts';
import { describe } from './describe.ts';

/**
 * Film series found by name, one of them open at a time with its films listed
 * as candidates under it. The films are drawn by `row`, so a part is added,
 * wanted and ticked exactly as a search hit is.
 */
export function CollectionResults({
  q,
  collections,
  opened,
  parts,
  onOpen,
  row,
}: {
  q: string;
  collections: UseInfiniteQueryResult<InfiniteData<CollectionSearchPage>>;
  opened: number | null;
  parts: UseQueryResult<CollectionTitles>;
  onOpen: (id: number) => void;
  row: (candidate: TmdbCandidate) => ReactNode;
}) {
  if (collections.isPending) return <p className="text-dim">Searching…</p>;
  if (collections.data === undefined) {
    return (
      <p role="alert" className="text-gap-tx">
        {describe(collections.error)}
      </p>
    );
  }

  const seen = new Set<number>();
  const found = collections.data.pages
    .flatMap((page) => page.results)
    .filter((hit) => !seen.has(hit.id) && seen.add(hit.id));

  if (found.length === 0 && !collections.hasNextPage) {
    return <p className="text-dim">TMDB has no collection for “{q}”.</p>;
  }

  return (
    <div className="space-y-5">
      <ul className="space-y-5">
        {found.map((hit) => {
          const poster = posterUrl(hit.posterPath);
          const open = opened === hit.id;
          return (
            <li key={hit.id} className="space-y-4">
              <article className="flex items-start gap-3">
                {/* The checkbox column of the rows below, held open so the
                    collection's poster lines up with its films'. */}
                <span className="w-[13px] shrink-0" />
                <div className="w-16 shrink-0 overflow-hidden rounded bg-surf">
                  {poster ? (
                    <img
                      src={poster}
                      alt=""
                      loading="lazy"
                      className="aspect-2/3 size-full object-cover"
                    />
                  ) : (
                    <div className="aspect-2/3" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-1">
                  <h2 className="font-medium">
                    {hit.name} <span className="font-normal text-dim">collection</span>
                  </h2>
                  {hit.overview ? (
                    <p className="line-clamp-2 text-sm text-dim">{hit.overview}</p>
                  ) : null}
                </div>
                {/* One word whether open or not, so the name a screen reader
                    hears starts with what the button says; `aria-expanded`
                    carries which it is. */}
                <button
                  type="button"
                  aria-expanded={open}
                  aria-controls={open ? `collection-${hit.id}` : undefined}
                  aria-label={`Films in ${hit.name}`}
                  onClick={() => onOpen(hit.id)}
                  className="h-fit shrink-0 rounded border border-line px-3 py-1 text-sm hover:border-dim aria-expanded:border-tx"
                >
                  Films
                </button>
              </article>
              {open ? (
                <div id={`collection-${hit.id}`}>
                  <Parts parts={parts} row={row} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {collections.hasNextPage ? (
        <button
          type="button"
          disabled={collections.isFetchingNextPage}
          onClick={() => void collections.fetchNextPage()}
          className="font-mono text-[10px] tracking-[.08em] text-faint underline-offset-4 hover:text-tx hover:underline disabled:opacity-50"
        >
          {collections.isFetchingNextPage ? 'asking TMDB…' : 'more from TMDB'}
        </button>
      ) : null}
      {collections.isFetchNextPageError ? (
        <p role="alert" className="text-sm text-gap-tx">
          {describe(collections.error)}
        </p>
      ) : null}
    </div>
  );
}

function Parts({
  parts,
  row,
}: {
  parts: UseQueryResult<CollectionTitles>;
  row: (candidate: TmdbCandidate) => ReactNode;
}) {
  if (parts.isPending) return <p className="ml-4 text-sm text-dim">Asking TMDB…</p>;
  if (parts.isError) {
    return (
      <p role="alert" className="ml-4 text-sm text-gap-tx">
        {describe(parts.error)}
      </p>
    );
  }
  if (parts.data.results.length === 0) {
    return <p className="ml-4 text-sm text-dim">TMDB lists no films in it.</p>;
  }

  // Every part, held ones included: which of a series is already on the
  // record is half of what opening it is for.
  return (
    <ul className="ml-1.5 space-y-5 border-l border-line pl-4">
      {parts.data.results.map((candidate) => (
        <li key={candidateKey(candidate)}>{row(candidate)}</li>
      ))}
    </ul>
  );
}
