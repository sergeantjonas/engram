import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import {
  type EpisodeCell as Cell,
  clearGap,
  type GapReason,
  setGap,
  titleQuery,
} from '../api/titles.ts';
import { formatAirDate, formatWatched } from './format.ts';
import { MarkWatched, TakeBack } from './MarkWatched.tsx';

type CellStatus = 'seen' | 'skipped' | 'missing' | 'unmatched' | 'hole';

/** Seen wins: a gap left on a watched episode is stale, and the grid shows the fact. */
function statusOf(episode: Cell): CellStatus {
  if (episode.seen) return 'seen';
  if (episode.gap) return episode.gap.reason;
  if (episode.unmatched) return 'unmatched';
  return 'hole';
}

const STATUS_LABEL: Record<CellStatus, string> = {
  seen: 'seen',
  skipped: 'not seen, skipped',
  missing: 'not seen, missing',
  unmatched: 'not on TMDB',
  hole: 'not seen',
};

const STATUS_CLASS: Record<CellStatus, string> = {
  seen: 'bg-jade text-on-jade',
  // Gold against the gap's rose, because drift against it is 1.22:1 and the two
  // kinds of hole have to be told apart at cell size, not in the popover.
  skipped: 'border border-gold text-gold',
  missing: 'border border-gap text-gap',
  unmatched: 'border border-dashed border-faint text-faint',
  hole: 'bg-surf text-dim',
};

const REASON_LABEL: Record<GapReason, string> = {
  skipped: 'Skipped on purpose',
  missing: 'Never had it',
};

export function EpisodeCell({
  episode,
  season,
  titleId,
  isOwner,
}: {
  episode: Cell;
  /** Not on the cell itself: a mark names the episode by season and number. */
  season: number;
  titleId: string;
  isOwner: boolean;
}) {
  const [open, setOpen] = useState(false);
  const status = statusOf(episode);
  const label = `Episode ${episode.number}${episode.name ? `: ${episode.name}` : ''}, ${STATUS_LABEL[status]}`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={label}
        className={`grid h-7 w-[34px] place-items-center font-mono text-[10px] font-medium hover:ring-2 hover:ring-dim ${STATUS_CLASS[status]}`}
      >
        {episode.number}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          collisionPadding={16}
          className="w-72 rounded border border-line bg-surf p-4 text-sm text-tx shadow-lg"
        >
          <p className="font-medium">
            {episode.number}. {episode.name ?? 'Untitled'}
          </p>
          <p className="mt-1 text-xs text-dim">
            {episode.unmatched ? 'TMDB does not list this episode' : formatAirDate(episode.airDate)}
            {episode.runtimeMin !== null ? ` · ${episode.runtimeMin} min` : ''}
          </p>
          <p className="mt-2 text-xs text-tx">
            {episode.seen
              ? `Watched ${formatWatched(episode.lastWatchedAt, episode.lastWatchedPrecision)}` +
                (episode.playCount > 1 ? `, ${episode.playCount} plays` : '')
              : 'Not seen'}
          </p>
          {/* The affirmative action first, and above the hole form: an
              unwatched cell is far more often one this record never heard
              about than one there is a story behind. */}
          {isOwner && !episode.seen ? (
            <div className="mt-3 border-t border-line pt-3">
              <MarkWatched
                titleId={titleId}
                scope={{ season, episode: episode.number }}
                what={`S${season}E${episode.number}`}
                onDone={() => setOpen(false)}
              />
            </div>
          ) : null}
          {/* The way out of a misclick found later than the notice that
              offered it. Only what was typed here: a play Plex reported is not
              this record's to delete, so a watched cell with no hand-entered
              play shows nothing. */}
          {isOwner && episode.manualPlays > 0 ? (
            <div className="mt-3 border-t border-line pt-3">
              <TakeBack
                titleId={titleId}
                scope={{ season, episode: episode.number }}
                entered={episode.manualPlays}
                onDone={() => setOpen(false)}
              />
            </div>
          ) : null}
          {/* A seen episode only gets the form when a stale reason is still on
              it to clear, and nobody but the owner gets it at all: a stranger
              reads the grid from the colours and this popover's facts. */}
          {isOwner && (!episode.seen || episode.gap) ? (
            <GapForm episode={episode} titleId={titleId} onDone={() => setOpen(false)} />
          ) : null}
          <Popover.Arrow className="fill-line" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function GapForm({
  episode,
  titleId,
  onDone,
}: {
  episode: Cell;
  titleId: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const groupId = useId();
  const [reason, setReason] = useState<GapReason>(episode.gap?.reason ?? 'skipped');
  const [note, setNote] = useState(episode.gap?.note ?? '');

  // Refetch rather than patch the cache: the grid is one query, and the API
  // is the one that knows what it wrote.
  const settle = async () => {
    await queryClient.invalidateQueries({ queryKey: titleQuery(titleId).queryKey });
    onDone();
  };
  const declare = useMutation({
    mutationFn: () => setGap(episode.id, { reason, note: note.trim() || null }),
    onSuccess: settle,
  });
  const clear = useMutation({ mutationFn: () => clearGap(episode.id), onSuccess: settle });
  const busy = declare.isPending || clear.isPending;
  const failure = declare.error ?? clear.error;

  return (
    <form
      className="mt-3 space-y-2 border-t border-line pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        declare.mutate();
      }}
    >
      <fieldset className="space-y-1">
        <legend className="text-xs text-dim">Why is this a hole?</legend>
        {(Object.keys(REASON_LABEL) as GapReason[]).map((value) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name={`${groupId}-reason`}
              value={value}
              checked={reason === value}
              onChange={() => setReason(value)}
            />
            {REASON_LABEL[value]}
          </label>
        ))}
      </fieldset>
      <input
        aria-label="Note"
        placeholder="Note (optional)"
        value={note}
        maxLength={500}
        onChange={(event) => setNote(event.target.value)}
        className="w-full rounded border border-line bg-bg px-2 py-1 text-sm"
      />
      {failure ? (
        <p role="alert" className="text-xs text-gap-tx">
          {failure.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-jade px-3 py-1 text-on-jade disabled:opacity-50"
        >
          Save
        </button>
        {episode.gap ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => clear.mutate()}
            className="rounded border border-line px-3 py-1 disabled:opacity-50"
          >
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}
