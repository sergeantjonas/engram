import { Link } from '@tanstack/react-router';
import type { NowWatching as Session } from '../api/titles.ts';
import { Tip } from '../shell/Tooltip.tsx';
import { formatRuntime } from '../title/format.ts';
import { Band, BandCard, SLOT } from './Band.tsx';

/**
 * What is playing on Plex, drawn in Next up's place while it plays: Next up
 * says where the record stopped, which is false the moment the next episode
 * is on screen.
 */
export function NowWatching({ sessions }: { sessions: readonly Session[] }) {
  return (
    <Band label="Now watching">
      {sessions.slice(0, SLOT.length).map((session, slot) => (
        <li key={session.id} className={`min-w-0 flex-1 ${SLOT[slot]}`}>
          <Card session={session} />
        </li>
      ))}
    </Band>
  );
}

function Card({ session }: { session: Session }) {
  const { durationMs, episode } = session;
  const paused = session.state === 'paused';
  const share = durationMs ? Math.min(session.offsetMs / durationMs, 1) : null;
  // Rounded up, so the last half-minute still says there is some left. None
  // is said in the credits, where the API holds the offset at the runtime.
  const minutesLeft = durationMs
    ? Math.ceil(Math.max(durationMs - session.offsetMs, 0) / 60_000)
    : 0;
  const left = minutesLeft > 0 ? formatRuntime(minutesLeft) : null;

  return (
    <BandCard
      artKey={session.id}
      name={session.name}
      posterPath={session.posterPath}
      backdropPath={session.backdropPath}
    >
      <p className="flex">
        {/* Mouse-only where the name is not a link: the span cannot take the
            focus, and anything reading the page reads the name itself. */}
        <Tip label={session.name}>
          {session.titleId ? (
            <Link
              to="/titles/$id"
              params={{ id: session.titleId }}
              className="truncate font-semibold text-tx hover:underline"
            >
              {session.name}
            </Link>
          ) : (
            // A first watch is not on record until its stop, so there is no
            // page to open yet.
            <span className="truncate font-semibold text-tx">{session.name}</span>
          )}
        </Tip>
      </p>
      {episode ? (
        <p className="truncate">
          <span className="font-mono text-xs text-tx">{`S${episode.season}E${episode.number}`}</span>
          {episode.name ? <span className="text-tx"> {episode.name}</span> : null}
        </p>
      ) : null}
      {/* Paused is said, not coloured: the bar looks the same either way. It
          steps each time the band is asked again rather than moving between. */}
      {paused || share !== null ? (
        <p className="flex items-center gap-2 text-xs text-dim">
          {paused ? <span className="text-tx">Paused</span> : null}
          {share !== null ? (
            <span aria-hidden="true" className="h-[3px] min-w-0 flex-1 bg-line">
              <span className="block h-full bg-dim" style={{ width: `${share * 100}%` }} />
            </span>
          ) : null}
          {left ? (
            <span className="shrink-0">
              <span className="font-mono text-[10px]">{left}</span> left
            </span>
          ) : null}
        </p>
      ) : null}
    </BandCard>
  );
}
