import { type ReactNode, useId } from 'react';

/**
 * One block of the title page under a small uppercase rule.
 *
 * The heading carries an aside on the right — a count, a span of dates —
 * because the design puts the summary of a section in its own header rather
 * than repeating it inside.
 */
export function Section({
  heading,
  aside,
  children,
}: {
  heading: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const id = useId();

  return (
    <section aria-labelledby={id} className="space-y-2.5">
      <h2
        id={id}
        className="flex justify-between gap-2.5 font-mono text-[10px] tracking-[.14em] text-dim uppercase"
      >
        {heading}
        {aside === undefined ? null : <span>{aside}</span>}
      </h2>
      {children}
    </section>
  );
}
