import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { backdropUrl, type NextUp as Candidate, nextUpQuery, posterUrl } from '../api/titles.ts';
import { formatAgo } from '../title/format.ts';

const at = (episode: { season: number; number: number }) => `S${episode.season}E${episode.number}`;

/**
 * What to pick back up, in a band above the chips.
 *
 * A band rather than the 330px hero the first round drew: this is one line of
 * fact and a way in, and giving it a third of the window would put the wall —
 * which is the screen — below the fold on a laptop.
 *
 * The mockup's "play in Plex" action is not built. Engram deliberately keeps no
 * `ratingKey`, because they are ephemeral and the whole project exists to
 * outlive them, so there is nothing here to build a deep link out of. A button
 * that opens nothing is worse than no button.
 */
export function NextUp() {
  const { data } = useQuery(nextUpQuery());
  // Dismissals are held here rather than in the URL or on the server: "not
  // now" means not in this sitting, and a title still owed should come back
  // the next time the wall is opened.
  const [passed, setPassed] = useState<ReadonlySet<string>>(new Set());

  const showing = (data?.nextUp ?? []).filter((candidate) => !passed.has(candidate.titleId));
  const candidate = showing[0];
  if (!candidate) return null;

  return (
    <Band
      candidate={candidate}
      // Only while there is something to move on to: a button that empties the
      // band is a way to lose the one thing it had to say.
      onPass={
        showing.length > 1
          ? () => setPassed((open) => new Set(open).add(candidate.titleId))
          : undefined
      }
    />
  );
}

function Band({ candidate, onPass }: { candidate: Candidate; onPass?: (() => void) | undefined }) {
  const backdrop = backdropUrl(candidate.backdropPath, 'w780');
  const poster = posterUrl(candidate.posterPath);
  const ago = formatAgo(candidate.stoppedAfter.watchedAt, candidate.stoppedAfter.watchedPrecision);

  // Two sentences rather than one line of clauses. What to watch comes first,
  // because it is what the band is for; where you left off is the reason for
  // it, and reasons go second and quieter.
  const stopped = `You stopped after ${at(candidate.stoppedAfter)}${ago ? `, ${ago}` : ''}`;
  const history = candidate.continues ? `${stopped}.` : `${stopped}, but this one is still unseen.`;

  return (
    <section
      aria-label="Next up"
      className="relative isolate overflow-hidden rounded border border-line bg-surf"
    >
      {backdrop ? (
        // Half-strength under a left-to-right scrim: the text sits on the left
        // and has to stay legible over whatever the still happens to hold.
        <div
          aria-hidden="true"
          style={{ backgroundImage: `url(${backdrop})` }}
          className="absolute inset-0 -z-10 bg-cover bg-[center_30%] opacity-50 after:absolute after:inset-0 after:bg-gradient-to-r after:from-bg after:via-bg/80 after:to-bg/20"
        />
      ) : null}

      <div className="flex items-center gap-4 p-3">
        {poster ? (
          <img src={poster} alt="" className="h-[52px] w-[35px] shrink-0 rounded-sm object-cover" />
        ) : null}

        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="font-mono text-[9.5px] tracking-[.08em] text-faint">NEXT UP</p>
          <p className="truncate">
            <Link
              to="/titles/$id"
              params={{ id: candidate.titleId }}
              className="font-semibold text-tx hover:underline"
            >
              {candidate.name}
            </Link>
            <span className="text-faint"> · </span>
            <span className="font-mono text-xs text-jade">{at(candidate.next)}</span>
            {candidate.next.name ? <span className="text-tx"> {candidate.next.name}</span> : null}
          </p>
          <p className="truncate text-xs text-dim">{history}</p>
        </div>

        {onPass ? (
          <button
            type="button"
            onClick={onPass}
            className="shrink-0 text-xs text-dim underline-offset-4 hover:text-tx hover:underline"
          >
            Not now
          </button>
        ) : null}
      </div>
    </section>
  );
}
