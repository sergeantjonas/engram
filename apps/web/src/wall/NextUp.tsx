import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type NextUp as Candidate, nextUpQuery } from '../api/titles.ts';
import { Tip } from '../shell/Tooltip.tsx';
import { formatAgo } from '../title/format.ts';
import { Band, BandCard, SLOT } from './Band.tsx';

const at = (episode: { season: number; number: number }) => `S${episode.season}E${episode.number}`;

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
export function NextUp({
  passed,
  pass,
}: {
  /** The titles passed over in this sitting. */
  passed: ReadonlySet<string>;
  pass: (titleId: string) => void;
}) {
  const { data } = useQuery(nextUpQuery());

  const showing = (data?.nextUp ?? []).filter((candidate) => !passed.has(candidate.titleId));
  if (showing.length === 0) return null;
  // Only while there is something left beside it: a button that empties the
  // strip is a way to lose the one thing it had to say.
  const passable = showing.length > 1;

  return (
    <Band label="Next up">
      {showing.slice(0, SLOT.length).map((candidate, slot) => (
        // Keyed by slot, not by title: while a card is left to move in,
        // passing one moves the next into its place, and the button under
        // the pointer or the focus stays the same element rather than
        // vanishing with the card it dismissed.
        // biome-ignore lint/suspicious/noArrayIndexKey: the slot is the identity here
        <li key={slot} className={`min-w-0 flex-1 ${SLOT[slot]}`}>
          <Card
            candidate={candidate}
            onPass={passable ? () => pass(candidate.titleId) : undefined}
          />
        </li>
      ))}
    </Band>
  );
}

function Card({ candidate, onPass }: { candidate: Candidate; onPass?: (() => void) | undefined }) {
  const ago = formatAgo(candidate.stoppedAfter.watchedAt, candidate.stoppedAfter.watchedPrecision);

  // Two sentences rather than one line of clauses. What to watch comes first,
  // because it is what the card is for; where you left off is the reason for
  // it, and reasons go second and quieter.
  const stopped = `You stopped after ${at(candidate.stoppedAfter)}${ago ? `, ${ago}` : ''}`;
  const history = candidate.continues ? `${stopped}.` : `${stopped}, but this one is still unseen.`;

  return (
    // Keyed by title though the slot is not.
    <BandCard
      artKey={candidate.titleId}
      name={candidate.name}
      posterPath={candidate.posterPath}
      backdropPath={candidate.backdropPath}
    >
      {/* The name, the episode and the reason each get a line, so a narrow
          card truncates the episode's name before the show's. "Not now" rides
          on the name's line for the same reason: a column of its own would
          take its width from all three. */}
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
            // 24px tall to hit, pulled back by as much so the line holds.
            className="-my-1 ml-auto shrink-0 py-1 text-xs text-dim underline-offset-4 hover:text-tx hover:underline"
          >
            Not now
          </button>
        ) : null}
      </p>
      <p className="truncate">
        {/* Not jade, which says seen, on the one episode that is not. */}
        <span className="font-mono text-xs text-tx">{at(candidate.next)}</span>
        {candidate.next.name ? <span className="text-tx"> {candidate.next.name}</span> : null}
      </p>
      {/* Two lines rather than a truncation: "but this one is still unseen"
          is the clause that stops the card reading as a plain carry-on. */}
      <p className="line-clamp-2 text-xs text-dim">{history}</p>
    </BandCard>
  );
}
