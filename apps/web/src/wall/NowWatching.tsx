import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { nextUpQuery, nowWatchingQuery, type NowWatching as Session } from '../api/titles.ts';
import { Tip } from '../shell/Tooltip.tsx';
import { formatRuntime } from '../title/format.ts';
import { Band, BandCard, SLOT } from './Band.tsx';

const NONE: readonly Session[] = [];

/** One session at one item: the same key playing the next episode is a new one. */
const playingAt = (session: Session) =>
  `${session.id} ${session.name} ${session.episode?.season} ${session.episode?.number}`;

/**
 * What is playing, with the wall's record asked for again as each session
 * ends. Its stop is what records the play, so the tiles and Next up are stale
 * from then on, and nothing else would ask before the next navigation or
 * focus. A poll that fails keeps the last answer, so it never reads as an end.
 */
export function useNowWatching(): readonly Session[] {
  const queryClient = useQueryClient();
  const sessions = useQuery(nowWatchingQuery()).data?.nowWatching;
  const live = useRef<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (sessions === undefined) return;
    const now = new Set(sessions.map(playingAt));
    const ended = [...live.current].some((at) => !now.has(at));
    live.current = now;
    if (ended) {
      // Next up mounts in the band's place as this runs and is already asking;
      // that fetch is left to finish rather than started again.
      const once = { cancelRefetch: false };
      void queryClient.invalidateQueries({ queryKey: ['titles'] }, once);
      void queryClient.invalidateQueries({ queryKey: nextUpQuery().queryKey }, once);
    }
  }, [sessions, queryClient]);

  return sessions ?? NONE;
}

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
