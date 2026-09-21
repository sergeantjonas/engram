import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { AuthStatus } from '../auth/AuthStatus.tsx';
import { useIsOwner } from '../auth/useIsOwner.ts';
import { isFacet, isKind } from '../wall/facets.ts';

/**
 * Searching the record, which is not the same as searching TMDB.
 *
 * This narrows what is already on the wall by name; `/add` asks TMDB for
 * things that are not on it yet. Both are a box in the chrome, so the labels
 * have to do the telling apart.
 */
export function TopBar() {
  const isOwner = useIsOwner();
  const navigate = useNavigate();
  // Read per field and only on the wall. `/add` has a `q` of its own — the
  // TMDB query — and showing that here would put the thing this box is not
  // for into the box, under a label saying otherwise. Selected as primitives
  // so each subscription compares by value.
  const q = useRouterState({
    select: (state) => {
      const search = state.location.search as { q?: unknown };
      return state.location.pathname === '/' && typeof search.q === 'string' ? search.q : '';
    },
  });
  const facet = useRouterState({
    select: (state) => {
      const search = state.location.search as { facet?: unknown };
      return state.location.pathname === '/' && isFacet(search.facet) ? search.facet : undefined;
    },
  });
  const kind = useRouterState({
    select: (state) => {
      const search = state.location.search as { kind?: unknown };
      return state.location.pathname === '/' && isKind(search.kind) ? search.kind : undefined;
    },
  });
  const excluded = useRouterState({
    select: (state) => {
      const search = state.location.search as { excluded?: unknown };
      return state.location.pathname === '/' && search.excluded === true;
    },
  });

  const [draft, setDraft] = useState(q);
  // The shell is never remounted between one search and the next, so the
  // initializer above runs once. Without this, Back leaves the box holding a
  // query the wall no longer reflects.
  const [lastQ, setLastQ] = useState(q);
  if (q !== lastQ) {
    setLastQ(q);
    setDraft(q);
  }

  return (
    // Opaque, because sticky means the page now scrolls underneath it and the
    // header is transparent to the body otherwise.
    <header className="sticky top-0 z-10 flex min-h-topbar flex-wrap items-center justify-between gap-x-3.5 gap-y-2.5 border-b border-line bg-bg px-[18px] py-3">
      <search className="flex min-w-0 flex-1 basis-55 items-center">
        <form
          className="flex min-w-0 flex-1 items-center"
          onSubmit={(event) => {
            event.preventDefault();
            const next = draft.trim();
            // The chips carry the query forward, so the box carries the chips:
            // searching is a narrowing of where you already are, not a way back
            // to the unfiltered wall.
            navigate({
              to: '/',
              search: {
                ...(facet ? { facet } : {}),
                ...(kind ? { kind } : {}),
                ...(excluded ? { excluded: true as const } : {}),
                ...(next === '' ? {} : { q: next }),
              },
            });
          }}
        >
          <input
            type="search"
            aria-label="Search your record"
            placeholder="Search your record…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="min-w-0 flex-1 border border-line bg-surf px-2.5 py-1.5 font-mono text-[9.5px] text-tx placeholder:text-dim"
          />
        </form>
      </search>
      <div className="flex flex-none items-center gap-2.5">
        {/* Not disabled or left to 401 on arrival: a visitor who cannot add a
            title is better served by chrome that does not mention adding one
            than by a door that opens onto a refusal. */}
        {isOwner ? (
          <Link
            to="/add"
            className="border border-jade bg-jade px-3.5 py-2 text-[12.5px] font-semibold text-on-jade"
          >
            + Add watched
          </Link>
        ) : null}
        <AuthStatus />
      </div>
    </header>
  );
}
