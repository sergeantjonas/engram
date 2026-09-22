import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { historyQuery } from '../api/history.ts';
import { markWatched, nextUpQuery, posterUrl, type TmdbCandidate } from '../api/titles.ts';
import { useToast } from '../shell/Toasts.tsx';
import { type BatchEntry, type BatchPlan, describeBatch, markable, planBatch } from './plan.ts';

const count = (n: number, unit: string) => `${n} ${n === 1 ? unit : `${unit}s`}`;

/** A title just added, still carrying the search hit it came from so it can be recognised. */
export interface BatchItem extends BatchEntry {
  candidate: TmdbCandidate;
}

/**
 * Saying what of a batch was already watched, in one pass.
 *
 * Whole-title marks and one shared date, because that is the shape of the
 * thing this screen exists for: three films of a trilogy, seen, some year.
 * Anything finer — which seasons, which date each — is what the title's own
 * page is for, and asking for it here would make a batch worse than adding
 * one at a time.
 */
export function Batch({ items, onDone }: { items: BatchItem[]; onDone: () => void }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const fieldId = useId();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [when, setWhen] = useState('');

  const plan = planBatch(items, chosen, when);
  const tickable = items.filter(markable);
  const everyOne = tickable.length > 0 && tickable.every((item) => chosen.has(item.added.title.id));

  const toggle = (titleId: string) =>
    setChosen((open) => {
      const next = new Set(open);
      if (!next.delete(titleId)) next.add(titleId);
      return next;
    });

  // Outside the mutation, so a failure partway through can say how far it got.
  // Believing nothing landed, the owner would tick again with a different date
  // — and a manual event id carries the date as written, so that writes a
  // second set of plays over what the first pass already claimed.
  const done = useRef(0);

  // The marks as they stood when the write began. A pending mutation is handed
  // the newest render's options, so reporting off `plan` would describe the
  // ticks as they are now rather than the ones that were written.
  const running = useRef<BatchPlan['marks']>([]);

  const commit = useMutation({
    // Sequentially, as the single-title screen marks its seasons: the API
    // orders each expansion to keep concurrent writes off each other's row
    // locks, and firing them together is the one thing that defeats it.
    mutationFn: async () => {
      running.current = plan.marks;
      done.current = 0;
      let written = 0;
      for (const mark of running.current) {
        const result = await markWatched({ titleId: mark.titleId, scope: 'all', watchedAt: when });
        written += result.written;
        done.current += 1;
      }
      return written;
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['titles'] }),
        // Every cached title page at once: the batch touched several, and
        // naming each would be the same call with a longer argument.
        queryClient.invalidateQueries({ queryKey: ['title'] }),
        queryClient.invalidateQueries({ queryKey: nextUpQuery().queryKey }),
        queryClient.invalidateQueries({ queryKey: historyQuery.queryKey }),
      ]),
    onSuccess: (written) => {
      // Titles, not rows: a batch mixes episodes and plays, and the count the
      // API answers with is one number over both.
      toast({
        message:
          written === 0
            ? 'Already on record — nothing new to write.'
            : `Marked ${count(done.current, 'title')}.`,
      });
      onDone();
    },
    // Named, not just counted: the marks are ordered so that a failure partway
    // through can say which title to pick up from.
    onError: (error) => {
      const stopped = running.current[done.current]?.name;
      const where = stopped === undefined ? 'stopped' : `stopped at ${stopped}`;
      toast({
        message:
          done.current === 0
            ? `Nothing written — ${where}: ${error.message}`
            : `Wrote ${count(done.current, 'title')}, then ${where}: ${error.message}`,
      });
    },
  });

  // Nothing ticked is a valid answer — the titles are on the record either way,
  // and "I have not watched them" is a reason to add them.
  const blocked = plan.marks.length === 0 || plan.precision === null;

  return (
    <section aria-label="What you have already watched" className="space-y-4">
      <h1 className="text-2xl font-semibold">
        {count(items.length, 'title')} on the record. Seen any of them?
      </h1>

      <ul className="space-y-1">
        {tickable.length > 1 ? (
          <li className="pb-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={everyOne}
                disabled={commit.isPending}
                onChange={() =>
                  setChosen((open) => {
                    const next = new Set(open);
                    for (const item of tickable) {
                      if (everyOne) next.delete(item.added.title.id);
                      else next.add(item.added.title.id);
                    }
                    return next;
                  })
                }
              />
              <span className="font-medium">All of them</span>
            </label>
          </li>
        ) : null}
        {items.map((item) => (
          <li key={item.added.title.id}>
            <TitleCheck
              item={item}
              checked={chosen.has(item.added.title.id)}
              // Frozen while the write runs, so what the bar states and what
              // the toast counts stay the thing that was committed.
              disabled={commit.isPending}
              onChange={() => toggle(item.added.title.id)}
            />
          </li>
        ))}
      </ul>

      <div className="space-y-1">
        <label htmlFor={fieldId} className="block text-xs text-dim">
          When? One date for all of them — leave it blank if you don’t remember.
        </label>
        <input
          id={fieldId}
          value={when}
          disabled={commit.isPending}
          placeholder="2019, 2019-06 or 2019-06-14"
          onChange={(event) => setWhen(event.target.value)}
          className="w-64 rounded border border-line bg-bg px-2 py-1 font-mono text-xs"
        />
      </div>

      {/* The bar states the write before it happens, which is the only thing
          standing between a half-remembered decade and 54 rows of it. */}
      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4">
        <p className="font-mono text-[10px] tracking-[.06em] text-dim">{describeBatch(plan)}</p>
        <button
          type="button"
          disabled={blocked || commit.isPending}
          onClick={() => commit.mutate()}
          className="rounded bg-jade px-4 py-1.5 text-sm text-on-jade disabled:opacity-50"
        >
          Write it
        </button>
        <button
          type="button"
          onClick={onDone}
          className="text-sm text-dim underline-offset-4 hover:text-tx hover:underline"
        >
          Nothing yet — back to the search
        </button>
      </div>
    </section>
  );
}

function TitleCheck({
  item,
  checked,
  disabled,
  onChange,
}: {
  item: BatchItem;
  checked: boolean;
  disabled: boolean;
  onChange: () => void;
}) {
  const poster = posterUrl(item.candidate.posterPath);
  const can = markable(item);
  const episodes = item.added.seasons
    .filter((season) => season.season !== 0)
    .reduce((total, season) => total + season.episodeCount, 0);

  return (
    <label className="flex items-center gap-3 text-sm">
      <input type="checkbox" checked={checked} disabled={!can || disabled} onChange={onChange} />
      <span className="w-8 shrink-0 overflow-hidden rounded bg-surf">
        {poster ? (
          <img src={poster} alt="" loading="lazy" className="aspect-2/3 size-full object-cover" />
        ) : (
          <span className="block aspect-2/3" />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.added.title.name}</span>
      <span className="shrink-0 font-mono text-[10px] text-faint">
        {can
          ? item.kind === 'movie'
            ? '1 play'
            : count(episodes, 'episode')
          : 'no seasons on record'}
      </span>
    </label>
  );
}
