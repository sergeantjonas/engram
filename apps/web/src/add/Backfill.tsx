import { useMutation } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { type AddedSeason, type AddedTitle, markWatched } from '../api/titles.ts';
import { useToast } from '../shell/Toasts.tsx';
import { useSettle } from '../title/settle.ts';
import { describePlan, planFilm, planSeasons } from './plan.ts';

const SPECIALS = 0;

const count = (n: number, unit: string) => `${n} ${n === 1 ? unit : `${unit}s`}`;

/**
 * Saying what of a newly added title was already watched, in the same visit.
 *
 * Season-level rather than episode-level, and that is the whole point of the
 * screen: backfilling a decade of television one episode at a time is how a
 * feature like this quietly never gets used.
 */
export function Backfill({
  added,
  kind,
  onCommitted,
}: {
  added: AddedTitle;
  kind: 'show' | 'movie';
  onCommitted: () => void;
}) {
  const toast = useToast();
  const settle = useSettle(added.title.id);
  const fieldId = useId();
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const [seen, setSeen] = useState(false);
  const [when, setWhen] = useState('');

  const film = kind === 'movie';
  const unit = film ? 'play' : 'episode';
  const regular = added.seasons.filter((season) => season.season !== SPECIALS);
  const plan = film ? planFilm(seen, when) : planSeasons(added.seasons, chosen, when);
  const everyRegular = regular.length > 0 && regular.every((s) => chosen.has(s.season));

  const toggle = (season: number) =>
    setChosen((open) => {
      const next = new Set(open);
      if (!next.delete(season)) next.add(season);
      return next;
    });

  // Outside the mutation, so a failure partway through can say how far it got.
  // Believing nothing landed, the owner would tick again with a different date
  // — and a manual event id carries the date as written, so that writes a
  // second set of plays over the episodes the first pass already claimed.
  const done = useRef(0);

  const commit = useMutation({
    // Sequentially, not in parallel: the API orders each expansion to keep
    // concurrent writes off each other's row locks, and firing them together
    // is the one thing that defeats it.
    mutationFn: async () => {
      done.current = 0;
      for (const scope of plan.scopes) {
        const result = await markWatched({ titleId: added.title.id, scope, watchedAt: when });
        done.current += result.written;
      }
      return done.current;
    },
    onSuccess: async (written) => {
      await settle();
      toast({
        message:
          written === 0
            ? `${added.title.name} was already on record.`
            : `Marked ${count(written, unit)} of ${added.title.name}.`,
      });
      onCommitted();
    },
    onError: async (error) => {
      await settle();
      toast({
        message:
          done.current === 0
            ? `Could not write that: ${error.message}`
            : `Wrote ${count(done.current, unit)}, then stopped: ${error.message}`,
      });
    },
  });

  // Nothing ticked is a valid answer — the title is on the record either way,
  // and "I have not watched it" is a reason to add one.
  const blocked = plan.writes === 0 || plan.precision === null;

  return (
    <section aria-label="What you have already watched" className="space-y-4">
      {/* The heading for this step: it stands in place of the search rather
          than under it. */}
      <h1 className="text-2xl font-semibold">
        {added.title.name} is on the record. Seen any of it?
      </h1>

      {film ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={seen} onChange={() => setSeen(!seen)} />
          <span>Seen it</span>
        </label>
      ) : added.seasons.length === 0 ? (
        <p className="text-dim">It has no seasons on record, so there is nothing to mark.</p>
      ) : (
        <ul className="space-y-1">
          {regular.length > 1 ? (
            <li>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={everyRegular}
                  // Specials are left out of "all seasons" the way they are
                  // left out of a whole-title mark; they are ticked by name.
                  onChange={() =>
                    setChosen((open) => {
                      const next = new Set(open);
                      for (const season of regular) {
                        if (everyRegular) next.delete(season.season);
                        else next.add(season.season);
                      }
                      return next;
                    })
                  }
                />
                <span className="font-medium">All seasons</span>
              </label>
            </li>
          ) : null}
          {added.seasons.map((season) => (
            <li key={season.season}>
              <SeasonCheck
                season={season}
                checked={chosen.has(season.season)}
                onChange={() => toggle(season.season)}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-1">
        <label htmlFor={fieldId} className="block text-xs text-dim">
          When? Leave it blank if you don’t remember.
        </label>
        <input
          id={fieldId}
          value={when}
          placeholder="2019, 2019-06 or 2019-06-14"
          onChange={(event) => setWhen(event.target.value)}
          className="w-64 rounded border border-line bg-bg px-2 py-1 font-mono text-xs"
        />
      </div>

      {/* The bar states the write before it happens, which is the only thing
          standing between a half-remembered decade and 54 rows of it. */}
      <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4">
        <p className="font-mono text-[10px] tracking-[.06em] text-dim">
          {describePlan(plan, unit)}
        </p>
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
          onClick={onCommitted}
          className="text-sm text-dim underline-offset-4 hover:text-tx hover:underline"
        >
          Nothing yet — open the title
        </button>
      </div>
    </section>
  );
}

function SeasonCheck({
  season,
  checked,
  onChange,
}: {
  season: AddedSeason;
  checked: boolean;
  onChange: () => void;
}) {
  const name = season.season === SPECIALS ? 'Specials' : `Season ${season.season}`;
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{name}</span>
      <span className="font-mono text-[10px] text-dim">
        {count(season.episodeCount, 'episode')}
      </span>
    </label>
  );
}
