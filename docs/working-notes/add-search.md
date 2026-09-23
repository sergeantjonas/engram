# Add search

**Status:** Built 2026-09-24 — chunks 1 to 6 landed 2026-09-23 and chunk 7 on 2026-09-24; none of it deployed yet.
Scoped 2026-09-23 from a review of `/add` against what TMDB's search
endpoints accept. Seven chunks, one commit each, in order. No chunk carries a
migration.

`/add` found a title by name and nothing else. `GET /search` sent TMDB's
`/search/multi` a `query` and no other parameter, so every search was one page
of twenty mixed rows, people included until they were dropped after the page
arrived. There was no way to say *the film*, no way to say *the 1984 one*, and
no way to see a twenty-first result. A remake, a franchise or a common word
buried the title being looked for, and the only way out was guessing a better
query. The search itself is `TmdbClient.search`
([client.ts:343](../../apps/api/src/tmdb/client.ts#L343)).

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
| `/find/{id}` | `external_source=imdb_id` — measured, see chunk 5 | chunk 5 |
| `/search/collection` | `query`, `page` — measured, see chunk 6 | chunk 6 |

Two year parameters each, and the difference matters. A film's `year` matches
any release — a re-release, another country's date — where
`primary_release_year` matches the one release the film is known by. A
series' `year` matches its first air date *or any episode's*, so `year=2015`
finds every show that aired an episode that year; `first_air_date_year` is the
one that tells two shows of the same name apart.

Per-kind rows carry no `media_type`, the field a `/search/multi` row's kind is
read from, so `candidateOf`
([client.ts:222](../../apps/api/src/tmdb/client.ts#L222)) takes a narrowed
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
selection, which belongs to the results it was made over. A title added is
patched into every cached search rather than only the one it was added from,
since the same query under All or the other kind holds the same candidate for
five minutes and would offer it again. The empty answer names what narrowed it — "TMDB has nothing
for “dune” among series first aired in 1984."

## Chunk 2 · More from TMDB

Landed 2026-09-23. `GET /search` takes `page` (1–500: TMDB refuses anything
past 500 whatever its `total_pages` says) and answers
`{ results, page, hasMore }`, `hasMore` from `total_pages` capped at that 500.
`TmdbClient.search` returns the page with TMDB's count, and a body that gives
none reads as the last page. `limit` went: slicing inside a page would skip
the rows between it and the next one, and nothing in `apps/web` passed it.

On the web, `searchQuery` is an infinite query under the same key, so
chunk 1's patch after an add covers every loaded page, and a *more from TMDB*
button sits under the list — a button rather than scroll-loading, because
every page is a call and the sticky selection bar sits at the bottom where a
scroll trigger would be. Flattening dedupes on `candidateKey`, since
popularity can move a title from one page to the next between calls. The
held-back count covers every loaded page, and a selection lives across the
pages of one search. A later page that fails leaves the list standing and
says so under it. A page with no title on it — usually a `/search/multi` page
of nothing but people — says there are none so far rather than that TMDB has
nothing. A stale search refetches every page it holds, one call each, so it
does not refetch on window focus; a return to `/add` past the five minutes
still does, sequentially, which is the price of held-back counts that are
current.

## Chunk 3 · Tell look-alikes apart

Landed 2026-09-23. The candidate carries `originCountry` — a series' first
`origin_country`; a film's search row has none — and `original`, the title in
its own language with TMDB's language code, only when it differs from the
display name. Both come off the row already fetched, so no call is added. The
row's heading reads `The Office 2001 · series · GB`, and the original name
sits under it with `lang` set, so a screen reader pronounces it and CJK text
takes its own language's glyphs. *The Office* from 2001 and from 2005 stop
being two rows told apart by the year alone. Null draws nothing.

## Chunk 4 · Want from the results

Landed 2026-09-23, web only: the intent route already existed. Every
candidate the record does not hold gets *Want* under *Add*, quiet where Add is
jade, since what the screen is for is saying what was watched:
`POST /titles`, then `setIntent(id, { want: true })`. Nothing was watched, so
nothing opens the backfill screen — the row moves into the held-back group as
an add does, and a toast names the title. The batch bar offers both verbs over
one selection, sequential like the batch add.

The two writes are not one transaction. A failure between them leaves the
title stored and not wanted, which is reported as exactly that on the row —
"Added, but not marked as wanted" — and the row is not moved to the held-back
group, so it keeps its buttons; both writes are idempotent (`POST /titles`
answers 200 for a stored title), so the retry is the same button. A batch
that stops partway keeps the rest of its selection ticked: what landed has
left it by being recorded as stored, so what is still ticked is exactly what
the retry has to do. The title it stopped at carries the error on its row as
well as in the toast, since it may be stored and not wanted and the toast is
gone in five seconds.

## Chunk 5 · Paste an id or a link

Landed 2026-09-23. An IMDb id (`tt0903747`), an IMDb title page — localised
or mobile, whatever follows the id — or a themoviedb.org `/movie/603` or
`/tv/1396` page answers with the one title it names. `parseTitleReference`
lives in `packages/shared` beside `parseGuid`: identity is external, and the
browser uses it too. Only the whole input counts, so a query with a space in
it is always a search. `/search` detects it itself and asks
`TmdbClient.find` instead, so the answer is still a candidate list — one
page, no more after it — and the kind and year are not applied, since they
narrow a search and this is not one. A TMDB page costs its details call,
whose body carries every field a search row does; an IMDb id costs `/find`.
A 404 or an empty `/find` is TMDB not having the id, answered as no results.

Measured against the live API 2026-09-23: `/find` sorts an id into
`movie_results`, `tv_results`, `tv_episode_results` and `tv_season_results`,
the first two with `media_type` set, and an unknown or malformed id answers
200 with all four empty. An episode's IMDb id comes back as an episode row
carrying `show_id` and nothing under `tv_results`, so it resolves to its
series with one details call — the series is what can be added. The screen
changes its placeholder, and an empty answer to a pasted id says TMDB has no
title under it rather than naming a kind and year that were not applied.

## Chunk 6 · A collection in one tick

Landed 2026-09-23. *Collections* is a fourth position on `/add`'s kind
control, `?kind=collection`, and searches `/search/collection` through
`GET /search/collections`; a position of its own rather than collections
mixed into every film search, so an ordinary search stays one call. A
collection is not a `TitleKind`, so it widens the screen's kind, not the
record's: the API keeps `kind` to `show | movie` on `/search`, the year
field is not drawn for it, and a pasted link under it still goes to the
title search, since a link names a title.

Opening one asks `GET /search/collections/:id`, which reads
`/collection/{id}` — the call `backfill:metadata` makes for a film's
series — through a client method of its own, `collectionTitles`, so the
backfill's `collection()` and the rows it stores are untouched. A part is a
search row in all but name and maps to a candidate the same way, overview
and original title included, in release order with the unannounced last. The
route marks the held ones like a search does. Every film the record does not
hold starts ticked, straight into the bulk add or want; the held ones are
listed too, pointing at where they are held, since which of a series is
already on the record is half of what opening it is for. One collection is
open at a time, a second press closes it, and an answer for one since closed
or passed over ticks nothing. An add patches the open collection's films as
it patches every cached search; collection pages are keyed apart from
`['search']` so that patch never reaches them.

Measured against the live API 2026-09-23: `/search/collection` rows carry
`id`, `name`, `poster_path` and `overview`, and matches loosely — "dune"
also finds *Legally Blonde* and *The Princess Diaries*. A part carries
`media_type: 'movie'` and the fields of a film search row, and a collection
can hold a film not yet released: *Dune: Part Three*, dated 2026-12-15.

## Chunk 7 · Search as the owner types

Landed 2026-09-24. Quota was never what stood in the way; the rate above
allows it many times over, and with a 300ms pause, a three-letter floor and
the five-minute cache, typing "breaking bad" costs a handful of calls. Enter
still searches anything, which is what a two-letter title like *Up* is for.
What did stand in the way, and how each went:

- **The selection was cleared whenever `q` changed.** Fixing a typo after
  ticking two titles would have dropped both. A new query now keeps the
  ticks; a new kind or year still clears them, being a different search.
  `picked` only ever counts ticks the results on screen show, so a tick on a
  title typed past is held, not added.
- **History.** One entry per burst of typing: the first pause's search pushes,
  the next ones replace it, and Enter, Back, a link or a new kind or year ends
  the burst. Back returns to the last search the owner settled on, not to
  every prefix of it. A navigation to a new address clears a pause that has
  not fired yet, so a kind clicked or Back pressed a moment before it cannot
  be undone by it; one to the same address leaves it to fire.
  The pause sends what Enter would — the typed year included, under a short
  query too — and nothing when Enter would be refused.
- **The auth check.** `/add`'s `beforeLoad` asks `/auth/me` on the way in and
  not on a `stay` — its own search params changing — since every pause is a
  navigation that would otherwise wait on that round trip, and the window it
  opened is where a Back could land under a pause still in flight. The screen
  is already drawn by then; a session that ends mid-search is the API's 401
  on the search itself.
- **The box and the URL.** A `q` the box sent itself is not written back into
  it — the URL's copy is trimmed, so a space typed before the next word would
  vanish mid-typing. It is marked as arrived the moment it does, so Back and
  Forward to the same query later still set the box.
- **Flicker.** The last answer stays up, dimmed and `aria-busy`, while the
  next query's loads (`keepPreviousData`), and *more from TMDB* waits for the
  real answer. A stand-in with nothing to list says "Searching…" rather than
  anything about the new query, and a stand-in list of collections is inert,
  since one opened from it may not be in the answer that replaces it. An
  emptied box lists nothing, though the disabled query still holds its last
  answer, so no tick on it can be counted.
- **Superseded requests run to the end, on purpose.** A request typing has
  moved past cost its TMDB call when the API made it; cancelling the browser's
  side saves nothing, and throws away an answer that, left to finish, is cached
  for when the query comes back.

## Not planned

Trending on the empty screen (`/trending/{movie|tv}/week`) — useful for new
releases, one call per visit. Finding everything by a person, which is a
person search, their combined credits and a dedupe. Reading a year out of the
query text, which breaks on *1917*, *2012* and *Blade Runner 2049*.
