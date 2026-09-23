# Add search

**Status:** In progress — chunk 1 landed 2026-09-23, not yet deployed.
Scoped 2026-09-23 from a review of `/add` against what TMDB's search
endpoints accept. Seven chunks, one commit each, in order; chunk 7 is
optional. No chunk carries a migration.

`/add` found a title by name and nothing else. `GET /search` sent TMDB's
`/search/multi` a `query` and no other parameter, so every search was one page
of twenty mixed rows, people included until they were dropped after the page
arrived. There was no way to say *the film*, no way to say *the 1984 one*, and
there is still no way to see a twenty-first result. A remake, a franchise or a
common word buries the title being looked for, and the only way out is
guessing a better query. The search itself is `TmdbClient.search`
([client.ts:294](../../apps/api/src/tmdb/client.ts#L294)).

## Constraints that carry over

- [web-design.md](web-design.md) § 03 · Add watched holds: two steps, season
  checkboxes, a commit bar that states the write, results the record holds
  counted and held back, bulk add as whole-title ticks against one date.
- **The query is a place.** Everything that narrows a search goes in the URL
  and `validateSearch` answers every key, as the wall's does — a key left out
  keeps its raw value.
- **Every TMDB miss is production's key.** Results stay cached five minutes,
  a just-added title is patched into the results rather than refetched, and
  nothing fans out.
- **Errors never echo.** A TMDB failure is answered with its status only; the
  key rides in the request URL.

## What TMDB offers

Checked 2026-09-23 against TMDB's reference; endpoints marked *reference only*
are verified against a live key by the chunk that first calls them.

| Endpoint | Takes | Used by |
|---|---|---|
| `/search/multi` | `query`, `page` — no year | All |
| `/search/movie` | `query`, `page`, `year`, `primary_release_year`, `region` | chunks 1–2 |
| `/search/tv` | `query`, `page`, `year`, `first_air_date_year` | chunks 1–2 |
| `/find/{id}` | `external_source=imdb_id` (reference only) | chunk 5 |
| `/search/collection` | `query`, `page` (reference only) | chunk 6 |

Two year parameters each, and the difference matters. A film's `year` matches
any release — a re-release, another country's date — where
`primary_release_year` matches the one release the film is known by. A
series' `year` matches its first air date *or any episode's*, so `year=2015`
finds every show that aired an episode that year; `first_air_date_year` is the
one that tells two shows of the same name apart.

Per-kind rows carry no `media_type`, the field a `/search/multi` row's kind is
read from, so `candidateOf`
([client.ts:215](../../apps/api/src/tmdb/client.ts#L215)) takes a narrowed
row's kind from the search it came back from. A series
row carries `origin_country` and `original_name`; a film row carries
`original_title` and `original_language` and no country.

**Rate limit.** TMDB's documented limit sits "somewhere in the 40 requests per
second range" and answers `429` past it; the old 40-per-10-seconds limit was
switched off 2019-12-16, and there is no daily quota. One owner searching is
nowhere near it. The key is spent carefully here because it is the owner's and
TMDB asks for restraint, not because a search could exhaust it.

## Settled

- **2026-09-23 — `/add` opens on All and ignores the wall's remembered kind.**
  [kindMemory.ts](../../apps/web/src/wall/kindMemory.ts) is read in exactly one
  place, the rail's HOME, and choosing a kind on `/add` does not write it: what
  the owner is searching TMDB for says nothing about how they read the wall.
- **2026-09-23 — A kind switches endpoint; it never filters a page.** Hiding
  series from a `/search/multi` page leaves however many films were on it, and
  the films on pages two and three are never asked for.
- **2026-09-23 — A year needs a kind.** `/search/multi` takes none. `year`
  without `kind` is a 400, and the year field exists only beside a kind — a
  field that did nothing under All would break the rule that a control which
  does nothing is worse than none. Asking both per-kind endpoints and merging
  by popularity costs two calls a search and leaves no single page to ask for
  next.

## Chunk 1 · Kind and year

Landed 2026-09-23. `GET /search` takes `kind` (`show` | `movie`) and `year`
(TMDB's accepted 1000–9999, refused without a kind). `TmdbClient.search` takes
both as one optional filter, so a year without a kind cannot be expressed
below the route either: `show` asks `/search/tv` with `first_air_date_year`,
`movie` asks `/search/movie` with `primary_release_year`, no filter asks
`/search/multi`. `candidateOf` takes the kind from the search when the row
carries no `media_type`.

On `/add`, the wall's kind control — All / Series / Movies, its chip classes
moved to `wall/chips.ts` so both screens draw one control — and a year field,
both inside the search bar and in the URL as `?kind=&year=`. The bar is the
mockup's — the `TMDB` label, then the kind beside it — and Search is a quiet
chip rather than jade (see [web-design.md](web-design.md) § 03). A kind is a
link, so it searches again at once over the query already in the URL; All
drops the year, and `validateSearch` drops a year that arrives without a kind
rather than sending it to be refused. The year field is labelled *First
aired* or *Released* by kind, and anything in it but a four-digit year
disables Search rather than being quietly left out. Switching kind keeps a
query typed and not yet searched for; a new query, kind or year clears the
selection, which belongs to the results it was made over. A title added is patched into every cached
search rather than only the one it was added from, since the same query under
All or the other kind holds the same candidate for five minutes and would
offer it again. The empty answer names what narrowed it — "TMDB has nothing
for “dune” among series first aired in 1984."

## Chunk 2 · More from TMDB

`GET /search` takes `page` and answers `{ results, page, hasMore }`, `hasMore`
from TMDB's `total_pages`. `limit` goes: slicing inside a page would skip the
rows between it and the next one, and nothing in `apps/web` passes it.

On the web, `useInfiniteQuery` and a *More from TMDB* button under the list —
a button rather than scroll-loading, because every page is a call and the
sticky commit bar sits at the bottom where a scroll trigger would be.
Flattening dedupes on `candidateKey`, since popularity can move a title from
one page to the next between calls. The held-back count covers every loaded
page, and a selection lives across the pages of one search.

## Chunk 3 · Tell look-alikes apart

The candidate carries `originCountry` (series only) and `originalName` when it
differs from the display name, both from the row already fetched. The row's
meta line draws `GB · 2001 · SERIES` and the original name under the title, so
*The Office* from 2001 and from 2005 stop being two identical rows with
different years. Null draws nothing.

## Chunk 4 · Want from the results

Every candidate the record does not hold gets *Want* beside *Add*:
`POST /titles`, then `setIntent(id, { want: true })`. Nothing was watched, so
nothing opens the backfill screen — the row moves into the held-back group as
an add does, and a toast names the title. The batch bar offers both verbs over
one selection, sequential like the batch add.

The two writes are not one transaction. A failure between them leaves the
title stored and not wanted, which is reported as exactly that; both writes
are idempotent (`POST /titles` answers 200 for a stored title), so the retry
is the same button.

## Chunk 5 · Paste an id or a link

An IMDb id (`tt0903747`), an IMDb title URL or a themoviedb.org
`/movie/603` or `/tv/1396` URL answers with the one title it names. The parser
belongs in `packages/shared` next to `parseGuid`: identity is external, and
the browser may want the same test later. `/search` detects it itself, so the
answer is still a candidate list and the screen changes nothing but its
placeholder. A TMDB URL costs a details call; an IMDb id costs `/find`. An
IMDb id naming an episode resolves to its show or answers nothing — decided
in the chunk, once `/find` has been looked at with a live key.

## Chunk 6 · A collection in one tick

A *Collections* chip searches `/search/collection`; picking one asks
`/collection/{id}` — the call `backfill:metadata` already makes — and lists
its parts as film candidates, all ticked, straight into the bulk add. A chip
rather than collections mixed into every film search, so an ordinary search
stays one call. A collection is not a `TitleKind`, so `kind` either widens or
a separate parameter carries it; decided in the chunk.

## Chunk 7 · Search as the owner types (optional)

Quota is not what stands in the way; the rate above allows it many times
over, and with a 300ms debounce, a three-character floor and the five-minute
cache, typing "breaking bad" costs a handful of calls. What does:

- **The selection is cleared whenever `q`, `kind` or `year` changes**
  ([add.tsx:93](../../apps/web/src/routes/add.tsx#L93)). Fixing a typo after
  ticking two titles would drop both. The selection has to outlive a query
  change, which `picked` already makes safe — it only adds ticks the current
  results show.
- **History.** Every debounced navigation is an entry unless it replaces, and
  Back should return to the last search, not the last keystroke: replace while
  typing, push on Enter.
- **Flicker.** "Searching…" replaces the list today. The previous results have
  to stay up while the next query loads (`placeholderData`).
- **Superseded requests run to the end.** `searchQuery` does not forward
  TanStack's `signal`. Harmless for correctness — answers are keyed by query —
  but a request the owner typed past still spends a call.

## Not planned

Trending on the empty screen (`/trending/{movie|tv}/week`) — useful for new
releases, one call per visit. Finding everything by a person, which is a
person search, their combined credits and a dedupe. Reading a year out of the
query text, which breaks on *1917*, *2012* and *Blade Runner 2049*.
