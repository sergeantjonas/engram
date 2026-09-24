import { Link } from '@tanstack/react-router';
import type { Collection as CollectionData, CollectionPart } from '../api/titles.ts';
import { posterUrl } from '../api/titles.ts';
import { Tip } from '../shell/Tooltip.tsx';
import type { KindFilter } from '../wall/facets.ts';
import { STATE_BAR, STATE_LABEL } from '../wall/TitleCard.tsx';
import { Section } from './Section.tsx';

/**
 * The film series a film belongs to, where a show's grid would be.
 *
 * Tiles like the wall's, state bar included, because a part on record is a
 * title on the wall and should read as one. A sibling not on record is drawn
 * too — the collection is a fact about the film, and the page saying "there
 * are two more" is the point — faded, with no bar, and its link goes to the
 * add screen with the name filled in rather than to a page that does not
 * exist. The one being read is marked and not linked to itself.
 */
export function Collection({
  collection,
  currentId,
  kind,
}: {
  collection: CollectionData;
  currentId: string;
  kind: KindFilter | undefined;
}) {
  const onRecord = collection.parts.filter((part) => part.title !== null).length;
  return (
    <Section
      heading={collection.name}
      aside={`${onRecord} of ${collection.parts.length} on record`}
    >
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-[13px]">
        {collection.parts.map((part) => (
          <li key={part.tmdbId}>
            <Part part={part} current={part.title?.id === currentId} kind={kind} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Part({
  part,
  current,
  kind,
}: {
  part: CollectionPart;
  current: boolean;
  kind: KindFilter | undefined;
}) {
  const poster = posterUrl(part.posterPath);
  const label = part.title === null ? 'Not on record' : STATE_LABEL[part.title.state];
  const tile = (
    <>
      <div
        className={`aspect-2/3 overflow-hidden rounded-t bg-surf ${
          part.title === null ? 'opacity-50' : ''
        }`}
      >
        {poster ? (
          <img src={poster} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center p-3 text-center text-xs text-faint">
            {part.name}
          </span>
        )}
      </div>
      <span className={`block h-[3px] ${part.title === null ? '' : STATE_BAR[part.title.state]}`} />
    </>
  );

  return (
    // The ringed tile has no link to carry its name and state, so the article
    // says them: the bar alone is colour.
    <article aria-current={current ? 'page' : undefined} aria-label={`${part.name}, ${label}`}>
      {current ? (
        <div className="rounded-t ring-2 ring-dim">{tile}</div>
      ) : part.title !== null ? (
        <Link
          to="/titles/$id"
          params={{ id: part.title.id }}
          search={kind ? { kind } : {}}
          aria-label={`${part.name}, ${label}`}
          className="block rounded-t hover:ring-2 hover:ring-dim"
        >
          {tile}
        </Link>
      ) : (
        <Link
          to="/add"
          search={{ q: part.name }}
          aria-label={`${part.name}, ${label}`}
          className="block rounded-t hover:ring-2 hover:ring-dim"
        >
          {tile}
        </Link>
      )}
      <div className="mt-1.5 flex min-h-[30px] items-start justify-between gap-2">
        {/* Whole: inside a collection the part after the colon is the only
            thing that tells the tiles apart. */}
        <Tip label={part.name}>
          <h3 className="line-clamp-2 text-xs leading-tight font-medium">{part.name}</h3>
        </Tip>
        {part.year !== null ? (
          <span className="shrink-0 font-mono text-[10px] text-dim">{part.year}</span>
        ) : null}
      </div>
      {part.title === null ? (
        <p className="mt-0.5 text-[10px] text-dim">{label.toLowerCase()}</p>
      ) : null}
    </article>
  );
}
