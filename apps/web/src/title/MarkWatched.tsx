import * as Popover from '@radix-ui/react-popover';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { type MarkedWatched, markWatched, titleQuery, type WatchScope } from '../api/titles.ts';

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
  heading,
  hint,
  unit = 'episode',
  onDone,
}: {
  titleId: string;
  scope: WatchScope;
  /** What this will mark, where the panel is not already under a name. */
  heading?: string;
  /** A caveat about the scope, where there is one the heading cannot carry. */
  hint?: string;
  /** What the API counts here: episodes for a show, plays for a film. */
  unit?: 'episode' | 'play';
  onDone?: () => void;
}) {
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [when, setWhen] = useState('');

  const mark = useMutation({
    mutationFn: () => markWatched({ titleId, scope, watchedAt: when }),
    onSuccess: async () => {
      // The wall as well as this page: a mark moves a card's fraction, and can
      // move it from still going to finished.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: titleQuery(titleId).queryKey }),
        queryClient.invalidateQueries({ queryKey: ['titles'] }),
      ]);
      onDone?.();
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
      {heading ? <p className="font-medium">{heading}</p> : null}
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
      {mark.data ? (
        <p role="status" className="text-xs text-dim">
          {describe(mark.data, unit)}
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
function describe({ written, skipped }: MarkedWatched, unit: 'episode' | 'play'): string {
  if (written === 0) {
    return skipped === 1 ? 'Already on record.' : 'All of it was already on record.';
  }
  const marked = `Marked ${written} ${written === 1 ? unit : `${unit}s`}`;
  return skipped === 0 ? `${marked}.` : `${marked}; ${skipped} already on record.`;
}

/**
 * The same form behind a button, for the places that have no popover of their
 * own — a season heading, and the page itself.
 *
 * It deliberately does not close on success: a bulk mark's answer is how much
 * of it was new, and closing the panel would take that away at the moment it
 * is worth reading.
 */
export function MarkWatchedButton({
  label,
  name,
  className,
  complete = false,
  ...form
}: Omit<Parameters<typeof MarkWatched>[0], 'heading'> & {
  label: string;
  /**
   * The accessible name, where the visible one needs the capital a heading
   * wants. It heads the panel too, so an open one still says what it covers.
   */
  name?: string;
  className: string;
  /**
   * Everything in scope is already watched, so the button has no write to
   * offer and goes away.
   */
  complete?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const sentence = name ?? label;

  // Not while its own panel is open, though: the mark that completes the scope
  // is exactly the one whose answer — how much of it was new — is worth
  // reading, and unmounting on success would take that away as it arrived.
  if (complete && !open) return null;

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
          <MarkWatched {...form} heading={sentence} />
          <Popover.Arrow className="fill-line" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
