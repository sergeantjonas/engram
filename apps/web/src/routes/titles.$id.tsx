import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps, Link } from '@tanstack/react-router';
import { ApiError } from '../api/client.ts';
import { titleQuery } from '../api/titles.ts';
import { SeasonGrid } from '../title/SeasonGrid.tsx';
import { TitleHeader } from '../title/TitleHeader.tsx';

export const Route = createFileRoute('/titles/$id')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(titleQuery(params.id)),
  errorComponent: TitleError,
  component: TitlePage,
});

function TitlePage() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(titleQuery(id));
  const { seasons } = data;

  return (
    <div className="space-y-5">
      <TitleHeader {...data} />

      {/* Seasons sit close together: the run is one object, and a page-worth of
          air between each season reads as a list of unrelated grids. */}
      <div className="space-y-2.5">
        {seasons.map((season) => (
          <SeasonGrid key={season.season} season={season} titleId={id} />
        ))}
      </div>
    </div>
  );
}

function TitleError({ error }: ErrorComponentProps) {
  // 404 covers being excluded as well as not existing: the API tells a stranger
  // the same thing about a title kept off the wall as about one that was never
  // added, and so does this.
  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
    return (
      <p className="text-dim">
        No title is stored under that id.{' '}
        <Link to="/" className="underline underline-offset-4">
          Back to the wall
        </Link>
      </p>
    );
  }
  return (
    <p role="alert" className="text-gap-tx">
      The title could not be loaded: {error instanceof Error ? error.message : String(error)}
    </p>
  );
}
