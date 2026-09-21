# Web depth

**Status:** In progress — scoped 2026-09-21 from a review of the three built
screens against [web-design.md](web-design.md); arc 1 chunk 1 landed the same
day. Arcs are ordered; chunks inside an arc are one commit each, and each one
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
2. **Episode synopsis and still.** Two nullable columns on `episode`,
   `overview` and `still_path`, filled by `backfill:episodes` from the season
   payload it already parses. `EpisodeCell` in `GET /titles/:id` carries both.
   The cell popover becomes a card: still at 16:9 across the popover's width,
   name, `S2E5 · 14 Jun 2019 · 42 min`, then up to three lines of synopsis,
   then the marking controls as today. Width goes from `w-72` to about
   `w-80`; the still must not push the actions below the fold on a laptop.
   Deploy, then run the episode backfill on the box as described under
   Shipping against production; it is idempotent, and until it has run the
   popover reads exactly as it does today.
3. **Season facts on the heading.** A `season` table does not exist and one
   row per season is not worth one yet. Instead the heading derives what it
   can: `SEASON 2 · 2019–2020 · 10 EP · ONE MISSING`, the year range from the
   air dates the landmarks already compute. Season name, poster and overview
   from TMDB are deferred until something needs them beyond a heading.
4. **Link the ids.** The identity line in `TitleHeader` makes each id a link
   to its catalogue page (`themoviedb.org/tv/{id}`, `thetvdb.com/?tab=series&id=`,
   `imdb.com/title/{id}`), opened in a new tab, styled as the mono text it
   already is with an underline on hover. Costs nothing and answers half of
   "tell me about this show" with no schema. A Plex web search link
   (`app.plex.tv/desktop/#!/search?query=<name>`) is the honest, `ratingKey`-free
   form of the mockup's rejected "play in Plex" and goes on the action row.

## Arc 2 · Facts the state vocabulary is missing

1. **Show status and next air date.** Columns on `title`: `status` (TMDB's
   string, stored as given), `next_air_date`, `next_episode` as
   `{season, number}` or two integer columns. Filled by `backfill:metadata`,
   which then has to run nightly rather than after a walk, and belongs in the
   reconcile timer on the box that open-work.md's walk item already plans. The header's meta
   line gains `Ended 2015` or `Returning · next 12 Oct`; the next-up band
   gains "next airs 12 Oct" when the run is caught up.
2. **Ended resolves drifting.** The open decision on `DRIFTING_AFTER_DAYS`
   ([open-work.md](open-work.md) § Decisions still open) has nothing to tune
   against. A half-watched show whose status is Ended is not drifting, it is
   dropped in fact. `deriveState` or the wall's facet reads status: an
   in-progress title of an ended show counts under *Drifting* regardless of
   the day threshold, and the chip's label may want to become *Abandoned*.
   Decide the label when the count is visible.
3. **Hours as a figure.** `runtimeMin` is stored per episode. The figure row
   adds `31d` or `740h` of television, summed over seen episodes with a
   runtime, and the label says when some episodes had none. Movies use the
   title's runtime, which needs a `runtime_min` column on `title` from the
   same details call as chunk 1.
4. **A film's run.** *The first new TMDB call.* Collection membership (Dune:
   Part One belongs to the Dune collection), director and the top three cast,
   from `append_to_response=credits` on the details call plus one collection
   call per film that has one. The film page draws the collection where a
   show's grid would be, as tiles with the same state bar as the wall, and a
   sibling not on record links to the add screen prefilled. Defer until arc 1
   has shown whether the film page still reads empty with an overview on it.

## Arc 3 · Manual entry as a first-class verb

1. **Range marks.** The two grains today are a whole season and one cell;
   the real shape is "seasons 1 to 3, and season 4 up to episode 7". A new
   scope for `planWatchEvents`, `{ season, through: episode }`, expanding to
   every episode of that season up to and including it, specials excluded
   like every other scope. In the grid: shift-click a cell marks from the last
   seen cell in that season through this one, opening the same date popover
   with `what` reading `S4E1–E7`. Unit-test the expansion; the route is the
   same `POST` as the other scopes. Drag-select is the polished form and
   waits until the shift-click has been used for a fortnight.
2. **The date field remembers.** Every popover opens blank, so a season
   entered cell by cell means retyping `2019` each time. Keep the last date
   typed on the page for the session, in module state or a context above the
   grid, and prefill it. The commit bar and the toast still state the
   precision, so a stale prefill is visible before it is written.
3. **Keyboard walk.** Cells are buttons, so ONE PIECE is 1100 tab stops. One
   tab stop per season with a roving `tabindex`; arrow keys move between
   cells, Enter opens the popover, and while a popover is open the arrows move
   it to the neighbour without closing. Reading a season becomes holding an
   arrow. Radix Popover's `onOpenAutoFocus` and a controlled `open` are enough.
4. **Rewatches in the grid.** A cell is binary and Bleach's two real rewatches
   are visible only in the feed. A corner tick, or `2×` in the cell's top
   right at 7px, on `playCount > 1`. Not a colour: jade is "seen" and a second
   green would fork it.
5. **Activity does not dead-end.** "last 5 of 19" with no way to the other
   fourteen. A "show all" that lifts the API's cap for that request, paged in
   fifties. The feed is the raw evidence and the only view that names each
   event's source; it has to be reachable in full.

## Arc 4 · Screens the rail owes

1. **Next up as a strip.** One candidate of N with session-only dismissal
   was right at twelve titles. With ten runs in rotation, the band shows the
   first three or four as compact cards in a row, `Not now` per card, and the
   whole strip collapses to one line when there is one. Same query, same
   dismissal state.
2. **A home for `want`.** It is a flag on a card and a toggle on the page and
   has no chip. Movies plus *Unwatched* is the backlog only until a show is
   added that has not been started. Add *Want* as a seventh facet, counted
   like the others; the movie backlog then reads as *Movies · Want* if the
   owner flags them, or stays *Movies · Unwatched* if not.
3. **YEAR.** The rail's unbuilt fourth item gets its screen: the whole record
   as a calendar heatmap, one row per year from the first dated event, a cell
   per day shaded by plays, click a day to list what was watched. It reuses
   `marksIn` from `YearBar.tsx` generalised past the twelve-month window, and
   it is the only place the entire history is visible at once, which is the
   product. Figures at the top: plays, episodes, hours, titles finished, per
   selected year. This is the stats surface the Trakt replacement goal names;
   nothing more elaborate is planned.
4. **Export.** [web-design.md](web-design.md) says the "does this rest only on
   my word" question matters most to the export, and there is no export. A
   `/settings` route with a download of the full record as JSON and as CSV,
   `source` on every row, and a count of manual claims stated before the
   download. Owner-only, streamed from the API.
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
