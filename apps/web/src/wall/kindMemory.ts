import { isKind, type KindFilter } from './facets.ts';

const KEY = 'engram:kind';

/**
 * The last kind the viewer chose.
 *
 * The URL decides what a screen shows, always: a filter is a place, and the
 * back button has to return to it. Every link that already knows a kind
 * carries it — a card to the title it opens, a row to the next title — so
 * this is read in exactly one place, the rail's HOME, which is the only way
 * back to the wall that has no filter of its own to pass along.
 *
 * Choosing All overwrites with `all` rather than leaving the previous kind in
 * place, which is what stops an old choice coming back. It reads back as "no
 * preference", the same as never having chosen, because that is what it means.
 */

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
