import type { TitleKind } from './ids.js';

/**
 * A title named outright rather than searched for: an IMDb id, or a TMDB page.
 *
 * An IMDb id carries no kind — `tt0903747` is a series and `tt0133093` a film,
 * and nothing in the id says which — so only TMDB can say what it names. A
 * TMDB page does carry one, in its path, because TMDB numbers films and series
 * separately and the id alone would name two things.
 */
export type TitleReference =
  | { source: 'imdb'; id: string }
  | { source: 'tmdb'; kind: TitleKind; id: string };

const IMDB_ID = /^tt\d{7,}$/i;
// `imdb.com/title/…` and its localised `imdb.com/de/title/…`, on any subdomain.
const IMDB_PAGE = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*imdb\.com\/(?:[a-z-]+\/)?title\/(tt\d{7,})/i;
// TMDB puts the language in the query string, never in the path.
const TMDB_PAGE = /^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*themoviedb\.org\/(movie|tv)\/(\d+)/i;

/**
 * The title a pasted id or link names, or null for anything that is a search.
 *
 * Only the whole input counts: text with a space in it is a query that
 * happens to mention a link, and searching it is what was asked for.
 */
export function parseTitleReference(input: string): TitleReference | null {
  const text = input.trim();
  if (text === '' || /\s/.test(text)) return null;

  if (IMDB_ID.test(text)) return { source: 'imdb', id: text.toLowerCase() };

  const imdb = IMDB_PAGE.exec(text);
  if (imdb?.[1]) return { source: 'imdb', id: imdb[1].toLowerCase() };

  const tmdb = TMDB_PAGE.exec(text);
  if (tmdb?.[1] && tmdb[2]) {
    return { source: 'tmdb', kind: tmdb[1].toLowerCase() === 'tv' ? 'show' : 'movie', id: tmdb[2] };
  }

  return null;
}
