import { useMutation } from '@tanstack/react-query';
import { type Intent, setIntent } from '../api/titles.ts';
import { useToast } from '../shell/Toasts.tsx';
import { useSettle } from './settle.ts';

/**
 * What the viewer wants of a title, which is the thing Plex cannot express at
 * all: it knows what was played and nothing about what was meant.
 *
 * Three independent flags rather than one state. They look mutually exclusive
 * and are not — a show can be one you meant to get to and then gave up on, and
 * collapsing that into a single value would make the record forget the first
 * half of it.
 */
const FLAGS: { key: keyof Intent; label: string; on: string }[] = [
  { key: 'want', label: 'Want to watch', on: 'border-jade bg-jade/10 text-jade' },
  { key: 'dropped', label: 'Dropped', on: 'border-drift bg-drift/10 text-drift' },
  // The word the rest of the interface already uses for this flag — the tile
  // prints it and the chip row offers to show or hide by it. Clearer labels
  // exist, but a third name for one thing is worse than a plain one.
  { key: 'excluded', label: 'Excluded', on: 'border-gap bg-gap/10 text-gap-tx' },
];

// Pressed carries a fill as well as a hue: the three colours differ from this
// one only in tone, which is not a difference everyone can see.
const OFF = 'border-line text-dim hover:border-dim hover:text-tx';

export function IntentControls({ titleId, intent }: { titleId: string; intent: Intent }) {
  const settle = useSettle(titleId);
  const toast = useToast();

  const change = useMutation({
    // Key and value as separate arguments rather than a computed-key object
    // literal: TypeScript checks neither the key nor the value inside one, so
    // `{ [key]: 'yes' }` would satisfy `Partial<Intent>` and compile.
    mutationFn: ({ key, value }: { key: keyof Intent; value: boolean }) =>
      setIntent(titleId, { [key]: value }),
    onSuccess: settle,
    // The button's own pressed state is the answer when this works, so only
    // the failure needs saying — and it needs saying, or the toggle springs
    // back on the refetch with no account of why.
    onError: (error) => toast({ message: `Could not save that: ${error.message}` }),
  });

  return (
    <>
      {FLAGS.map(({ key, label, on }) => (
        <button
          key={key}
          type="button"
          aria-pressed={intent[key]}
          disabled={change.isPending}
          onClick={() => change.mutate({ key, value: !intent[key] })}
          className={`rounded border px-3 py-1.5 text-sm disabled:opacity-50 ${
            intent[key] ? on : OFF
          }`}
        >
          {label}
        </button>
      ))}
    </>
  );
}
