import type { SeasonGrid, TitleSummary } from '../api/titles.ts';
import { posterUrl } from '../api/titles.ts';
import { STATE_LABEL } from '../wall/TitleCard.tsx';
import { titleFigures } from './figures.ts';
import { formatSince, formatWatched } from './format.ts';

/** A fact about the title as a whole: mono figure, Archivo label, in that order. */
function Figure({ value, label }: { value: string; label: string }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="font-mono text-xs text-tx">{value}</span>
      <span className="text-xs text-dim">{label}</span>
    </span>
  );
}

/**
 * Whether the files are still there.
 *
 * Absent rather than "unknown" when nothing has reported: no Sonarr webhook
 * exists yet, so a null here means nobody has looked, and a pill saying so on
 * every title would be noise rather than news.
 */
function Presence({ onDisk }: { onDisk: boolean | null }) {
  if (onDisk === null) return null;
  return (
    <span
      className={`rounded-full border px-2 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
        onDisk ? 'border-line text-dim' : 'border-drift text-drift'
      }`}
    >
      {onDisk ? 'On disk' : 'Not on disk'}
    </span>
  );
}

export function TitleHeader({ title, seasons }: { title: TitleSummary; seasons: SeasonGrid[] }) {
  const poster = posterUrl(title.posterPath, 'w500');
  const isShow = title.kind === 'show';
  const figures = titleFigures(seasons);
  const { plays, rewatched, firstWatchedAt, firstWatchedPrecision } = figures;

  // A film has no grid to count, so its last watch stays as the API summarised
  // it. A show's comes off the grid, where specials are already excluded.
  const lastWatchedAt = isShow ? figures.lastWatchedAt : title.lastWatchedAt;
  const lastWatchedPrecision = isShow ? figures.lastWatchedPrecision : title.lastWatchedPrecision;
  const since = formatSince(lastWatchedAt, lastWatchedPrecision);
  // A coarse entry formats as the period itself, not a duration, so "since
  // last" beside "2019" would read as nineteen years having passed.
  const sinceLabel =
    lastWatchedPrecision === 'exact' || lastWatchedPrecision === 'day'
      ? 'since last'
      : 'last watched';

  return (
    <header className="flex gap-6">
      <div className="w-32 shrink-0 overflow-hidden rounded bg-surf sm:w-40">
        {poster ? (
          <img src={poster} alt="" className="aspect-2/3 size-full object-cover" />
        ) : (
          <div className="aspect-2/3" />
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{title.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-dim">{title.year ?? '????'}</span>
            <span className="text-xs text-faint">·</span>
            <span className="text-xs text-dim">{isShow ? 'Series' : 'Film'}</span>
            <span className="text-xs text-faint">·</span>
            <span className="text-xs text-dim">{STATE_LABEL[title.state]}</span>
            <Presence onDisk={title.onDisk} />
          </div>
        </div>

        {/* Counted off the grid rather than asked for: the page already holds
            every episode, and a second request for a sum of what is on screen
            would be a round trip to learn what it can see. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {plays > 0 ? (
            <Figure value={String(plays)} label={plays === 1 ? 'play' : 'plays'} />
          ) : null}
          {isShow ? (
            <Figure
              value={`${title.episodes.seen} of ${title.episodes.total}`}
              label="episodes seen"
            />
          ) : null}
          {rewatched > 0 ? <Figure value={String(rewatched)} label="rewatched" /> : null}
          {firstWatchedAt !== null ? (
            <Figure
              value={formatWatched(firstWatchedAt, firstWatchedPrecision)}
              label="first watched"
            />
          ) : null}
          {since !== null ? <Figure value={since} label={sinceLabel} /> : null}
        </div>

        {title.excluded ? <p className="text-sm text-faint">Excluded from the wall.</p> : null}
      </div>
    </header>
  );
}
