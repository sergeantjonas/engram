import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps, Link } from '@tanstack/react-router';
import { ApiError } from '../api/client.ts';
import { posterUrl, titleQuery } from '../api/titles.ts';
import { SeasonGrid } from '../title/SeasonGrid.tsx';
import { STATE_LABEL } from '../wall/TitleCard.tsx';

export const Route = createFileRoute('/titles/$id')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(titleQuery(params.id)),
  errorComponent: TitleError,
  component: TitlePage,
});

function TitlePage() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(titleQuery(id));
  const { title, seasons } = data;
  const poster = posterUrl(title.posterPath, 'w500');

  return (
    <div className="space-y-8">
      <header className="flex gap-6">
        <div className="w-32 shrink-0 overflow-hidden rounded bg-surf sm:w-40">
          {poster ? (
            <img src={poster} alt="" className="aspect-2/3 size-full object-cover" />
          ) : (
            <div className="aspect-2/3" />
          )}
        </div>
        <div className="min-w-0 space-y-2">
          <h1 className="text-2xl font-semibold">{title.name}</h1>
          <p className="text-sm text-dim">
            {title.year ?? 'Year unknown'} · {title.kind === 'show' ? 'Series' : 'Film'} ·{' '}
            {STATE_LABEL[title.state]}
            {title.kind === 'show'
              ? ` · ${title.episodes.seen} of ${title.episodes.total} episodes`
              : ''}
          </p>
          {title.excluded ? <p className="text-sm text-faint">Excluded from the wall.</p> : null}
        </div>
      </header>

      {seasons.map((season) => (
        <SeasonGrid key={season.season} season={season} titleId={id} />
      ))}
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
