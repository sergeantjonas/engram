import type { ExternalIds, TitleDetail, TitleSummary } from '../api/titles.ts';
import { posterUrl } from '../api/titles.ts';
import { STATE_LABEL } from '../wall/TitleCard.tsx';
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

/**
 * What the title survives a redownload by, and the reason this project exists.
 *
 * Every id it has, named — a bare number says nothing about which catalogue it
 * belongs to, and TMDB numbers films and series in separate namespaces.
 */
function Identity({ ids, kind }: { ids: ExternalIds; kind: TitleSummary['kind'] }) {
  // Canonical first — tvdb for a show, tmdb for a film — because that is the
  // one the title is keyed by and the one that survives a redownload.
  const order =
    kind === 'show' ? (['tvdb', 'tmdb', 'imdb'] as const) : (['tmdb', 'tvdb', 'imdb'] as const);
  const named = order
    .map((source) => (ids[source] === null ? null : `${source} ${ids[source]}`))
    .filter((id) => id !== null);

  if (named.length === 0) return null;
  return <p className="font-mono text-[10px] text-faint">{named.join(' · ')}</p>;
}

export function TitleHeader({
  title,
  ids,
  figures,
}: Pick<TitleDetail, 'title' | 'ids' | 'figures'>) {
  const poster = posterUrl(title.posterPath, 'w500');
  const isShow = title.kind === 'show';
  const { plays, rewatched, firstWatchedAt, firstWatchedPrecision, lastWatchedPrecision } = figures;

  const since = formatSince(figures.lastWatchedAt, lastWatchedPrecision);
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
          <Identity ids={ids} kind={title.kind} />
        </div>

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
