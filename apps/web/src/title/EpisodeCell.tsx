import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type KeyboardEvent, useId, useState } from 'react';
import {
  type EpisodeCell as Cell,
  clearGap,
  type GapReason,
  setGap,
  stillUrl,
  titleQuery,
} from '../api/titles.ts';
import { Tip } from '../shell/Tooltip.tsx';
import { formatAirDate, formatWatched } from './format.ts';
import { MarkWatched, TakeBack } from './MarkWatched.tsx';

type CellStatus = 'seen' | 'skipped' | 'missing' | 'unaired' | 'unmatched' | 'hole';

/** Seen wins: a gap left on a watched episode is stale, and the grid shows the fact. */
export function statusOf(episode: Cell, today: string): CellStatus {
  if (episode.seen) return 'seen';
  if (episode.gap) return episode.gap.reason;
  if (episode.airDate !== null && episode.airDate > today) return 'unaired';
  if (episode.unmatched) return 'unmatched';
  return 'hole';
}

const STATUS_LABEL: Record<CellStatus, string> = {
  seen: 'seen',
  skipped: 'not seen, skipped',
  missing: 'not seen, missing',
  unaired: 'not out yet',
  unmatched: 'not on TMDB',
  hole: 'not seen',
};

const STATUS_CLASS: Record<CellStatus, string> = {
  seen: 'bg-jade text-on-jade',
  // The two kinds of hole are told apart at cell size, not in the popover, and
  // by more than hue: a skipped episode is outlined, a missing one filled.
  // Gold for the outline because drift against the gap's rose is 1.22:1.
  skipped: 'border border-gold text-gold',
  // The number in the text colour: the rose as text is 3.97:1, and its lighter
  // text tone would sit within 0.05 of gold's lightness.
  missing: 'border border-gap bg-gap/30 text-tx',
  // Recedes into the page instead of sitting on a surface: an episode that is
  // not out is not part of the run yet, and it must not read as a hole in it.
  // Nothing else in the grid is unfilled but a skipped episode's solid gold
  // outline, which is the point — this was indistinguishable from an
  // unwatched episode, and marking a season claimed two of them.
  unaired: 'border border-dotted border-line bg-bg text-faint',
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
  today,
  rangeFrom,
  tabStop,
  open,
  onOpenChange,
  onWalk,
  onCloseAutoFocus,
}: {
  episode: Cell;
  /** Not on the cell itself: a mark names the episode by season and number. */
  season: number;
  titleId: string;
  isOwner: boolean;
  /** Today as `YYYY-MM-DD`, passed in so a wall of cells shares one clock. */
  today: string;
  /** Where a shift-click's range starts: the cell after the last seen one before this. */
  rangeFrom: number;
  /** Whether this is the season's one cell in the tab order; the arrows move it. */
  tabStop: boolean;
  /** Owned by the season, which moves an open popover to the neighbour on an arrow. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** An arrow, Home or End pressed on the cell or inside its popover. */
  onWalk: (event: KeyboardEvent) => void;
  /** Where the popover's focus goes on close; the season prevents it while handing the panel on. */
  onCloseAutoFocus: (event: Event) => void;
}) {
  const close = () => onOpenChange(false);
  // A shift-click asks for everything from the last seen cell through this
  // one, the shape a backfill actually has — "season 4 up to episode 7" —
  // rather than one cell at a time. Forgotten when the popover closes, so the
  // next plain click is one cell again.
  const [range, setRange] = useState(false);
  const status = statusOf(episode, today);
  const markable = isOwner && !episode.seen && status !== 'unaired';
  const ranged = range && markable && rangeFrom < episode.number;
  const rewatched = episode.playCount > 1;
  const label = `Episode ${episode.number}${episode.name ? `: ${episode.name}` : ''}, ${STATUS_LABEL[status]}${
    rewatched ? `, ${episode.playCount} plays` : ''
  }`;
  const still = stillUrl(episode.stillPath);
  // Figures only on the mono line; the sentence about a missing date or an
  // episode TMDB has never heard of is prose, and prose is set in Archivo.
  const facts = [
    `S${season}E${episode.number}`,
    ...(episode.airDate === null || episode.unmatched ? [] : [formatAirDate(episode.airDate)]),
    ...(episode.runtimeMin === null ? [] : [`${episode.runtimeMin} min`]),
  ];
  const caveat = episode.unmatched
    ? 'TMDB does not list this episode'
    : episode.airDate === null
      ? 'No air date'
      : null;

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setRange(false);
      }}
    >
      {/* A tip as well as the popover: in a season of 366 cells, finding out
          what one is should not cost a click and a dismissal. Hidden while the
          popover is open, which says all of this and more. */}
      <Tip
        hidden={open}
        label={`${episode.number}. ${episode.name ?? 'Untitled'} — ${
          episode.unmatched ? 'not on TMDB' : formatAirDate(episode.airDate)
        }`}
      >
        <Popover.Trigger
          aria-label={label}
          data-episode={episode.number}
          tabIndex={tabStop ? 0 : -1}
          onClick={(event) => setRange(event.shiftKey)}
          onKeyDown={onWalk}
          className={`relative grid h-7 w-[34px] place-items-center font-mono text-[10px] font-medium hover:ring-2 hover:ring-dim focus-visible:outline-offset-0 ${STATUS_CLASS[status]}`}
        >
          {episode.number}
          {/* A corner tick for a second play, not a colour and not a figure:
              jade is "seen" and a second green would fork it, and the cell's
              one number is the episode's. The label carries the count. */}
          {rewatched ? (
            <span
              aria-hidden="true"
              data-rewatched
              className="absolute top-0 right-0 size-0 border-t-[7px] border-l-[7px] border-t-on-jade border-l-transparent"
            />
          ) : null}
        </Popover.Trigger>
      </Tip>
      <Popover.Portal>
        <Popover.Content
          side="top"
          sideOffset={6}
          collisionPadding={16}
          // Capped at what Radix says fits and scrolling past it: with a still,
          // three lines of synopsis and both forms open, the controls must
          // stay reachable on a laptop rather than slide under the fold.
          // No ring of its own. A panel holding no control takes the focus
          // itself, and the open panel is already what is being read; a
          // frame around it would only cross its arrow.
          className="max-h-[var(--radix-popover-content-available-height)] w-80 overflow-y-auto rounded border border-line bg-surf p-4 text-sm text-tx shadow-lg outline-hidden"
          onCloseAutoFocus={onCloseAutoFocus}
          // The arrows walk from inside the panel too, so a season is read
          // without closing and reopening it — except inside a field, where
          // they are the caret's and a radio group's.
          onKeyDown={(event) => {
            const target = event.target;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
            onWalk(event);
          }}
        >
          {/* A card, not a label: this is the page built for backfilling by
              hand, and people remember a scene before they remember a number.
              The still and the synopsis are each drawn only when stored — a
              blank box or "no synopsis" would be the state of every row
              between a deploy and the backfill, and of any clone with no key. */}
          {still === null ? null : (
            <img
              src={still}
              alt=""
              className="-mx-4 -mt-4 mb-3 aspect-video w-[calc(100%_+_2rem)] max-w-none rounded-t object-cover"
            />
          )}
          <p className="font-medium">{episode.name ?? 'Untitled'}</p>
          <p className="mt-1 font-mono text-[10px] text-dim">{facts.join(' · ')}</p>
          {caveat === null ? null : <p className="mt-1 text-xs text-dim">{caveat}</p>}
          {episode.overview === null ? null : (
            <p className="mt-2 line-clamp-3 text-xs text-dim">{episode.overview}</p>
          )}
          <p className="mt-2 text-xs text-tx">
            {episode.seen
              ? `Watched ${formatWatched(episode.lastWatchedAt, episode.lastWatchedPrecision)}` +
                (rewatched ? `, ${episode.playCount} plays` : '')
              : status === 'unaired'
                ? 'Not out yet'
                : 'Not seen'}
          </p>
          {/* The affirmative action first, and above the hole form: an
              unwatched cell is far more often one this record never heard
              about than one there is a story behind. */}
          {markable ? (
            <div className="mt-3 border-t border-line pt-3">
              {ranged ? (
                <p className="mb-2 text-xs text-dim">
                  Everything from <span className="font-mono text-[10px]">E{rangeFrom}</span>{' '}
                  through this one.
                </p>
              ) : null}
              <MarkWatched
                titleId={titleId}
                scope={
                  ranged
                    ? { season, from: rangeFrom, through: episode.number }
                    : { season, episode: episode.number }
                }
                what={
                  ranged
                    ? `S${season}E${rangeFrom}–E${episode.number}`
                    : `S${season}E${episode.number}`
                }
                onDone={close}
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
                onDone={close}
              />
            </div>
          ) : null}
          {/* A seen episode only gets the form when a stale reason is still on
              it to clear, and nobody but the owner gets it at all: a stranger
              reads the grid from the colours and this popover's facts. */}
          {isOwner && status !== 'unaired' && (!episode.seen || episode.gap) ? (
            <GapForm episode={episode} titleId={titleId} onDone={close} />
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
          className="rounded bg-jade px-3 py-1 text-on-jade enabled:hover:bg-jade-hover enabled:active:bg-jade-press disabled:opacity-50"
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
