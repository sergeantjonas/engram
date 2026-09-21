import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute, type ErrorComponentProps, Link, redirect } from '@tanstack/react-router';
import { ApiError } from '../api/client.ts';
import { type TitleDetail, titleQuery, titlesQuery } from '../api/titles.ts';
import { useIsOwner } from '../auth/useIsOwner.ts';
import { Activity } from '../title/Activity.tsx';
import { IntentControls } from '../title/Intent.tsx';
import { MarkWatchedButton, TakeBack } from '../title/MarkWatched.tsx';
import { SeasonGrid } from '../title/SeasonGrid.tsx';
import { Section } from '../title/Section.tsx';
import { TitleHeader } from '../title/TitleHeader.tsx';
import { TitleList } from '../title/TitleList.tsx';
import { YearBar } from '../title/YearBar.tsx';
import { isKind, type KindFilter } from '../wall/facets.ts';
import { preferredKind } from '../wall/kindMemory.ts';

export const Route = createFileRoute('/titles/$id')({
  /**
   * The pane's kind filter, in the URL for the same reason the wall's is: a
   * filter is a place, and the back button should return to it.
   */
  validateSearch: (search: Record<string, unknown>): { kind?: KindFilter } =>
    isKind(search.kind) ? { kind: search.kind } : {},
  /** The pane opens on the same kind the wall was left on. */
  beforeLoad: ({ params, search }) => {
    if (search.kind !== undefined) return;
    const remembered = preferredKind();
    if (remembered !== undefined) {
      throw redirect({
        to: '/titles/$id',
        params,
        search: { kind: remembered },
        replace: true,
      });
    }
  },
  // Both, in parallel: the page is the title and the pane beside it is the
  // whole library, and waiting for one after the other would show the split
  // half-drawn.
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(titleQuery(params.id)),
      context.queryClient.ensureQueryData(titlesQuery()),
    ]),
  errorComponent: TitleError,
  component: TitlePage,
});

function TitlePage() {
  const { id } = Route.useParams();
  const { kind } = Route.useSearch();
  const { data } = useSuspenseQuery(titleQuery(id));
  const { data: library } = useSuspenseQuery(titlesQuery());
  const { title, seasons, figures } = data;
  // An excluded title is kept off the wall's listing, so the pane beside its
  // own page would leave out the row being looked at — and excluding one from
  // here would make it vanish from the column it sits in.
  const inLibrary = library.titles.some((row) => row.id === id)
    ? library.titles
    : [title, ...library.titles];
  const isOwner = useIsOwner();
  const film = title.kind === 'movie';
  const unwatched = title.state !== 'seen';
  // One clock for every cell on the page, so two of them cannot disagree about
  // what has aired. Compared as `YYYY-MM-DD` against an air date in the same
  // shape, the way the API does it.
  const today = new Date().toISOString().slice(0, 10);

  return (
    // Out of the layout's padding so the pane can sit flush against the rail
    // and rule the full height, then back into it inside the column: the hero
    // is full-bleed within its own column, not across the split.
    <div className="-m-[18px] grid min-h-full min-w-0 md:grid-cols-[216px_1fr]">
      <TitleList titles={inLibrary} currentId={id} kind={kind} />

      <div className="min-w-0 space-y-5 p-[18px]">
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
            {runFirst(seasons).map((season) => (
              <SeasonGrid key={season.season} season={season} titleId={id} today={today} />
            ))}
          </Section>
        ) : null}

        <Activity moments={data.recentActivity} plays={figures.plays} titleName={title.name} />
      </div>
    </div>
  );
}

/**
 * Season 0 last, whatever order the API sent.
 *
 * It arrives first because that is where it sorts, and the design leaves the
 * page to decide. Four titles here open on a specials count in the dozens —
 * House of the Dragon has 89 behind-the-scenes clips, The Boys 76 — so
 * "Specials · 0 of 89" was the first thing the page said about a show whose
 * run is complete. The count is honest and stays; it just goes at the bottom,
 * where a bonus disc belongs.
 */
function runFirst(seasons: TitleDetail['seasons']): TitleDetail['seasons'] {
  return [...seasons].sort((a, b) => Number(a.season === 0) - Number(b.season === 0));
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
