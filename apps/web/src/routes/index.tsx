import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { type TitleListFilter, titlesQuery } from '../api/titles.ts';
import { isFacet } from '../wall/facets.ts';
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
    ...(typeof search.q === 'string' && search.q.trim() !== '' ? { q: search.q.trim() } : {}),
    ...(search.excluded === true ? { excluded: true } : {}),
  }),
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
