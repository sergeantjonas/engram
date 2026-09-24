import type { ReactNode } from 'react';
import type { Clause } from './plan.ts';

/**
 * What the two steps after an add share, the one title's backfill and the
 * batch's, so the two cannot drift apart.
 */

/**
 * A row to tick — a season, a title, *All seasons*, a film's *Seen it* — as the
 * mockup lists seasons: on the surface, its name, and a count at the far end,
 * so a column of them reads as things to tick rather than a run of checkboxes.
 */
export function TickRow({
  checked,
  disabled = false,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-3 border border-line bg-surf px-2.5 py-[7px] text-[13px]">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
      {children}
    </label>
  );
}

/**
 * The bar states the write before it happens, which is the only thing
 * standing between a half-remembered decade and 54 rows of it.
 */
export function CommitBar({
  clauses,
  disabled,
  onWrite,
  leave,
  onLeave,
}: {
  clauses: Clause[];
  disabled: boolean;
  onWrite: () => void;
  /** The way out that writes nothing, which is always a valid answer. */
  leave: string;
  onLeave: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 border-t border-line pt-4">
      <p className="font-mono text-[10px] tracking-[.06em] text-dim">
        {clauses.map(({ label, value, carried }, index) => (
          <span key={label}>
            {index > 0 ? ' · ' : null}
            {label}{' '}
            {/* The values in jade, as the mockup picks them out: they are
                what the write will carry. An unreadable date is not one. */}
            <b className={`font-medium ${carried ? 'text-jade' : 'text-gap-tx'}`}>{value}</b>
          </span>
        ))}
      </p>
      <button
        type="button"
        disabled={disabled}
        onClick={onWrite}
        className="rounded bg-jade px-4 py-1.5 text-sm font-medium text-on-jade disabled:opacity-50"
      >
        Write it
      </button>
      <button
        type="button"
        onClick={onLeave}
        className="text-sm text-dim underline-offset-4 hover:text-tx hover:underline"
      >
        {leave}
      </button>
    </div>
  );
}
