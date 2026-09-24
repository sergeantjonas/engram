import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { backdropUrl, type NextUp as Candidate, nextUpQuery, posterUrl } from '../api/titles.ts';
import { Tip } from '../shell/Tooltip.tsx';
import { formatAgo } from '../title/format.ts';

const at = (episode: { season: number; number: number }) => `S${episode.season}E${episode.number}`;

/**
 * Which slots the strip's width has room for, by the strip's own width rather
 * than the window's, since the rail and the page's gutter take a share of it.
 * A slot is drawn at 300px or more, so the fourth waits for 1280px; the first
 * is always there, which is what a phone sees.
 */
const SLOT = ['', 'hidden @2xl:block', 'hidden @5xl:block', 'hidden @7xl:block'] as const;

/**
 * What to pick back up, in a strip above the chips.
 *
 * A strip of compact cards rather than the 330px hero the first round drew:
 * each is one line of fact and a way in, and giving them a third of the window
 * would put the wall — which is the screen — below the fold on a laptop. A
 * row rather than one band cycled through, because with several runs in
 * rotation the answer to "what now" is a choice between them, and one at a
 * time hides the choice behind a button.
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
  if (showing.length === 0) return null;
  // Only while there is something left beside it: a button that empties the
  // strip is a way to lose the one thing it had to say.
  const passable = showing.length > 1;

  return (
    <section aria-label="Next up" className="@container space-y-1.5">
      {/* The region's name already says it to anything reading the page. */}
      <p aria-hidden="true" className="font-mono text-[9px] tracking-[.08em] text-dim">
        NEXT UP
      </p>
      {/* One card fills the row. */}
      <ul className="flex gap-3">
        {showing.slice(0, SLOT.length).map((candidate, slot) => (
          // Keyed by slot, not by title: while a card is left to move in,
          // passing one moves the next into its place, and the button under
          // the pointer or the focus stays the same element rather than
          // vanishing with the card it dismissed.
          // biome-ignore lint/suspicious/noArrayIndexKey: the slot is the identity here
          <li key={slot} className={`min-w-0 flex-1 ${SLOT[slot]}`}>
            <Card
              candidate={candidate}
              onPass={
                passable
                  ? () => setPassed((open) => new Set(open).add(candidate.titleId))
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Card({ candidate, onPass }: { candidate: Candidate; onPass?: (() => void) | undefined }) {
  const backdrop = backdropUrl(candidate.backdropPath, 'w780');
  const poster = posterUrl(candidate.posterPath);
  const ago = formatAgo(candidate.stoppedAfter.watchedAt, candidate.stoppedAfter.watchedPrecision);

  // Two sentences rather than one line of clauses. What to watch comes first,
  // because it is what the card is for; where you left off is the reason for
  // it, and reasons go second and quieter.
  const stopped = `You stopped after ${at(candidate.stoppedAfter)}${ago ? `, ${ago}` : ''}`;
  const history = candidate.continues ? `${stopped}.` : `${stopped}, but this one is still unseen.`;

  return (
    <div className="relative isolate h-full overflow-hidden rounded border border-line bg-surf">
      {/* The artwork is keyed by title though the slot is not, so a card moving
          in never sits beside the one it replaced while its own loads. */}
      {backdrop ? (
        // Half-strength under a left-to-right scrim: the text sits on the left
        // and has to stay legible over whatever the still happens to hold.
        <div
          key={candidate.titleId}
          aria-hidden="true"
          style={{ backgroundImage: `url(${backdrop})` }}
          className="absolute inset-0 -z-10 bg-cover bg-[center_30%] opacity-50 after:absolute after:inset-0 after:bg-gradient-to-r after:from-bg after:via-bg/80 after:to-bg/20"
        />
      ) : null}

      <div className="flex h-full items-center gap-4 p-3">
        {poster ? (
          <img
            key={candidate.titleId}
            src={poster}
            alt=""
            className="h-[52px] w-[35px] shrink-0 rounded-sm object-cover"
          />
        ) : null}

        <div className="min-w-0 flex-1 space-y-0.5">
          {/* The name, the episode and the reason each get a line, so a narrow
              card truncates the episode's name before the show's. "Not now"
              rides on the name's line for the same reason: a column of its own
              would take its width from all three. */}
          <p className="flex items-baseline gap-3">
            <Tip label={candidate.name}>
              <Link
                to="/titles/$id"
                params={{ id: candidate.titleId }}
                className="truncate font-semibold text-tx hover:underline"
              >
                {candidate.name}
              </Link>
            </Tip>
            {onPass ? (
              <button
                type="button"
                onClick={onPass}
                aria-label={`Not now for ${candidate.name}`}
                className="ml-auto shrink-0 text-xs text-dim underline-offset-4 hover:text-tx hover:underline"
              >
                Not now
              </button>
            ) : null}
          </p>
          <p className="truncate">
            <span className="font-mono text-xs text-jade">{at(candidate.next)}</span>
            {candidate.next.name ? <span className="text-tx"> {candidate.next.name}</span> : null}
          </p>
          {/* Two lines rather than a truncation: "but this one is still unseen"
              is the clause that stops the card reading as a plain carry-on. */}
          <p className="line-clamp-2 text-xs text-dim">{history}</p>
        </div>
      </div>
    </div>
  );
}
