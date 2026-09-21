import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import {
  type MarkedWatched,
  markUnwatched,
  markWatched,
  titleQuery,
  type WatchScope,
} from '../api/titles.ts';
import { useToast } from '../shell/Toasts.tsx';

/** What the API counts in a given scope: episodes for a show, plays for a film. */
type Unit = 'episode' | 'play';

const count = (n: number, unit: Unit) => `${n} ${n === 1 ? unit : `${unit}s`}`;

/**
 * Retractions are counted in plays, never in episodes.
 *
 * A mark writes one event per episode, so counting what it wrote in episodes
 * is honest; what is on record accumulates across marks, and an episode marked
 * as "2019" and again as "2020" carries two of them. "Take back 2 episodes"
 * inside one episode's own popover is simply false.
 */
const plays = (n: number) => count(n, 'play');

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Refetches what a write to this title changed.
 *
 * The wall as well as the page: a mark moves a card's fraction, and can move it
 * from still going to finished.
 */
function useSettle(titleId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: titleQuery(titleId).queryKey }),
      queryClient.invalidateQueries({ queryKey: ['titles'] }),
    ]);
}

/**
 * Recording something watched long before this record existed, which is the
 * half of the history Plex cannot supply.
 *
 * The date is one free-text field rather than a picker. What a viewer has is
 * "2019", sometimes "June 2019" and almost never a day, and a picker would
 * make them fill in the parts they do not remember; the API reads the
 * precision off the shape of what was typed, so `2019` is stored as a year
 * rather than as the first of January. Blank is the ordinary answer.
 */
export function MarkWatched({
  titleId,
  scope,
  what,
  hint,
  unit = 'episode',
  onDone,
}: {
  titleId: string;
  scope: WatchScope;
  /** What the scope is, in words: "season 2", "S2E5", "the whole run". */
  what: string;
  /** A caveat about the scope, where there is one the heading cannot carry. */
  hint?: string;
  unit?: Unit;
  onDone?: () => void;
}) {
  const settle = useSettle(titleId);
  const toast = useToast();
  const fieldId = useId();
  const [when, setWhen] = useState('');

  const mark = useMutation({
    mutationFn: () => markWatched({ titleId, scope, watchedAt: when }),
    onSuccess: async (result) => {
      await settle();
      // Closed, then said elsewhere. The answer is about the record rather
      // than about this panel, and a panel kept open to report its own result
      // is one the viewer then has to dismiss by hand.
      onDone?.();
      toast({
        message: describe(result, unit, what, oneEpisode(scope)),
        // Only where something was actually written. Nothing to take back is
        // not an undo, it is a second way to remove the marks already there.
        ...(result.written === 0
          ? {}
          : {
              action: {
                label: 'Undo',
                run: async () => {
                  // Caught here rather than left to float: the notice that
                  // offered this is already gone, so a rejection nobody
                  // reports reads on screen as a retraction that worked.
                  try {
                    const { removed } = await markUnwatched({ titleId, scope });
                    await settle();
                    toast({ message: `Took back ${plays(removed)}.` });
                  } catch (error) {
                    toast({ message: `Could not undo that: ${reason(error)}` });
                  }
                },
              },
            }),
      });
    },
  });

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        mark.mutate();
      }}
    >
      {hint ? <p className="text-xs text-faint">{hint}</p> : null}
      <label htmlFor={fieldId} className="block text-xs text-dim">
        When? Leave it blank if you don’t remember.
      </label>
      <input
        id={fieldId}
        value={when}
        placeholder="2019, 2019-06 or 2019-06-14"
        onChange={(event) => setWhen(event.target.value)}
        className="w-full rounded border border-line bg-bg px-2 py-1 font-mono text-xs"
      />
      {mark.error ? (
        <p role="alert" className="text-xs text-gap-tx">
          {mark.error.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={mark.isPending}
        className="rounded bg-jade px-3 py-1 text-sm text-on-jade disabled:opacity-50"
      >
        Mark watched
      </button>
    </form>
  );
}

/**
 * How much of the mark was new, which matters because the write is idempotent:
 * pressing this twice is safe, and saying so is the difference between "that
 * did nothing" and "that was already true".
 */
function describe(
  { written, skipped }: MarkedWatched,
  unit: Unit,
  what: string,
  single: boolean,
): string {
  // One episode is a thing, not a scope things are inside: "marked 1 episode
  // in S2E5" is the sentence a scope-shaped message produces there.
  if (single) return written === 0 ? `${what} was already on record.` : `Marked ${what} watched.`;
  if (written === 0) return `All of ${what} was already on record.`;

  const marked = `Marked ${count(written, unit)} in ${what}`;
  return skipped === 0 ? `${marked}.` : `${marked}; ${skipped} already on record.`;
}

const oneEpisode = (scope: WatchScope) => scope !== 'all' && scope.episode !== undefined;

/**
 * Taking a mark back, for the misclick that is found later rather than while
 * the notice is still up.
 *
 * Offered only where this record was told something by hand. A play Plex
 * reported is not this record's to delete, and a button implying otherwise
 * would be lying about what it does.
 */
export function TakeBack({
  titleId,
  scope,
  entered,
  onDone,
}: {
  titleId: string;
  scope: WatchScope;
  /** How many hand-entered plays are in scope. Rendered only when above zero. */
  entered: number;
  onDone?: () => void;
}) {
  const settle = useSettle(titleId);
  const toast = useToast();

  const retract = useMutation({
    mutationFn: () => markUnwatched({ titleId, scope }),
    onSuccess: async ({ removed }) => {
      await settle();
      onDone?.();
      toast({ message: `Took back ${plays(removed)}.` });
    },
  });

  if (entered === 0) return null;

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={retract.isPending}
        onClick={() => retract.mutate()}
        className="rounded border border-line px-3 py-1 text-sm text-dim hover:border-gap hover:text-gap-tx disabled:opacity-50"
      >
        Take back {plays(entered)} entered by hand
      </button>
      {retract.error ? (
        <p role="alert" className="text-xs text-gap-tx">
          {retract.error.message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The form behind a button, for the places that have no popover of their own —
 * a season heading, and the page itself.
 */
export function MarkWatchedButton({
  label,
  className,
  complete = false,
  ...form
}: Omit<Parameters<typeof MarkWatched>[0], 'onDone'> & {
  label: string;
  className: string;
  /** Everything in scope is watched, so there is no write left to offer. */
  complete?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sentence = `Mark ${form.what} watched`;

  // Nothing to offer once everything in scope is watched; the way back from
  // there is the undo, not this.
  if (complete) return null;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger aria-label={sentence} className={className}>
        {label}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={16}
          className="w-72 rounded border border-line bg-surf p-4 text-sm text-tx shadow-lg"
        >
          <p className="mb-2 font-medium">{sentence}</p>
          <MarkWatched {...form} onDone={() => setOpen(false)} />
          <Popover.Arrow className="fill-line" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
