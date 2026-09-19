import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps } from '@tanstack/react-router';
import { ApiError } from '../api/client.ts';
import { isTitleState, type TitleListFilter, titlesQuery } from '../api/titles.ts';
import { Wall, type WallSearch } from '../wall/Wall.tsx';

const toFilter = (search: WallSearch): TitleListFilter => ({
  state: search.state,
  includeExcluded: search.excluded,
});

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): WallSearch => ({
    ...(isTitleState(search.state) ? { state: search.state } : {}),
    ...(search.excluded === true ? { excluded: true } : {}),
  }),
  loaderDeps: ({ search }) => search,
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
  // The gate answers 401 to a stranger; the header already offers sign-in, so
  // this only has to say that the wall is what is behind it.
  if (error instanceof ApiError && error.status === 401) {
    return <p className="text-neutral-400">Sign in to see your wall.</p>;
  }
  return (
    <p role="alert" className="text-red-400">
      The wall could not be loaded: {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
