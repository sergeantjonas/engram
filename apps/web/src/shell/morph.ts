/**
 * Opening a title from the wall grows its tile into the title page's poster
 * rather than cutting to it: both carry `data-morph`, which the stylesheet
 * turns into one `view-transition-name`, so the browser draws them as one
 * element moving.
 *
 * Only the tile being opened carries it, and it is moved rather than added.
 * A name on every card would have the browser capture the whole wall for one
 * morph, and two elements holding it at once abort the transition outright —
 * which a second click before the first title has loaded would otherwise do.
 */
let marked: Element | null = null;

export function markMorph(element: Element | null) {
  marked?.removeAttribute('data-morph');
  marked = element;
  element?.setAttribute('data-morph', '');
}
