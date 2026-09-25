import type { ReactNode } from 'react';
import { backdropUrl, posterUrl } from '../api/titles.ts';
import { Cover } from '../shell/Cover.tsx';

/**
 * Which slots the strip's width has room for, by the strip's own width rather
 * than the window's, since the rail and the page's gutter take a share of it.
 * A slot is drawn at 300px or more, so the fourth waits for 1280px; the first
 * is always there, which is what a phone sees.
 */
export const SLOT = ['', 'hidden @2xl:block', 'hidden @5xl:block', 'hidden @7xl:block'] as const;

/** The band above the chips: a landmark over one row of cards, where a card on its own fills the row. */
export function Band({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="@container space-y-1.5">
      {/* The region's name already says it to anything reading the page. */}
      <p aria-hidden="true" className="font-mono text-[9px] tracking-[.08em] text-dim">
        {label.toUpperCase()}
      </p>
      <ul className="flex gap-3">{children}</ul>
    </section>
  );
}

/**
 * A band's card: the title's backdrop behind it, its poster or the generated
 * cover beside the lines it is given.
 *
 * The artwork is keyed by `artKey`, so a card whose slot is taken by another
 * title never sits beside the one it replaced while its own loads.
 */
export function BandCard({
  artKey,
  name,
  posterPath,
  backdropPath,
  children,
}: {
  artKey: string;
  name: string;
  posterPath: string | null;
  backdropPath: string | null;
  children: ReactNode;
}) {
  const backdrop = backdropUrl(backdropPath, 'w780');
  const poster = posterUrl(posterPath);

  return (
    <div className="relative isolate h-full overflow-hidden rounded border border-line bg-surf">
      {backdrop ? (
        // Half-strength under a scrim that holds at 80% from the middle on: a
        // compact card runs its text to the right edge, where its action sits,
        // and every line has to clear 4.5:1 over whatever the still holds.
        <div
          key={artKey}
          aria-hidden="true"
          style={{ backgroundImage: `url(${backdrop})` }}
          className="absolute inset-0 -z-10 bg-cover bg-[center_30%] opacity-50 after:absolute after:inset-0 after:bg-gradient-to-r after:from-bg after:via-bg/85 after:to-bg/80"
        />
      ) : null}

      <div className="flex items-start gap-4 p-3">
        {poster ? (
          <img
            key={artKey}
            src={poster}
            alt=""
            className="h-[52px] w-[35px] shrink-0 rounded-sm object-cover"
          />
        ) : (
          <Cover name={name} bare className="h-[52px] w-[35px] shrink-0 rounded-sm" />
        )}

        <div className="min-w-0 flex-1 space-y-0.5">{children}</div>
      </div>
    </div>
  );
}
