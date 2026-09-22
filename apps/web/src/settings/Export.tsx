import { useSuspenseQuery } from '@tanstack/react-query';
import { exportQuery, recordUrl } from '../api/export.ts';
import { Section } from '../title/Section.tsx';

const LINK =
  'rounded border border-line px-3 py-1.5 text-sm text-dim hover:border-dim hover:text-tx';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function byHand(events: number, manual: number): string {
  if (manual === 0)
    return events === 1 ? 'It was not entered by hand.' : 'None was entered by hand.';
  const one = manual === 1;
  const subject =
    manual === events
      ? one
        ? 'It was'
        : 'All of them were'
      : `${manual} of them ${one ? 'was' : 'were'}`;
  return `${subject} entered by hand, and nothing but your word stands behind ${one ? 'it' : 'them'}.`;
}

/**
 * The record as a file, so it outlives this app the way it outlives Plex.
 *
 * The count of claims entered by hand comes first, before the download: those
 * are the rows only the owner's word stands behind, and the file is where
 * finding them matters, so what is in it is said before it is taken. Every row
 * carries its source, which is how they are found in it.
 */
export function Export() {
  const { data } = useSuspenseQuery(exportQuery);
  const { titles, events, manual } = data;

  return (
    <Section heading="Export">
      {/* Titles and events side by side rather than one "across" the other:
          a title only wanted has no event, and the count includes it. */}
      <p className="text-sm text-dim">
        {count(titles, 'title', 'titles')} and{' '}
        {events === 0 ? 'no events yet.' : `${count(events, 'event', 'events')}.`}
        {events === 0 ? null : ` ${byHand(events, manual)} Each row names its source.`}
      </p>
      <p className="text-sm text-dim">
        The CSV is one row per event. The JSON adds what you said about each title — want, dropped,
        excluded, your note — and the holes you explained.
      </p>
      <div className="flex gap-2">
        <a href={recordUrl('csv')} className={LINK}>
          Download CSV
        </a>
        <a href={recordUrl('json')} className={LINK}>
          Download JSON
        </a>
      </div>
    </Section>
  );
}
