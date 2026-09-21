import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps, Link } from '@tanstack/react-router';
import { ApiError } from '../api/client.ts';
import { titleQuery } from '../api/titles.ts';
import { useIsOwner } from '../auth/useIsOwner.ts';
import { Activity } from '../title/Activity.tsx';
import { IntentControls } from '../title/Intent.tsx';
import { MarkWatchedButton, TakeBack } from '../title/MarkWatched.tsx';
import { SeasonGrid } from '../title/SeasonGrid.tsx';
import { Section } from '../title/Section.tsx';
import { TitleHeader } from '../title/TitleHeader.tsx';
import { YearBar } from '../title/YearBar.tsx';

export const Route = createFileRoute('/titles/$id')({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(titleQuery(params.id)),
  errorComponent: TitleError,
  component: TitlePage,
});

function TitlePage() {
  const { id } = Route.useParams();
  const { data } = useSuspenseQuery(titleQuery(id));
  const { title, seasons, figures } = data;
  const isOwner = useIsOwner();
  const film = title.kind === 'movie';
  const unwatched = title.state !== 'seen';

  return (
    <div className="space-y-5">
      <TitleHeader {...data} />

      {/* What was watched and what was meant, on one row. The marking half
          disappears when it has nothing to offer; the intent half is always
          there, because having no opinion is a state you change by saying so
          rather than one the page can infer. */}
      {isOwner ? (
        <div className="flex flex-wrap items-center gap-3">
          <MarkWatchedButton
            titleId={id}
            scope="all"
            complete={!unwatched}
            what={film ? 'the film' : 'the whole run'}
            label={film ? 'Mark the film watched' : 'Mark the whole run watched'}
            className="rounded border border-line px-3 py-1.5 text-sm text-dim hover:border-jade hover:text-jade"
            {...(film
              ? { unit: 'play' as const }
              : { hint: 'Specials are left out — mark those season by season.' })}
          />
          <TakeBack titleId={id} scope="all" entered={figures.manualPlays} />
          {/* A rule rather than a gap: the two halves answer different
              questions and the row would otherwise read as one list. Gone when
              the marking half is, or it is a rule at the left edge dividing
              nothing from the intent controls. */}
          {unwatched || figures.manualPlays > 0 ? (
            <span aria-hidden="true" className="h-5 w-px bg-line" />
          ) : null}
          <IntentControls titleId={id} intent={title} />
        </div>
      ) : null}

      <YearBar
        moments={data.recentActivity}
        truncated={figures.plays > data.recentActivity.length}
      />

      {seasons.length > 0 ? (
        <Section
          heading="Episodes"
          aside={`${title.episodes.seen} of ${title.episodes.total}${
            figures.rewatched > 0 ? ` · ${figures.rewatched} rewatched` : ''
          }`}
        >
          {/* Seasons sit close together: the run is one object, and a
              page-worth of air between each reads as unrelated grids. */}
          {seasons.map((season) => (
            <SeasonGrid key={season.season} season={season} titleId={id} />
          ))}
        </Section>
      ) : null}

      <Activity moments={data.recentActivity} plays={figures.plays} titleName={title.name} />
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
