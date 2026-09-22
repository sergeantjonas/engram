import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps, redirect } from '@tanstack/react-router';
import { meQuery } from '../api/auth.ts';
import { type TitleListFilter, titlesQuery } from '../api/titles.ts';
import { appliesTo, isFacet, isKind } from '../wall/facets.ts';
import { Wall, type WallSearch } from '../wall/Wall.tsx';

/**
 * Only `excluded` reaches the API.
 *
 * The facets are counted as well as applied, and a count of what survived the
 * filter is not a count — so the wall asks for the whole library once and
 * narrows it here. That also makes changing chips instant instead of a round
 * trip. The API keeps its own `state` filter for callers that want one.
 */
const toFilter = (search: WallSearch): TitleListFilter => ({
  includeExcluded: search.excluded,
});

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): WallSearch => ({
    ...(isFacet(search.facet) ? { facet: search.facet } : {}),
    ...(isKind(search.kind) ? { kind: search.kind } : {}),
    ...(typeof search.q === 'string' && search.q.trim() !== '' ? { q: search.q.trim() } : {}),
    ...(search.excluded === true ? { excluded: true } : {}),
  }),
  /**
   * `?kind=movie&facet=going` is an address the wall never writes: the chip is
   * not drawn under Movies, because a run facet can never match a film. Left
   * alone it renders an empty wall with nothing lit to explain it, so the URL
   * is corrected rather than obeyed — which also leaves something coherent to
   * bookmark or go back to. `?facet=want` in a stranger's hands is the same
   * address: the owner's link, passed on, to a chip that is not drawn for them.
   */
  beforeLoad: async ({ context, search }) => {
    // Primed by the root's `beforeLoad`, so this reads the answer already there.
    const { isOwner } = await context.queryClient.ensureQueryData(meQuery);
    if (search.facet !== undefined && !appliesTo(search.facet, search.kind, isOwner)) {
      const { facet: _dropped, ...rest } = search;
      throw redirect({ to: '/', search: rest, replace: true });
    }
  },
  loaderDeps: ({ search }): WallSearch => (search.excluded ? { excluded: true } : {}),
  loader: ({ context, deps }) => context.queryClient.ensureQueryData(titlesQuery(toFilter(deps))),
  errorComponent: WallError,
  component: Home,
});

function Home() {
  const search = Route.useSearch();
  const { data } = useSuspenseQuery(titlesQuery(toFilter(search)));
  return <Wall titles={data.titles} search={search} />;
}

function WallError({ error }: ErrorComponentProps) {
  // No sign-in branch: the wall is open, so a failure here is a failure rather
  // than a door.
  return (
    <p role="alert" className="text-gap-tx">
      The wall could not be loaded: {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
