# Web depth

**Status:** In progress — scoped 2026-09-21 from a review of the three built
screens against [web-design.md](web-design.md). Arcs 1 and 2 are complete
and deployed: arc 1 landed 2026-09-21 and 2026-09-22, arc 2 on 2026-09-22
with migrations 0012 to 0014, each refreshed on the box the day it shipped.
Arc 3 landed 2026-09-22 in five commits. Arc 4 is in progress: chunks 1 to
3 landed 2026-09-22. Both deployed the same day with no migration, and
`GET /history` answered on the box as the rehearsal had — 461 plays over 24
titles, all exact, 116 KB.
Arcs are ordered; chunks inside an arc are one commit each, and each one
deploys to a live record — see Shipping against production.

The three screens the design names are built and the system holds: palette,
type split, state vocabulary and the "a control that does nothing is worse
than no control" rule are applied everywhere. What the review found is
structural rather than cosmetic. **The app is a ledger of the record and shows
almost nothing about the thing recorded.** The title's `overview` is stored
([schema.ts:75](../../apps/api/src/db/schema.ts#L75)) and never sent to the
browser; an episode carries only a name, an air date and a runtime; the add
screen lists TMDB candidates without artwork. On the page built for
backfilling S4E7, the only way to know what S4E7 is, is to remember its title.

That matters most for the half of the history Plex cannot supply. The walk
and the webhooks mark what is watched from now on; a decade of television
watched elsewhere is entered by hand, and people remember scenes, not episode
numbers. Every arc below is judged on whether it makes that entry usable.

## Constraints that carry over

Read [web-design.md](web-design.md) first; these are the rules that bind here
in particular.

- **Metadata is cached locally.** Nothing here asks TMDB from the browser.
  Every new fact is a column written by `backfill:metadata` or
  `backfill:episodes` and served by the API, so a poster, a synopsis or a
  next-air date survives TMDB being down.
- **No extra TMDB spend where the call is already made.** The season endpoint
  `backfill:episodes` hits returns each episode's `overview` and `still_path`;
  the details call `backfill:metadata` makes returns `status`,
  `next_episode_to_air`, `genres` and `networks`. Arcs 1 and 2 add columns,
  not calls. Credits and collections (arc 2, chunk 4) are the first new call
  and are marked as such.
- **Plan functions stay pure.** A new write verb (arc 3's range mark) is a new
  scope for `planWatchEvents`, unit-tested with plain inputs, not a decision
  made in a route or a component.
- **Artwork is the only saturated thing.** Any tint drawn from a poster stays
  under six percent over `--surf`. Jade and gold keep their jobs.
- **Two mono sizes, not seven.** As of the review the code sets mono at 10,
  9.5, 9, 8.5, 8 and 7.5px across seven call sites. The design fixed 10px as
  the floor after 8.5px failed on the chips;
  [Activity.tsx:42](../../apps/web/src/title/Activity.tsx#L42) uses 8.5px
  anyway. Arc 4 settles the steps; until then, new code uses 10px and 9px
  only.
- **Migrations are generated.** A new column goes in `schema.ts`, then
  `db:generate`. Never hand-written SQL.
- **There are two databases now.** See the next section before any chunk
  that adds a column or needs a backfill.

## Shipping against production

Engram has been live since 2026-09-21 ([go-live.md](go-live.md)), so every
chunk here lands on a running record rather than a development database that
is a `compose down -v` from a retry. What that changes:

- **Migrations run on boot.** The API image's entrypoint runs
  `dist/db/migrate.js` before the server starts, so `scripts/deploy.sh`
  applies a new column the moment the container comes up. Forward-only:
  rolling back past a migration means the nightly backup, not a tag change.
  Every column this note adds is nullable and additive for that reason, and a
  chunk must not rename or drop one.
- **A new nullable column is empty until something fills it.** Between the
  deploy and the backfill, `overview` or `still_path` is null on every row
  and the UI has to read as it did before rather than showing a hole: no
  "No synopsis" text, no empty image box. Every component that draws a new
  field draws nothing when it is null. That is also what a fresh clone with
  no TMDB key sees, so it is the shipped default, not an edge.
- **Backfills run on the box, not from a laptop.** Both CLIs ship in the image
  under `dist/titles/`, and the container carries `DATABASE_URL` and
  `TMDB_API_KEY`, so after a deploy that adds a column:

  ```sh
  ssh <host> "cd /srv/engram && docker compose -f compose.prod.yaml exec api \
    node dist/titles/backfill-cli.js"          # episodes
  ssh <host> "cd /srv/engram && docker compose -f compose.prod.yaml exec api \
    node dist/titles/backfill-metadata-cli.js" # titles
  ```

  Running `pnpm backfill:*` locally fills the development database, which is
  no longer the record. It is still worth doing first, as the rehearsal: the
  local database is a restore of a production dump away from being identical,
  and a backfill that misbehaves is caught there.
- **Nightly, once arc 2 lands.** Show status and next air date go stale, so
  `backfill:metadata` moves from "after a walk" to the reconcile timer
  go-live.md plans for the library walk. Until that timer exists the
  refresh is a manual run of the command above, and the header's "next airs"
  must state the date it was fetched on if it can be more than a day old, or
  not show at all.
- **TMDB spend is production's key.** The rate that was fine against 12
  titles locally is 82 titles and 2467 episodes on the box, and arc 2 chunk 4
  adds one call per film. The backfills are sequential and take no pause
  between calls today, which TMDB's limit has tolerated at this size; a chunk
  that adds a call per row checks the run against that limit before it is
  pointed at the box, and nothing here fans out.
- **Scripts in `tools/` are development-only.** `dump:library` and
  `import:library` run against the Plex server from wherever pnpm is;
  nothing in this note adds to them.
- **Take the backup before a migration, not after.** `ops/backup.sh` runs
  nightly; a deploy that carries a migration runs it by hand first, so the
  dump on disk is of the schema being left, not the one being entered.

## Arc 1 · Say what the thing is

The pain point, in cost order. Chunks 1 to 3 spend no TMDB calls.

1. ~~**Send the overview.**~~ Landed 2026-09-21. `GET /titles/:id` carries
   `overview` beside `backdropPath`, `asStranger` passes it through, and
   `TitleDetail` in [apps/web/src/api/titles.ts](../../apps/web/src/api/titles.ts)
   mirrors it. The header draws it clamped to two lines with a "more" toggle
   that opens in place; the toggle appears only when the clamp is hiding
   something, measured off the box rather than guessed from the length. Two
   departures from the plan: it sits under the poster row rather than beside
   the ids, because that row's height is what keeps the name off the hero and
   a synopsis opening in place there would push it up; and the add screen's
   rows were left alone — `CandidateRow` has drawn the poster and a two-line
   clamp of the overview since the espresso palette landed, so the review's
   "candidates without artwork" was stale. Null draws nothing, which is what
   production shows for a title `backfill:metadata` has not reached.
2. ~~**Episode synopsis and still.**~~ Landed 2026-09-21 as migration 0011:
   two nullable columns on `episode`, `overview` and `still_path`, read off the
   season payload by the TMDB client, carried through `planEpisodes`, and
   written by `backfill:episodes` on the same upsert — the conflict clause
   refreshes both, so the rows the Plex import created gain them too.
   `EpisodeCell` in `GET /titles/:id` carries both and the web type mirrors it.
   The popover is a `w-80` card: the still bleeds to the card's edges at 16:9,
   then the name alone, then `S2E5 · 14 Jun 2019 · 42 min` in 10px mono (the
   number moved from the name line into that line, which is the one departure
   from the sketch), then up to three lines of synopsis, then the controls
   unchanged. Still and synopsis are each drawn only when stored, so a null
   row reads exactly as before — no placeholder, no empty box.

   Rehearsed locally the same day against a restore of the production record:
   2467 episode rows, all null before; after one run 2376 carry both a
   synopsis and a still, 0 rows added, 8 stored rows TMDB does not list. The 91
   left null are those 8 plus episodes TMDB itself has no text or frame for.
   Run on the box 2026-09-22 in the order Shipping against production gives —
   backup, deploy, `backfill-cli.js` in the api container — and it answered
   line for line as the rehearsal had: 53 shows, 0 rows added, the same 8
   unlisted rows, all on Bleach.
3. ~~**Season facts on the heading.**~~ Landed 2026-09-22. A `season` table
   does not exist and one row per season is not worth one yet, so the heading
   derives what it can from the cells the grid already holds:
   `SEASON 2 · 2019–2020 · 10 EP · ONE MISSING`. `seasonFacts` in
   [apps/web/src/title/season-facts.ts](../../apps/web/src/title/season-facts.ts)
   is pure — `today` comes in as an argument — and unit-tested on plain cells.
   The year range comes off the air dates: one year prints once, no dated
   episode prints no range. The count is every cell. The state reuses
   `statusOf` from the cell, so what a cell draws and what the heading counts
   cannot disagree: a hole is a cell not seen that is part of the run, which
   makes a declared skip a hole and leaves *not out yet* and *not on TMDB*
   out. A season with no hole says nothing more; one hole says `ONE MISSING`;
   more say the count, `3 MISSING`; a run with holes and nothing seen says
   `NONE SEEN`, which is what `0 of 10` used to say without repeating the
   count now beside it. Departures: the caps come from CSS on the shared
   heading class, so the specials fold is capitalised the same way and the
   DOM still reads `Season 2`, which is what the region's label and the mark
   control's sentence are built from; the heading went from 9.5px to 10px mono as the
   one type-size change in scope, and the *Mark season watched* control
   beside it is still 9.5px and waits for arc 4. Specials keep their
   `Specials · n of m` summary with no year range: an OVA list spans whatever
   years the show ran, so the range would describe the show rather than the
   fold, and the summary's job is the count that says whether opening it is
   worth anything.
4. ~~**Link the ids.**~~ Landed 2026-09-22. The identity line in `TitleHeader`
   makes each id a link to its catalogue page, opened in a new tab with
   `rel="noreferrer"`, styled as the mono text it already is with an underline
   on hover. TMDB by kind, `themoviedb.org/tv/{id}` or `/movie/{id}`;
   `imdb.com/title/{id}`. One departure: TheTVDB goes through its dereferrer,
   `thetvdb.com/dereferrer/series/{id}` and `/dereferrer/movie/{id}`, rather
   than the `?tab=series&id=` form planned. Probed 2026-09-22: `?tab=series`
   redirects to the series page, but `?tab=movie&id=` answers a movie id with
   the home page, while both dereferrer forms redirect to the slugged page, so
   one shape serves both kinds. Costs nothing and answers half of "tell me
   about this show" with no schema. A **Find in Plex** link,
   `app.plex.tv/desktop/#!/search?query=<encoded name>`, sits first on the
   owner's action row — the honest, `ratingKey`-free form of the mockup's
   rejected "play in Plex". It was planned as visible to everyone since it
   writes nothing, but `app.plex.tv` is Plex's hosted client and searches
   whatever server the signed-in account reaches, so to anyone but the owner
   it is a link to a sign-in page: a control that does nothing. Owner-only,
   decided 2026-09-22.

## Arc 2 · Facts the state vocabulary is missing

1. ~~**Show status and next air date.**~~ Landed 2026-09-22 in two commits.
   Planned as columns on `title` — `status` as TMDB's string, `next_air_date`,
   the next episode as two integers — filled by `backfill:metadata`, which
   then has to run nightly rather than after a walk and belongs in the
   reconcile timer on the box that open-work.md's walk item already plans; the
   header's meta line gaining `Ended 2015` or `Returning · next 12 Oct`, and
   the next-up band "next airs 12 Oct" when the run is caught up.

   Storage landed first as migration 0012: five nullable columns on
   `title` — `status` as TMDB words it, `last_air_date`, and `next_air_date`
   with `next_episode_season` and `next_episode_number` — read off the details
   call the client already makes, carried through `planTitle`, written by
   `POST /titles` and `backfill:metadata`. One rule differs from the artwork
   columns: this group is written as answered, null included, because a next
   episode is gone once it has aired and a coalesced null would keep saying
   it is coming. Rehearsed locally with `backfill:metadata --refresh` over the
   82 titles: every row got a status (22 ended, 21 returning, 10 cancelled,
   29 released), four carry a next air date, none is undated or in the past.

   The browser half followed. `status` rides on `TitleSummary`, so the wall
   has it for chunk 2 without a second query, and `GET /titles/:id` adds an
   `airing` block — `lastAirDate`, `next` as `{season, number, airDate}`,
   `fetchedAt` — that `asStranger` passes whole, since nothing in it was
   written by hand. `airingLine` in
   [apps/web/src/title/airing.ts](../../apps/web/src/title/airing.ts) is the
   pure derivation, `today` passed in, unit-tested on plain inputs; the header
   draws its answer after the record's state, the dates in mono. The words:
   `Returning`, `Ended`, `Cancelled` (TMDB spells it *Canceled*), anything else
   as TMDB says it in sentence case; `Released` draws nothing, because a
   film's year already says so. A closed run is dated by its last episode —
   `Ended 2015` — unless that is the year the title already carries, when the
   year would print twice. `next 12 Oct` is claimed only while the date is
   today or ahead; a next episode that has passed without a refresh is a fact
   the record no longer holds, and the line says nothing rather than "next"
   about a day gone by. Per Shipping against production, while the refresh is
   a manual run a claim not fetched today is followed by `as of 20 Sep` — only
   a same-day fetch is certain to be under a day old.
   Departures: the next-up band was left alone. It offers the next *unseen
   aired* episode, so a caught-up show is never in it, and putting "next
   airs" there would change what the band means; the header is where a
   caught-up show is looked at, and that is where the date went. And the
   episode's number is stored but not drawn: `next 12 Oct` was the sentence
   planned, and `S3E1` beside it is a claim TMDB revises more often than the
   date.
2. ~~**Ended resolves drifting.**~~ Landed 2026-09-22. The open decision on
   `DRIFTING_AFTER_DAYS` ([open-work.md](open-work.md) § Decisions still open)
   had nothing to tune against. A half-watched show whose status is Ended is
   not drifting, it is dropped in fact. Planned as `deriveState` or the wall's
   facet reading status, with the chip's label possibly becoming *Abandoned*,
   to be decided when the count was visible.

   The count, taken on the production record after chunk 1's refresh: eight
   shows in progress — three Canceled, three Returning, two Ended — and the
   180-day rule already caught three of the five closed ones. Two newly caught
   shows do not earn a chip of their own, and *Abandoned* claims more than the
   record knows (The Sandman ended after it was started), so the label stays
   *Drifting*. The wall's facet, not `deriveState`, reads status: `state` is
   a fact about the record and stays so. Two rules, both in `matchesFacet`:
   an in-progress show whose status is Ended or Canceled is drifting whatever
   its dates; and one whose `next_air_date` is today or ahead is not, whatever
   its dates — the count showed Bleach and The Rings of Power reading as
   drifting with an episode scheduled next month, which is waiting, not
   drifting. `nextAirDate` joins `TitleSummary` for that. Net on production:
   five drifting before and after, two waiting shows swapped for two cancelled
   ones.
3. ~~**Hours as a figure.**~~ Landed 2026-09-22 in two commits. `runtimeMin`
   is stored per episode. The figure row adds `31d` or `740h` of television,
   summed over seen episodes with a runtime, and the label says when some
   episodes had none. Movies use the title's runtime, which needs a
   `runtime_min` column on `title` from the same details call as chunk 1.

   Storage landed first, 2026-09-22, as migration 0013: one nullable
   `runtime_min` on `title`, read off a movie's details body (TMDB writes 0
   for a runtime it does not know, read as null) and written add-only like
   the artwork by both `POST /titles` and `backfill:metadata`. The detail
   route's figures gain `watchedMin` and `untimed`, summed in the same
   subquery as `plays` over the same set — each seen row once however often
   it was played, an episode's own runtime or the title's for a film, a
   stored 0 counted as untimed. Rehearsed locally: 29 films, all with a
   runtime; Bleach 9837 minutes with 8 untimed episodes.

   The figure followed as a cell in the header's stat box, `19h` in mono with
   `watched` beneath, or `watched, at least` when any seen row had no runtime
   — the floor is said in the label rather than left to pass for the whole.
   One departure from the plan's `31d` or `740h`: one unit, never both, and
   hours run to ten days before the figure steps to days, the way
   `formatSince` steps from days to months; floored, since a floor must not
   round up. Nothing is drawn when the sum is zero, like the other cells. The
   wall does not carry the figure.

   Amended 2026-09-22 after the first look in production: a film's cell read
   `1h` for a 96-minute film, a third of it floored away, and only repeated
   the runtime beside a play count of one. The cell is drawn for shows only;
   a film's runtime is a fact about the film and sits on the meta line as
   `Film · 1h 36m`, to the minute. `TitleDetail` carries `runtimeMin` for it.
4. ~~**A film's run.**~~ Landed 2026-09-22 in two commits. *The first new TMDB call.* Collection membership (Dune:
   Part One belongs to the Dune collection), director and the top three cast,
   from `append_to_response=credits` on the details call plus one collection
   call per film that has one. The film page draws the collection where a
   show's grid would be, as tiles with the same state bar as the wall, and a
   sibling not on record links to the add screen prefilled. Defer until arc 1
   has shown whether the film page still reads empty with an overview on it.

   Judged 2026-09-22 on the production film page after chunk 3: the header
   reads as a title page and the page still stops at the actions, with most
   of the viewport empty below one activity row. A show fills that band with
   its grid; a film has nothing to put there, and this is what would.

   Storage landed first, 2026-09-22, as migration 0014. `director` and
   `top_cast` (the three top-billed names, as jsonb) on `title`, read off the
   film's details call with `credits` appended — one call still, and a show's
   credits are per episode and not asked for. A `collection` table keyed on
   TMDB's id, named the first time a film that belongs to one is fetched by
   either `POST /titles` or `backfill:metadata`, and `title.collection_id`
   pointing at it; a `collection_part` table holding what the collection call
   returns — tmdb id, name, year, release date, poster — so the page can draw
   a sibling that is not on record without asking TMDB. The parts are the one
   new call per film and are fetched by `backfill:metadata` only, refetched
   on every refresh since a collection grows; a part on record is found by
   matching its tmdb id against `title.tmdb_id`. Credits and collection are
   written add-only like the artwork. Rehearsed locally: 29 films, all with a
   director and cast, 21 of them in 13 collections.

   The page followed. The detail route carries `director`, `cast` and a
   `collection` of parts, each part with the id and wall state of the title
   it is on record as, or null; the parts are a fifth statement made only
   when the title names a collection. The header says `Directed by Denis
   Villeneuve · with Timothée Chalamet, Rebecca Ferguson, Zendaya` under the
   synopsis, names in the text colour and the joining words dim. The
   collection sits where a show's grid would, a section headed by its name
   with `2 of 3 on record` aside, tiles like the wall's with the same state
   bar: a part on record links to its page, the one being read is ringed and
   not linked to itself, and a sibling never added is drawn faded with no bar
   and links to `/add?q=` with its name filled in. Two departures from the
   plan: the cast is three names and not a role each, and a stranger sees the
   collection whole, since a part's state is the record the wall already
   shows them.

## Arc 3 · Manual entry as a first-class verb

1. ~~**Range marks.**~~ Landed 2026-09-22. The two grains today are a whole
   season and one cell; the real shape is "seasons 1 to 3, and season 4 up to
   episode 7". A new
   scope for `planWatchEvents`, `{ season, through: episode }`, expanding to
   every episode of that season up to and including it, specials excluded
   like every other scope. In the grid: shift-click a cell marks from the last
   seen cell in that season through this one, opening the same date popover
   with `what` reading `S4E1–E7`. Unit-test the expansion; the route is the
   same `POST` as the other scopes. Drag-select is the polished form and
   waits until the shift-click has been used for a fortnight.

   Landed as planned with one addition: the scope is `{ season, from?,
   through }`, `from` defaulting to the season's first episode, so the grid
   can send the range it shows rather than the whole season up to the cell —
   re-marking the seen cells before it would write nothing on the same date
   and a rewatch on a different one. `episodesInScope` steps over the unaired
   like a season mark and refuses a `through` the season does not have. In
   the grid a shift-click on an unwatched cell opens its popover with a line
   saying where the range starts and the mark form reading `S2E5–E7`; a
   shift-click with nothing seen before the cell starts at the season's
   first, and one where the range would be a single cell is a plain click.
   The retraction has no range, so the notice after a range mark offers no
   undo: taking back the season would remove hand-entered plays the mark
   never touched. A misjudged range is taken back cell by cell.
2. ~~**The date field remembers.**~~ Landed 2026-09-22. Every popover opens
   blank, so a season entered cell by cell means retyping `2019` each time. Keep the last date
   typed on the page for the session, in module state or a context above the
   grid, and prefill it. The commit bar and the toast still state the
   precision, so a stale prefill is visible before it is written.

   Landed as a context above the page's column, keyed on the title so the
   next title's form opens blank; the form remembers what it wrote on
   success, and the add screen, which has no provider, is blank every time.
   Nothing is drawn beyond the prefilled field, and the notice does not name
   the date, so the prefill is read in the field before it is written.
3. ~~**Keyboard walk.**~~ Landed 2026-09-22. Cells are buttons, so ONE PIECE
   is 1100 tab stops. One tab stop per season with a roving `tabindex`; arrow keys move between
   cells, Enter opens the popover, and while a popover is open the arrows move
   it to the neighbour without closing. Reading a season becomes holding an
   arrow. Radix Popover's `onOpenAutoFocus` and a controlled `open` are enough.

   Landed with the season owning the walk: which cell is the tab stop and
   which popover is open are the season's state, since a cell cannot know its
   neighbours. Left, Right, Home and End step along the episode numbers and
   stop at the ends rather than wrap; Up and Down read the layout, since the
   cells wrap to the width and a year row breaks a line wherever it falls, and
   go to the nearest cell on the adjacent line. Inside the popover the same
   keys move it, except in a field, where they are the caret's. One thing
   `onOpenAutoFocus` did not cover: the closing panel returns focus to its
   cell a tick later, which the panel just opened reads as focus leaving it,
   so the season prevents `onCloseAutoFocus` while handing a panel on.
4. ~~**Rewatches in the grid.**~~ Landed 2026-09-22. A cell is binary and
   Bleach's two real rewatches are visible only in the feed. A corner tick, or
   `2×` in the cell's top right at 7px, on `playCount > 1`. Not a colour: jade
   is "seen" and a second green would fork it.

   The tick, not the `2×`: a 7px figure would be a third mono size on a page
   arc 4 means to bring down to two, and the cell's one number is the
   episode's. A 7px triangle in the cell's top right, in the on-jade ink the
   number is set in, and the cell's label carries the count — `seen, 2 plays`
   — so it is said as well as drawn.
5. ~~**Activity does not dead-end.**~~ Landed 2026-09-22. "last 5 of 19" with
   no way to the other fourteen. A "show all" that lifts the API's cap for
   that request, paged in fifties. The feed is the raw evidence and the only
   view that names each event's source; it has to be reachable in full.

   Landed as `GET /titles/:id/activity?offset=&limit=`, one page of the same
   statement the detail takes its first four hundred from, so the two cannot
   disagree about what the feed is made of; public like the detail's slice,
   404 to a stranger for an excluded title like the detail. The feed shows
   five, then `show all 19` pages from the start in fifties with `show 50
   more` while a page comes back full — from the start rather than from where
   the detail's slice ends, so the list is one query's answer and cannot
   double a play at the seam. The count beside the heading stays the detail's
   `figures.plays`; the page carries no count of its own.

## Arc 4 · Screens the rail owes

1. ~~**Next up as a strip.**~~ Landed 2026-09-22. One candidate of N with
   session-only dismissal was right at twelve titles. With ten runs in
   rotation, the band shows the first three or four as compact cards in a
   row, `Not now` per card, and the whole strip collapses to one line when
   there is one. Same query, same dismissal state.

   Landed as planned: the same `GET /next-up`, its cap left at five, and the
   same set of titles passed this sitting. How many cards is decided by the
   strip's own width, a container query rather than the window's, since the
   rail and the gutter take their share: one on a phone, two from 672px,
   three from 1024px, four from 1280px, so a card is never under 300px. A
   laptop at 1512 draws four. One card fills the row, which is the band it
   was. Each card gives the name, the episode and the reason a line of their
   own, so a narrow card truncates the episode's name before the show's, and
   the reason wraps to two lines rather than truncating, since *but this one
   is still unseen* is the clause that matters. `Not now` rides on the name's
   line and is drawn on every card while more than one is left; its label
   names the title. The cards are keyed by slot, so while one is left to move
   in, passing a card moves the next into its place under the same button
   rather than dropping the focus; the artwork is keyed by title, so the
   newcomer never sits beside the poster it replaced. The name is truncated
   with a tip carrying it whole, as on the wall. One
   departure: `NEXT UP` moved out of the band to sit once above the row, at
   9px.
2. ~~**A home for `want`.**~~ Landed 2026-09-22. It is a flag on a card and a
   toggle on the page and has no chip. Movies plus *Unwatched* is the backlog
   only until a show is added that has not been started. Add *Want* as a
   seventh facet, counted like the others; the movie backlog then reads as
   *Movies · Want* if the owner flags them, or stays *Movies · Unwatched* if
   not.

   Landed as planned, in the web alone: `want` was already on `TitleSummary`,
   so the chip is one more case in `matchesFacet` and counts like the others,
   within the kind and the search box. It sits after *Unwatched*, the two
   backlog readings side by side, and applies to both kinds. It matches the
   flag as set, whatever has been seen since: clearing it is the owner's
   call, and a film finished while wanted, or flagged for a second watch,
   still says so. A title also flagged dropped is left out: the two flags are
   apart so the record remembers a show was meant before it was given up on,
   but a backlog that lists what was given up on is not one. The intent
   toggle already invalidates the wall's query, so the count follows a flag
   set on the title page. On the local record the chip reads 0 — nothing is
   flagged yet. One departure: the chip is the owner's. The API sends a
   stranger every title's intent as false, so their *Want* could only read 0;
   `appliesTo` drops it for them as it drops the run chips under Movies, and
   a stranger arriving on `?facet=want` is redirected to the wall like
   `?kind=movie&facet=going` is.
3. ~~**YEAR.**~~ Landed 2026-09-22 in three commits. The rail's unbuilt
   fourth item gets its screen: the whole record as a calendar heatmap, one
   row per year from the first dated event, a cell
   per day shaded by plays, click a day to list what was watched. It reuses
   `marksIn` from `YearBar.tsx` generalised past the twelve-month window, and
   it is the only place the entire history is visible at once, which is the
   product. Figures at the top: plays, episodes, hours, titles finished, per
   selected year. This is the stats surface the Trakt replacement goal names;
   nothing more elaborate is planned.

   The route landed first, 2026-09-22: `GET /history`, open like the other
   reads, answers every finished play that carries a date — one row per
   event, oldest first, with its episode, its runtime by the detail's rule
   and its source — beside the name, kind, poster and state of each title
   those plays name. Events
   rather than days, because the day an instant falls on is the viewer's: a
   play at half past midnight in Brussels is the previous day in UTC, and the
   server does not know where the viewer is. The same reason puts the
   collapsing of sources in the browser. On the local record 76 of 382
   play-days — an episode or a film on one Brussels day — are claimed by both
   the Plex history and the library walk, and whether two rows are one
   viewing depends on the day they land on. Specials are in, unlike the title
   figures, since a calendar records what was watched on a day; a show's
   event naming no episode is out, as it is from the figures, since it would
   count one watching twice with nothing to match it on. Excluded titles are
   out for everyone, owner included: "not mine, never was" has no place in a
   year's plays. The wall's list decides what is excluded and a play is kept
   only if its title is on it, so there is one rule. Rehearsed against the
   local record: 461 plays over 24 titles, all exact, 116 KB.

   The counting followed, pure and unit-tested in
   [apps/web/src/year/viewings.ts](../../apps/web/src/year/viewings.ts).
   `dayOf` is the rule for which day a play is on: an exact play in the
   viewer's zone, a day entered by hand as written — read as an instant in
   UTC, not cut from the string Postgres prints in its session's zone — and a
   month or a year on no day. One departure: the plan had `marksIn` itself
   generalised past its window, but a calendar counts plays per day where the
   strip places marks along a line, and what the two share is the day rule.
   So `marksIn` takes `dayOf` instead, and the twelve-month strip now
   collapses marks by the viewer's day rather than UTC's. `viewingsOf` counts
   rows by `watch_state`'s rule at a calendar's grain: per episode per day,
   the larger of what the per-play sources counted and one. The library
   walk's own total is left out, since only its last play has a date. A claim
   coarser than a day stands for a viewing only where nothing finer covers
   its episode inside its period, and viewings are ordered by the calendar
   before the instant, since west of UTC a day entered by hand starts the
   evening before. A run is finished in the year of the latest of its regular
   episodes' first dated viewings. That reads an undated mark beside a dated
   play as the same watching, which is the opposite of the feed, where an
   undated play comes first and every dated one after it is a rewatch. A
   backfill marks whole shows undated, and the feed's reading would leave the
   finale Plex saw on the night it aired finishing the run in no year. On
   the local record 461 rows are 382 viewings on 132 days. One day holds 78,
   which is what a Plex bulk *mark as watched* leaves: the library walk
   stamps every episode with the same last view.

   The screen followed at `/year`, and YEAR joined the rail after ADD, where
   the mockup has it, for everyone: the calendar is the record the wall
   already shows a stranger. One calendar per year, newest first, from the
   first dated play to today. Each is a column per week and a row per weekday,
   Monday first, with 11px cells at a fixed size so eight years fit one
   screen. The running year stops at today, since a day not yet lived is not a
   day nothing was watched on. Shading is jade in four fixed steps — 1, 2–3,
   4–7, 8 and more — so the 78-play day cannot wash every real evening out
   to the palest. A pane beside the calendar, sticky, holds the year being
   read in the title page's stat box (plays, episodes, watched, finished, a
   zero left out as it is there) and the day being read, its viewings oldest
   first with poster, episode, time and every source behind each row. The
   plays dated only to a month or a year are said in a sentence under the
   figures, since they are counted there and drawn on no day. Below 1280px
   the pane goes above the calendar. The selection is in the URL as `?day=`
   or `?year=`, and opens on the year's latest day with plays; a day that
   does not exist or has not happened reads as none picked. One tab stop for
   a year's days, as a season has. The arrows walk days down a column and weeks
   along a row, Home and End go to the year's ends, and the selection comes
   along with them, the way the grid's arrows carry an open popover. Walking
   replaces the history entry and picking pushes one. Each year is memoised
   and handed the selection only when it is inside it, so a step redraws one
   year of eight. Departures: the figures sit in the pane rather than above
   the calendar, which puts the day's list beside the day it lists, and the
   year's label beside its calendar carries the year's play count and picks
   the year when pressed.
4. **Export.** [web-design.md](web-design.md) says the "does this rest only on
   my word" question matters most to the export, and there is no export. A
   block on `/settings` — the route exists since 2026-09-22, the excluded
   titles being its first block — with a download of the full record as JSON
   and as CSV, `source` on every row, and a count of manual claims stated
   before the download. Owner-only, streamed from the API.
5. **Type steps.** Settle mono at two sizes, 10px for anything read and 9px
   for landmarks and tick labels, and remove the other five. The review
   counted the call sites; do this as one commit against the running app, not
   from the grep.

## Arc 5 · Visual

1. **The state bar becomes a progress bar.** The card holds
   `episodes.seen / total` and draws a binary 3px colour. Jade for the seen
   fraction over `--line` for the rest, full jade when finished, gold kept for
   in-progress as the bar's *colour* only if it still reads at 118px; try
   jade-fraction alone first. 8 of 424 and 400 of 424 stop looking identical.
   Highest value per line in this note. Films keep the binary bar.
2. **View transitions.** TanStack Router's `viewTransition` on the card link
   and a shared `view-transition-name` per title on the wall poster and the
   header poster, so the tile morphs into the header. Progressive: browsers
   without the API navigate as today. Check `scrollRestoration` still
   restores; the note in web-design.md explains why the window owns scroll.
3. **Ambient tint.** A dominant colour per title, extracted client-side from
   the poster with a canvas once it loads and cached in memory, mixed into
   the title page's `--surf` and `--raise` with `color-mix()` at four to six
   percent. Stored server-side by `backfill:metadata` only if the client
   extraction visibly flashes.
4. **Empty and first-run states.** A title with no events shows a header and
   nothing else; the wall with no titles shows nothing. Both point at "Add
   watched" in a sentence, and the title page says "Nothing on record yet.
   Mark what you have seen below." above the grid.

## Idea pool, not planned

Command palette to jump to a title. A note per watch event, symmetric with
the gap note. A rating per title. Wall search matching episode names once
synopses exist. Season name and poster on the heading, if arc 1 chunk 3
turns out too thin. Deferred deliberately, in the sense of
[integration-ideas.md](integration-ideas.md): browse before scoping.
