import { isKind, type KindFilter } from './facets.ts';

const KEY = 'engram:kind';

/**
 * The last kind the viewer chose, remembered across screens.
 *
 * The URL stays the source of truth for a screen that names a kind — a filter
 * is a place, and the back button has to return to it. This is only consulted
 * when an address names none, which is what happens on every arrival from the
 * rail or from a link written before the choice existed. Without it, picking
 * Movies and then opening a title drops you back into the whole library.
 *
 * `all` is stored rather than cleared, and that distinction is the whole
 * mechanism: "not chosen" has to be different from "chosen everything", or
 * choosing All would be undone by the very default it just overrode, and the
 * two would redirect at each other.
 */
export type RememberedKind = KindFilter | 'all';

/** Storage is absent in a private window and throws rather than returning null. */
export function rememberKind(kind: KindFilter | undefined): void {
  try {
    localStorage.setItem(KEY, kind ?? 'all');
  } catch {
    // A viewer who has turned storage off gets the default every time, which
    // is the behaviour this replaces rather than something worse.
  }
}

/** The kind an address that names none should open on, if there is one. */
export function preferredKind(): KindFilter | undefined {
  try {
    const stored = localStorage.getItem(KEY);
    return isKind(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}
