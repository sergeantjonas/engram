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
  seen: 'bg-emerald-600 text-emerald-50',
  skipped: 'border border-amber-400 text-amber-300',
  missing: 'border border-red-400 text-red-300',
  unmatched: 'border border-dashed border-neutral-600 text-neutral-500',
  hole: 'bg-neutral-800 text-neutral-300',
};

const REASON_LABEL: Record<GapReason, string> = {
  skipped: 'Skipped on purpose',
  missing: 'Never had it',
};

export function EpisodeCell({ episode, titleId }: { episode: Cell; titleId: string }) {
  const [open, setOpen] = useState(false);
  const status = statusOf(episode);
  const label = `Episode ${episode.number}${episode.name ? `: ${episode.name}` : ''}, ${STATUS_LABEL[status]}`;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={label}
        className={`aspect-square rounded text-xs font-medium tabular-nums hover:ring-2 hover:ring-neutral-400 ${STATUS_CLASS[status]}`}
      >
        {episode.number}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          collisionPadding={16}
          className="w-72 rounded border border-neutral-700 bg-neutral-900 p-4 text-sm text-neutral-100 shadow-lg"
        >
          <p className="font-medium">
            {episode.number}. {episode.name ?? 'Untitled'}
          </p>
          <p className="mt-1 text-xs text-neutral-400">
            {episode.unmatched ? 'TMDB does not list this episode' : formatAirDate(episode.airDate)}
            {episode.runtimeMin !== null ? ` · ${episode.runtimeMin} min` : ''}
          </p>
          <p className="mt-2 text-xs text-neutral-300">
            {episode.seen
              ? `Watched ${formatWatched(episode.lastWatchedAt, episode.lastWatchedPrecision)}` +
                (episode.playCount > 1 ? `, ${episode.playCount} plays` : '')
              : 'Not seen'}
          </p>
          {/* A seen episode only gets the form when a stale reason is still on it to clear. */}
          {!episode.seen || episode.gap ? (
            <GapForm episode={episode} titleId={titleId} onDone={() => setOpen(false)} />
          ) : null}
          <Popover.Arrow className="fill-neutral-700" />
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
      className="mt-3 space-y-2 border-t border-neutral-800 pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        declare.mutate();
      }}
    >
      <fieldset className="space-y-1">
        <legend className="text-xs text-neutral-400">Why is this a hole?</legend>
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
        className="w-full rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-sm"
      />
      {failure ? (
        <p role="alert" className="text-xs text-red-400">
          {failure.message}
        </p>
      ) : null}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-neutral-100 px-3 py-1 text-neutral-900 disabled:opacity-50"
        >
          Save
        </button>
        {episode.gap ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => clear.mutate()}
            className="rounded border border-neutral-700 px-3 py-1 disabled:opacity-50"
          >
            Clear
          </button>
        ) : null}
      </div>
    </form>
  );
}
