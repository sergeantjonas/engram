# Open work

**Status:** Index — what to do next. Read first.

## Now

**`apps/web`** — Vite + React SPA on port 2011, shaped by the settled design: a
poster wall filtered by a row of counted facets, a title page built around the
episode grid, and adding a title by hand as a screen of its own. The design was settled
2026-09-16 and is written down in [web-design.md](web-design.md), with the
mockup it was approved from in `docs/design/`. TanStack Router and Query,
Tailwind v4 with Radix primitives and no shadcn, settled 2026-09-18.

The scaffold landed 2026-09-19: the shell asks `/auth/me` and offers sign-in or
sign-out, `/login` explains the reason the API's callback sent the browser back
with, and the API client sends credentials to `VITE_API_ORIGIN`. Radix joined
with the title page, which is the first screen that needed a primitive: one
popover package, not the umbrella. The screens land in this order, one commit
each:

1. ~~The wall over `GET /titles`, filtered by state.~~ Landed 2026-09-19.
2. ~~The title page: episode grid plus declaring and clearing a hole's
   reason.~~ Landed 2026-09-19.
3. ~~Adding a title by hand over `GET /search` and `POST /titles`.~~ Landed
   2026-09-19.
4. ~~The `intent` write route on the API, and the want / dropped / excluded
   controls that need it.~~ Landed 2026-09-21. The controls went on the title
   page rather than the wall, which is where the design puts them: a 118px tile
   is a poor place to put a toggle that hides the tile.

The three screens above were built on Tailwind's defaults — slate greys and
system-ui — because the design had never been written down. The palette and the
type split landed 2026-09-19, so the shell, the wall, the grid and the add
screen are on espresso and Archivo / Martian Mono now. What the screens still
owe the design, all checked against the running app rather than guessed:

- ~~The title page has no second pane and no CTA row.~~ Both landed
  2026-09-21. Everything the design names for the three screens is now built.
- The rail carries HOME, LIST and ADD. `YEAR` is still not offered: the
  mockup's rail has it with no screen behind it, and an item that goes nowhere
  is worse than a shorter rail. See "Still open" in
  [web-design.md](web-design.md).
- ~~The add screen still only adds.~~ Landed 2026-09-21: season checkboxes and
  the commit bar, so a backfill is one screen again.

The chip row landed 2026-09-20 with the facets the design names, and
`PUT /titles/:id/intent`, the marking controls and the intent controls all on
2026-09-21.

Two things had to land on the API side first, and the second was a surprise:

1. `GET /titles` for the wall and `GET /titles/:id` for the grid. Neither
   existed — `GET /search` asks TMDB, not the database — so the SPA had nothing
   to render. Both landed 2026-09-18.
2. ~~Backfilling the imported episode grids.~~ Done 2026-09-18 via
   `pnpm backfill:episodes`: 79 episode rows became 829, Bleach went from an
   apparently-complete 8 of 8 to 8 of 424, and ONE PIECE S2E5 exists as a row,
   so the hole is now something the grid can draw. It also surfaced eight Bleach
   episodes carrying watch history that TMDB has never heard of — see
   [data-model.md](data-model.md) for both.

3. ~~`GET /titles/:id`, the title page's data.~~ Done 2026-09-18: the title's
   summary narrowed out of the same query the wall uses, plus its grid grouped
   by season with each episode's watch state and both precisions. ONE PIECE
   S2E5 now comes back as `WAX ON, WAX OFF`, aired 2026-03-10, `seen: false` —
   a labelled hole rather than a missing row.

4. ~~Recording whether a hole was skipped or never downloaded.~~ Settled and
   built 2026-09-19: the viewer declares it. `episode_gap` holds one row per
   episode with a reason of `skipped` or `missing` and an optional note,
   written through `PUT /episodes/:id/gap` and cleared with `DELETE`. The
   reasoning, including why `library_presence` is not the answer, is in
   [data-model.md](data-model.md).

The API now covers the reads the SPA needs and all four of its write paths:
adding a title, marking things watched, explaining a hole, and recording what
the viewer wants of a title. The SPA calls all four.

## Next

1. **The Plex library walk, and the merge that follows it.** Measured
   2026-09-21 and written up in
   [plex-api-findings.md](plex-api-findings.md) § Watched state outlives the
   history log: the history endpoint was the wrong endpoint. It gave 85
   episodes back to 2025-10-24; the library carries 373 back to 2019-06-11,
   every one of them dated, and hands over imdb / tmdb / tvdb inline so no
   resolution pass is needed. Against what is stored today:

   | | episodes |
   |---|---|
   | Already covered by a dated event | 79 |
   | Covered only by an undated manual mark, so they gain a real date | 126 |
   | Belong to 11 shows Engram has never heard of | 168 |

   Plus 52 shows and 29 movies for `library_presence`, which has never had a
   row in it, and *Dune: Part One* — watched 2021, the only watched film
   besides the one already stored. The 126 are the point: they were marked by
   hand on the belief that the dates were gone, and they were not.

   The films look thin — 2 watched of 29 — and that is the record being
   right rather than incomplete. Checked with the viewer 2026-09-21: everything
   is watched on Plex, so the other 27 are a backlog, not history to recover.
   Movies need no reconstruction, only somewhere to be seen. See the wall item
   below.

   Three commits, in this order. The walk is owner-scoped by the same property
   as the dump — per-item view state is the token's own — so it does not wait
   on the allowlist below.

   1. ~~`play_count` counts play-grained rows only, floored at one.~~ Done
      2026-09-21, with `watch_event.plays` for the count an episode-grained
      source gives instead of enumerating. Stranger Things went from 50 claims
      to 42 viewings; Bleach's two real rewatches still read as two.
   2. The walk itself, in two halves. The dump landed 2026-09-21:
      `pnpm dump:library` writes every section's items and every watched
      show's watched episodes to `tools/out/`, the same split the history dump
      uses so a normalizer bug stays recoverable. Measured against the live
      server on the day: 81 items, 24 of them watched, 373 watched episodes,
      none undated, 2019-06-11 to 2026-09-13.

      `planLibrary` landed the same day: pure, and unlike the history importer
      it needs no resolution report, because `includeGuids=1` decides identity
      inline. Against that dump it plans 81 titles, 81 presence rows, 373
      episodes and 375 events with no collisions and nothing dropped — and 68
      of those events carry a `plays` above one, rewatches the log never knew
      about. The writer is what is left.

      ~~The writer.~~ Landed 2026-09-21. `pnpm import:library` against the
      live record, and it did what the table above predicted:

      | | before | after |
      |---|---|---|
      | Shows | 11 | 53 |
      | Movies | 1 | 29 |
      | `library_presence` rows | 0 | 81 |
      | Dated events | 86 | 461 |
      | Record reaches back to | 2025-10-24 | **2019-06-11** |

      **126 hand-made marks gained a real date**, the number measured before
      any of this was written. The import deletes nothing — it touches only
      rows of its own source, so the 653 manual claims and 86 history rows
      standing at the time were left exactly as they were. The dates arrive
      because the projection prefers a dated claim, not because a better one
      replaced a worse one. A second run wrote 0 new events.

      One episode reads three viewings where the log knew of one — Fallout
      S2E6, whose `viewCount` is 3 against a single history row. That is
      `plays` doing the job it was added for.

      The two existing backfills finished the job the same day, both against
      the enlarged library and neither needing a change: `backfill:episodes`
      took the grids from 1135 rows to 2467, because the walk writes only the
      episodes something was watched in and the rest of each season would
      otherwise read as holes; `backfill:metadata` fetched art and overviews
      for the 70 titles that had never had any. Posters are now on every title
      in the database. Run them after any walk that adds titles.
   3. Wire it into the nightly reconcile, so it stays a reconciliation rather
      than a one-time import. The writer already does the half a webhook
      cannot: a title that was present and is not in this walk is marked gone
      rather than left standing, scoped to rows the walk owns so Sonarr and
      Radarr are not overwritten later. It has never fired — the first walk
      found nothing missing — so it is unproven against real removals.

   Idempotency is not copied from the history importer. Settled 2026-09-21:
   `onConflictDoNothing` is right for a history row, which never changes, and
   wrong for this source, where a rescan of the same episode is the same claim
   with a later date. The walk uses `onConflictDoUpdate` on `watched_at`,
   `plays` and `raw`, scoped to `plex-library` alone.

2. **A wall that survives the walk, and where films live in it.** The walk
   takes the library from 12 titles to 82 — 53 shows and 29 movies — and the
   wall has only ever been seen at 12. Movies are not the problem: the code is
   already kind-aware end to end, audited 2026-09-21. `deriveState` returns
   only `seen` or `unwatched` for a movie ([apps/api/src/titles/plan.ts:121](../../apps/api/src/titles/plan.ts#L121)),
   so `going`, `drifting` and `gaps` cannot false-match one; `episodesInScope`
   gives a film a single null slot and rejects a season scope; the title page
   already branches on `film` and drops the grid. A movie section as a separate
   screen would duplicate all of that for nothing.

   What is actually missing is narrower:

   - ~~**A kind filter on the wall.**~~ Landed 2026-09-21. *All · Series ·
     Movies* as one control ahead of the chips, which then count within it.
     Under Movies the three run chips are not drawn — they cannot ever match —
     and the next-up band goes with them. The title page's list pane got the
     same control the same day, because it sorts by state alone and was
     putting the run being worked through between two movies. The choice
     travels on the links rather than being redirected to, so Back still
     goes back. Reasoning in [web-design.md](web-design.md).
   - ~~**Somewhere for the backlog.**~~ Settled 2026-09-21 by not building
     it. Movies plus *Unwatched* is the backlog, 27 of them, and a chip saying
     that in one word would be a synonym for two controls already there. What
     is still unfilled is the next-up band's shape for a film: `GET /next-up`
     is `where t.kind = 'show'`
     ([apps/api/src/titles/next-up.ts:133](../../apps/api/src/titles/next-up.ts#L133))
     and the band is simply hidden under Movies rather than answered.
   - ~~**The `onDisk` null problem goes away.**~~ The walk gave
     `library_presence` its first 81 rows, so `onDisk` means something now.
     *Not on disk* still reads 0, which is correct: nothing has left yet. The
     one title with a null is Dexter, which Plex has never held.
   - ~~**The figure reads as arithmetic, not as a duration.**~~ Landed
     2026-09-21. `formatSince` and `formatAgo` now share one `step`, so the
     compact figure and the sentence cannot disagree about which unit a gap
     deserves: days for the first month, rounded months to eighteen, then
     years. The drifting band reads `10mo · 10mo · 11mo · 11mo · 3y · 4y · 5y`
     where it read four-digit day counts. Sharing the stepping also fixed
     "1 months ago", which the sentence had been saying for the fortnight
     either side of the month threshold.

   The eighth chip, *Added by hand*, was removed the same day — it read 58 of
   82 because a title with no events fell to a default rather than to the
   rule, and corrected it matched one. See [web-design.md](web-design.md).

3. ~~**Owner-only ingest**~~ — landed 2026-09-21 as `PLEX_ACCOUNT_IDS`,
   enforced in `planImport` before a row is parsed. Defaults to the server
   owner rather than to everyone, refuses an allowlist that names nobody, and
   will not keep a play whose account the source did not state. A foreign play
   is counted rather than reported as a failure, because a housemate watching
   something is not a defect in the dump. Nothing about the stored record
   changed — all 86 history rows are account 1 — which is the point: it is
   there for the webhooks below, which fire for every viewer on the server.
   Reasoning in [ingest-architecture.md](ingest-architecture.md).
4. **Webhook receivers** — Tautulli done 2026-09-21, Sonarr still to come,
   per [ingest-architecture.md](ingest-architecture.md). Tautulli
   authenticates on `WEBHOOK_SECRET`, filters on `TAUTULLI_USER_IDS` before it
   writes anything to a log, sits on the guard's open list as `POST
   /webhooks/tautulli` — the list is keyed on method and route pattern
   together, so nothing else about the path is opened with it — and turns a
   Playback Stop into a title, an episode and a play. Idempotent on the
   instant, so a redelivery collapses and a rewatch does not; a stop that did
   not finish is stored too, and `watch_state` counts and dates only the ones
   that did.
   It refuses nothing: a body it cannot plan is logged and answered 204,
   because the nightly walk is what recovers the play and a non-2xx only marks
   the delivery bad in Tautulli's own log.
5. ~~**Go live**~~ — live 2026-09-21 at <https://engram.vyoh.gg>, second
   tenant on the netcup box. The full record restored rather than started
   empty: 82 titles, 1109 events, 2467 episodes, reaching back to 2019, every
   count matching the development database it came from. Nightly backup
   installed and its restore drilled against that real data. Account in
   [go-live.md](go-live.md), which also holds the one thing still open — no
   copy of the dumps leaves the box.
6. **Web depth** — scoped 2026-09-21 in [web-depth.md](web-depth.md). The
   three screens are built and the system holds, but the app shows the record
   and almost nothing about the thing recorded: an episode is a number with a
   name, and until arc 1 chunk 1 landed on 2026-09-21 the stored `overview`
   never reached the browser. Five arcs, in order — say what the thing
   is (overview, episode synopsis and still, linked ids), the facts the state
   vocabulary is missing (show status, which also settles the drifting
   decision below), manual entry as a first-class verb (range marks, a date
   field that remembers, keyboard walk), the screens the rail owes (YEAR,
   export, a home for `want`) and the visual pass (the state bar as a
   progress bar). Arc 1 first; its first three chunks spend no TMDB calls.
   Arc 1 is complete: chunks 1 and 2 landed 2026-09-21 — the header says what
   the title is, the episode popover is a card with a still and a synopsis —
   and chunks 3 and 4 on 2026-09-22 — the season heading derives its years,
   size and seen state from the cells, and every external id links to its
   catalogue page and the owner gets a Plex search link that needs no `ratingKey`. Chunk 2
   carried migration 0011; deployed and backfilled on the box 2026-09-22.
   Chunks 3 and 4 are not yet deployed. Arc 2 chunk 1 landed 2026-09-22 —
   TMDB's status and next air date stored (migration 0012) and drawn on the
   header — deployed and refreshed on the box the same day. Chunk 2 landed
   2026-09-22: a closed run is drifting whatever its dates, a run with a dated
   episode ahead is not, label unchanged; not yet deployed. Chunk 3, *Hours as
   a figure*, is next.
7. **"Now watching"** — not started. The only part settled is which API
   answers it: Plex's `/status/sessions`, verified 2026-09-21 against the live
   server, which returns every current session with its user, player, platform
   and view offset. Tautulli is not involved and would only add a dependency
   for something the server already says — reasoning in
   [ingest-architecture.md](ingest-architecture.md) § Webhooks are an
   optimization.

   Three things make it unlike anything built so far. **It stores nothing**: a
   live session is true for ten minutes and has no place in an append-only
   record, so this is the first route with no table behind it and the first
   screen state that cannot be rebuilt. **It needs a Plex token on the box**,
   which production does not have — `PLEX_TOKEN` is a tools-only variable and
   the deploy's documented environment omits it deliberately — and the token
   has to stay server-side, so the SPA polls Engram and Engram polls Plex.
   **The server is shared**, so the response is filtered by viewer again, and
   this time on `PLEX_ACCOUNT_IDS`: `/status/sessions` speaks Plex's own
   namespace, where the owner is `1`, not Tautulli's `7597797`. That is the
   third source with its own account namespace and the third chance to use the
   wrong one.

   Two unknowns to settle before scoping. Whether the netcup box can reach the
   Plex server at all: the tools find it through plex.tv discovery rather than
   a configured URL, and that has only ever run from the laptop. And the poll
   interval, which is the whole cost of the feature — nothing else in the app
   asks a question on a timer. Surface, and the band it competes with, in
   [web-design.md](web-design.md) § Still open.

## Blocked

- ~~**Tautulli is not installed.**~~ Installed 2026-09-21 and reachable on a
  dedicated port, `http://enyo.bysh.me:8181` — see
  [ingest-architecture.md](ingest-architecture.md) § Host topology. Set up
  and serving its dashboard. Its API is switched off, which blocks a pull and
  `get_activity` and nothing else — the webhook is Tautulli posting outward
  and needs no API of its own, and the pull has been dropped.
- ~~**Tautulli webhook payload shape is unverified.**~~ Measured 2026-09-21
  against the live install, one real film and one real episode. Every
  external id populates for both kinds, so neither needs a resolution pass,
  and both matched what the walk had already stored. Four traps and one
  silent failure came with it — season and episode arriving as `"0"` on a
  film, `episode_name` holding the film's title, `view_offset` in
  milliseconds beside `duration_sec` in seconds, everything a string, and
  `{user_id}` being a different namespace from the account id the backfill
  filters on. All in [ingest-architecture.md](ingest-architecture.md)
  § Tautulli specifics.

## Decisions still open

- **Whether marking a season watched should step over a declared hole.** It
  does not today: `planWatchEvents` expands a season mark over every episode in
  it, so a season holding an episode the viewer declared `missing` — never had
  it — gets a watch event written over that episode too, and the reason is left
  behind as stale. The grid already treats seen as winning over a stale reason,
  so nothing displays wrongly, but the record now says something the viewer had
  explicitly denied. Options: exclude declared holes from a bulk mark, clear
  the reason as part of the mark, or leave it and treat the bulk mark as the
  later and better-informed claim.
- **How long a show sits before it is drifting.** `DRIFTING_AFTER_DAYS` in
  `apps/web/src/wall/facets.ts` is 180. It was judged against a library of
  eleven where it separated four abandoned shows from five in rotation — and
  that library no longer exists to judge against. As of 2026-09-21 the record
  holds twelve titles of which ten are finished, so exactly two are in progress
  and the threshold decides one of them. There is nothing left to tune it on.
  Revisit when enough is in progress for the answer to be observable; `dropped`
  is settable now and says the same thing explicitly, which may make the facet
  redundant rather than mistuned. Narrowed 2026-09-22 by web-depth arc 2
  chunk 2: the threshold no longer decides a closed run (always drifting) or a
  run with a dated episode ahead (never), so it only measures a returning show
  with nothing scheduled — on the production record, one show.
- ~~**Whether legacy-agent libraries exist here.**~~ Answered 2026-09-21, by
  the library dump the same day — it keeps the raw `Guid` arrays, which is what
  nothing captured before it. **No legacy agents on this server.** All 81 items
  carry `plex://` and a modern `imdb` / `tmdb` / `tvdb` trio, and no guid
  anywhere in the dump matches `com.plexapp.agents`. `parseGuid` still handles
  the legacy form ([packages/shared/src/guid.ts](../../packages/shared/src/guid.ts)),
  so a library that arrives with one is parsed; the season and episode it
  carries stay discarded, which costs nothing while no such library exists.

  One thing the raw arrays did show: *Demon Slayer: Kimetsu no Yaiba Infinity
  Castle* carries **two** `tvdb` guids, 357928 and 357931. It is a film, keyed
  on tmdb, so identity is untouched — which is the argument for keying on the
  canonical source alone, arriving unprompted.

## Done

- **2026-09-22** — Bulk add on `/add`, and search results that know what the
  record already holds. Adding a trilogy was three searches, three adds, three
  backfill screens and three navigations back, because every add landed on the
  title it had just created. Every unheld candidate now carries a checkbox; a
  selection posts one `POST /titles` at a time — a personal TMDB key is not for
  twenty parallel title-and-season fetches — and lands on one batch screen: a
  whole-title tick each against a single shared date, with the same commit bar
  naming both units when the selection mixes films and series. Per-season
  precision stays on the single-title path, which is untouched.

  `GET /search` now answers a `storedTitleId` per candidate, matched on kind
  and TMDB id together because TMDB numbers films and series separately. The
  browser could not work this out for itself: a show is keyed by its tvdb id,
  so the wall's key and a candidate's id never meet. Held-back results are
  counted out loud rather than dropped quietly, and the results cache is
  patched in place after an add rather than invalidated — a refetch there is
  another call against the owner's key to learn what is already known.

- **2026-09-22** — `/settings`, the owner's page about the record, with the
  excluded titles as its first block. Excluding a title took it off the wall,
  and the wall's own *Show excluded* link was the only way back — mixed in
  with everything else, with no view of only the rejects. The page lists them
  by name with a *Restore* per row (`PUT /titles/:id/intent` with
  `excluded: false`; no API change). Owner-gated like `/add`, reached from a
  *Settings* link beside the sign-out rather than from the rail: the rail is
  the record's sections, and its 38px items were sized for four-letter words.
  Later owner-only blocks — the export [web-depth.md](web-depth.md) arc 4
  already puts on this route — are further `Section`s here, not screens.

- **2026-09-21** — Settled: a large season 0 goes to the bottom of the page.
  Nothing is dropped and nothing stops being imported — the count is honest and
  TMDB's data is not ours to throw away — but the page draws the run first and
  the specials last, where a bonus disc belongs. House of the Dragon opened on
  `Specials · 0 of 89` about a show whose run is complete; The Boys has 76,
  Dexter 42, Fallout 24, so it was systemic rather than one show's quirk. The
  API still sends season 0 first, which is where it sorts; ordering it is the
  page's job, as the design says.
- **2026-09-21** — Settled: keep Plex's `viewCount`. `watch_event.plays` holds
  how many plays one row stands for, where the source counts instead of
  enumerating, and `watch_state.play_count` became
  `greatest(play-grained rows, max(plays), 1)`.

  The walk that produces the number is not built yet, which is exactly why this
  went first: `open-work.md` already said to land the counting change before the
  data that exposes it, and a walk with nowhere to put `viewCount` would discard
  the one fact about a rewatch that survives the media being deleted.

  It also fixed a count that was already wrong. `count(*)` counted claims, not
  viewings, so the eight Stranger Things S5 episodes carrying both a manual mark
  and a history row read as two plays of one viewing — 50 for the show against
  42 real ones. Bleach S17E45 and S17E47 are two genuine rewatches and still
  read as two.
- **2026-09-21** — Settled: what the owner meant is theirs, what they watched is
  the record. `want`, `dropped` and `excluded` come back false to a stranger on
  both reads; `onDisk` stays, being a fact about the record rather than an
  opinion about a title. They fall on the line `authentication.md` already drew
  for a gap's note, and were only public because nobody had argued it either
  way.

  `withoutGapNotes` is `asStranger` now, since it does two redactions rather
  than one. It keeps its field-by-field list so a new field on `TitleDetail`
  fails the build until someone has said so; the summary's `withoutIntent`
  spreads instead, because a card is public by default and the exceptions are
  what needs naming.
- **2026-09-21** — Settled: an episode that has not aired is neither marked nor
  offered. It was an open question and turned out to be a defect — marking a
  season wrote plays for television that does not exist yet, and two of them
  were on the record (Bleach S2E49 and S2E50, airing 20 and 27 October). Both
  retracted; Bleach reads 422 of 424 and is in progress again, which is true.

  A bulk mark steps over them, because "I watched season 2" is true of the
  season as it stands. Naming one outright is refused with `has not aired yet`,
  because that is a claim about a specific episode and it cannot be right. A
  season entirely still to come answers `none of that has aired yet` rather
  than "no such season" — the caller should be able to tell those apart.

  **A null air date is not "unaired".** It means TMDB has no date, and eight
  Bleach episodes carry real Plex plays with nothing to date them by; treating
  the absence as future would refuse to record history that already happened.
  Only a date after today disqualifies. The comparison is two `YYYY-MM-DD`
  strings against the server's day: an air date is a day rather than a moment,
  and making it one would put "has it aired" at the mercy of a timezone nobody
  chose.

  The card's fraction still counts unaired episodes, so a show you are caught
  up on reads as short rather than complete. That is consistent with TMDB's
  episode list and with `episode_total` everywhere else, and changing it would
  touch the wall query, the facets and every seen/total figure.
- **2026-09-21** — The title page's second pane, which turns out to be the same
  thing as the rail's LIST rather than a screen of its own: the mockup lights
  LIST up *on* the title page, because the 216px column down its left is the
  list. That resolved the last two open screen items at once.

  Every title, grouped still going / unwatched / finished and ordered most
  recently watched first within each, undated last. A 24px thumbnail, the name,
  a 2px progress bar that turns `--drift` when the title is drifting, and how
  long ago in mono. The group order is how much each is owed rather than the
  order the states are declared in; the mockup had no unwatched title to place
  and this library can.

  It reads the same cached `titlesQuery` the wall fills, so moving between the
  two costs no request and they cannot disagree about what is where. The route
  loads both in parallel rather than one after the other, or the split draws
  half at a time. Pinned and scrolling on its own above the fold: a library of
  three hundred would otherwise make the page as tall as the list.

  LIST leads to whatever the pane would open on, derived from the same
  `groupedTitles` the pane uses rather than sorted again beside it — the rail
  pointing somewhere the pane does not open is the one way this can be visibly
  wrong. It is gone entirely when the library is empty.
- **2026-09-21** — The next-up band, over a new `GET /next-up`. Its own route
  rather than columns on `GET /titles`: it needs the episode either side of
  where each show stopped, and carrying that across three hundred cards that
  never read it would pay for the band on every page.

  "Next" is the first unwatched regular episode after the *furthest* one
  watched, not the most recent by clock — a rewatch of an early episode must
  not offer to continue from there — and not the first unwatched episode
  overall. Someone who watched S1E1-5 and then S1E8 is owed S1E9: the episode
  they skipped is a hole, and the wall has a facet that says so.

  Where nothing sits after that point it falls back to the earliest unwatched
  episode and says so through `continues`, which the band words differently
  ("still to see" rather than "next is"). That case is common rather than
  exotic here: an import that captured only recent plays leaves shows watched
  to the end of what is recorded and empty before it, and a band silent about
  all of them would be silent almost always.

  An episode declared `skipped` is never offered — the viewer already said they
  did not want it — while one declared `missing` still is: why it is absent does
  not stop it being the next thing to watch.

  Dropped and excluded titles are out, which is the first thing the intent flags
  are read for beyond display. Ordered by when the *furthest* episode was
  watched, not by the title's last play of any kind: rewatching the pilot last
  night says nothing about where the run is. Undated sorts last.

  The mockup's "play in Plex" action is not built and cannot be: Engram keeps
  no `ratingKey`, deliberately, because they are ephemeral and outliving them
  is the point of the project. There is nothing to build a deep link out of,
  and a button that opens nothing is worse than no button. "Not now" is kept
  and means this sitting only — held in component state, so a title still owed
  comes back next time the wall is opened.
- **2026-09-21** — The add screen's second half, which is the screen the
  working notes were missing and the reason the project got reframed: nothing
  here needs the title to be on disk, in Sonarr, or in Plex at all. Adding a
  title no longer navigates away from it — the seasons come back from
  `POST /titles` with their episode counts, and ticking them writes the history
  in the same visit.

  Season-level, never episode-level. "All seasons" leaves the specials out, the
  way a whole-title mark does, and a selection that covers every regular season
  collapses to one `scope: 'all'` request instead of one per season. The rest go
  sequentially: the API orders each expansion to keep concurrent writes off each
  other's row locks, and firing them together is the one thing that defeats it.
  A film gets a single tick instead, since `scope: 'all'` is the only mark it
  has.

  A failure partway through says how far it got. That is not politeness: a
  manual event id carries the date as written, so an owner who believes nothing
  landed and ticks again with a different date writes a second set of plays
  over the episodes the first pass already claimed.

  The commit bar states the write before it happens —
  `writes 19 episodes · source manual · precision year · presence not on disk`
  — and an unreadable date blocks it rather than being sent to be rejected. That
  is what finally justified `@engram/shared` in `apps/web`: the bar names the
  precision, and reading it with anything but `parseWatchedAt` would be a second
  date grammar in the browser describing a write that is not the one about to
  happen. `tsconfig.app.json` references the package so `tsc -b` builds it
  first.

  The planning is pure and unit-tested in `apps/web/src/add/plan.ts`, the same
  split the API's write paths use.
- **2026-09-21** — The intent controls, which is the last of the four numbered
  screens. Three toggles on the title page's action row — want to watch,
  dropped, excluded — over `PUT /titles/:id/intent`, which had been sitting
  unused since it landed that morning.

  On the title page rather than the wall, although the chunk plan said wall.
  The design puts them there, and the design is right: `excluded` takes the
  card off the wall, and a toggle that makes its own tile vanish under a
  mis-aimed click at 118px is a trap. The wall keeps printing the three as an
  annotation under the tile, which is all the mockup ever had it do.

  Three independent flags rather than one state, matching the table. They look
  mutually exclusive and are not: a show can be one you meant to get to and
  then gave up on, and collapsing that into a single value would make the
  record forget the first half of it.

  Labelled `Excluded` rather than anything clearer. The tile already prints
  that word and the chip row offers to show or hide by it, so a third name for
  one flag would cost more than the jargon does. No notice on success — the
  button's own pressed state is the answer — but a failure gets one, because
  the toggle springs back on the refetch and would otherwise undo itself with
  no account of why.
- **2026-09-21** — `DELETE /watch-events`, which takes a mark back. A mark is a
  claim, a claim typed into a box can be the wrong one, and a record you cannot
  correct is one you stop trusting.

  It deletes only `source = 'manual'`. A play Plex reported is something that
  was observed; deleting it here would not make it untrue and the next
  reconciliation pass would put it back, so the source is part of the predicate
  rather than an assumption about who is calling — one misdirected undo must not
  be able to eat the imported history this project exists to keep. Verified
  against the live database inside a rolled-back transaction: The Boys holds 32
  manual events across seasons 1-4 and 8 `plex-history` events in season 5, and
  a whole-title undo removes the 32 and leaves the 8.

  The scope is a query string rather than a body, because a DELETE carrying one
  is legal and badly supported by everything in between. It resolves through
  `episodesInScope`, extracted from `planWatchEvents` so that marking and
  unmarking cannot drift: specials stay out of a whole-title retraction exactly
  as they stay out of a whole-title mark, and both refuse a season the title
  does not have with the same 422.

  `GET /titles/:id` gained `manualPlays`, per episode and on the figure row, so
  the page can offer the control only where there is something to take back.
  Counted over the same set as `plays` — specials out, a null episode only for a
  film — or the figure would not match the one beside it.

  Two ways to reach it in the SPA, because a misclick is noticed at two
  different times. **Undo on the notice**, for the moment it happens: every
  mark that wrote something posts one, and it lives for twelve seconds rather
  than five so the way back is still there to be taken. **Take back N entered
  by hand**, on the episode popover and under the title header, for the one
  found a day later. Both say what went, and a play Plex reported is never
  offered, so the button cannot claim to remove what it has no business
  removing.

  The scope-shaped undo is not exact. It retracts every hand-entered play in
  the scope, not only the ones the last mark added, so marking a season "2019"
  and then "2020" and pressing Undo takes both away. Exactness would need the
  event ids, and a whole-run mark of ONE PIECE is eleven hundred of them — well
  past what a URL will carry. The count in the notice is the safeguard, which is
  why a retraction is counted in plays and never in episodes: a mark writes one
  event per episode so counting it in episodes is honest, but what is on record
  accumulates across marks, and "take back 2 episodes" inside one episode's own
  popover would simply be false. "Marked 3 episodes in season 2" followed by
  "Took back 5 plays" is the discrepancy showing itself rather than hiding.

  The notices are Radix Toast, in `apps/web/src/shell/Toasts.tsx`, mounted above
  the layout in the root route so one survives a navigation away from the screen
  that caused it.
- **2026-09-21** — Marking something watched from the title page, which is the
  half of the record Plex cannot supply. `POST /watch-events` had taken an
  episode, a season or a whole title since chunk 4; nothing in the SPA had ever
  called it, so the grid could say a hole was deliberate but not that it was
  filled. Three controls now do: one in the episode popover above the hole
  form, one beside each season heading, and one under the header for the whole
  run.

  The date is a free-text field rather than a picker, and blank is the expected
  answer. What a viewer backfilling a decade has is "2019", occasionally "June
  2019" and almost never a day; a picker would make them fill in the parts they
  do not remember, and `parseWatchedAt` already reads the precision off the
  shape of what was typed. Blank is sent as no field at all rather than as an
  empty string, so it stores as `unknown` precision instead of a claim.

  Each control disappears once its scope is complete, so no button offers a
  write that would do nothing. What it wrote is said in a notice rather than in
  the panel: `written` against `skipped`, because the write is idempotent on
  `(source, source_event_id)` and "that was already true" is a different answer
  from "that did nothing".

  A bulk mark still writes over an episode the viewer declared they never had;
  see the open decision below.

  Unmarking followed the same day; see the entry above it.
- **2026-09-21** — `PUT /titles/:id/intent`, the write path that was missing.
  Booleans on the wire — want, dropped, excluded — against a flag and two
  timestamps in the table: when a title was dropped is worth keeping, but a
  caller saying "I dropped this" has no business choosing the moment, so the
  server takes it from Postgres' clock the way the gap route does.

  A patch, not a replacement. Every field is optional and at least one is
  required, so leaving `excluded` out means unchanged rather than false —
  otherwise dropping a show would quietly un-exclude it. An upsert, because
  most titles have no `intent` row at all: the row is created by the first
  opinion anyone has about the title, and a caller should not have to know
  whether they are the first.
- **2026-09-21** — `typecheck:cc`'s second pass had never checked anything.
  `tsconfig.test.json` included `{apps,packages}/*/src/**/*.test.ts`, and
  TypeScript's include globs are not shell globs — it has no brace expansion,
  so the pattern matched no files and the pass compiled `vitest.config.ts`
  alone. The pass exists precisely because tests sit outside the build graph,
  so for as long as it has existed, no API test file has been typechecked.

  Found because a required field added to `TmdbTitleDetails` left four fixtures
  broken and `check:cc` still passed. Repairing the include surfaced 22 errors
  across six test files, all of them real and all mechanical: `RequestInfo` is
  a DOM type and this package is checked against Node's lib, stubs missing
  half of `TmdbClient`, and several places where `exactOptionalPropertyTypes`
  distinguishes a key set to undefined from a key that is absent — which in
  `plex-dump.test.ts` is exactly the distinction the tests are about, since
  Plex omits fields rather than nulling them.

  `apps/web` is deliberately not in that include: it has its own solution whose
  browser lib already covers its tests, and checking them against Node's lib
  fails on every `document`.
- **2026-09-21** — The title page opens on a backdrop, which needed a column
  before it needed any CSS. `backdrop_path` on `title` (migration
  `0006_fancy_falcon`), the field on TMDB's details response, and every write
  path that stores a poster now storing this beside it. The eleven imported
  rows were already marked fetched, so `backfill:metadata` grew `--refresh` to
  ignore `metadata_fetched_at` — which is how any column added after a backfill
  reaches rows that ran before it existed.

  The still bleeds past the 18px the rest of the page is padded by and fades
  into the background rather than ending at an edge, with the poster overlapping
  it and dropped to the design's 92px. Nothing but atmosphere sits on the image:
  the name and everything under it stay on solid ground, so a pale backdrop
  cannot take the text with it. Null is the ordinary case — TMDB has a poster
  for nearly everything and a backdrop for rather less — and the header simply
  starts at the poster when there is none.
- **2026-09-20** — The title page draws what the plays were, not only what they
  come to. A twelve-month strip under *When you watched it* — ONE PIECE's binge
  shows as a tight cluster in March against nine empty months — and an activity
  feed under it, last five of nineteen, each line its date, its episode, and a
  gold `rewatch` or a jade `by hand` where either applies. A rewatch is worth
  calling out because it is the one thing the grid cannot say: a cell is seen
  or it is not, however many times.

  The strip plots only dates precise enough to be a day. A coarse entry holds
  the first instant of the period it names, so a 2019 watch would put a mark on
  the 1st of January that nobody watched anything on. One mark per day however
  many plays it holds, and the heading says "recent plays only" when
  `figures.plays` exceeds what the API sent, since the cap can cut the older
  months off a long enough binge.
- **2026-09-20** — `GET /titles/:id` answers the plays themselves, not only
  what they add up to. `recentActivity` is every event the figures count,
  newest first, each carrying its episode, its date with the precision that
  date was recorded at, its source and whether it was a rewatch. It is what the
  activity feed and the twelve-month strip are drawn from, and `watch_event`
  rows had never been listed anywhere — they were summarised into `watch_state`
  and that was all anything could see.

  Capped at 400 rows: a title watched daily for a decade would otherwise put
  four thousand on the wire to draw five lines of feed. How many there are in
  total is `figures.plays`, counted over the same set — specials out, a null
  episode only for a film — so the feed can say "last 5 of 19" without carrying
  nineteen. The rewatch flag is ranked over everything the filter kept rather
  than over the page, so it does not change with how many rows were asked for.
- **2026-09-20** — The title page's figures became the design's stat box: a
  ruled row of cells, each a 17px mono figure over a 9px uppercase name, rather
  than a sentence. They are readings off the record and the design treats them
  as an instrument panel. A cell holds one figure, so the fraction's total
  moved to the Episodes heading beside `4 rewatched`, and the first-watch date
  shortened to what its precision allows, since a wrapped date in a 104px cell
  is not a reading. A day inside the current year drops its year and older ones
  keep it: the box can hold a day-precision first watch beside a
  year-precision last one, and a bare `15 Mar` sitting next to `2019` invites
  pairing two dates years apart. Which parts show is the precision's business;
  the order they appear in is the viewer's locale's.
- **2026-09-20** — The app shell, which is most of why the built app still did
  not look like the design. Everything before this was paint on the scaffold's
  skeleton: a centred `max-w-6xl` column under a plain header, where the design
  is a full-bleed application that pads 18px and fills the window. Now a 58px
  rail — jade mark, then text labels at 9px mono rather than icons, since four
  short words need no legend — and a top bar carrying the record search and the
  jade **+ Add watched**. The rail offers HOME and ADD only: LIST and YEAR have
  no screens behind them, and an item that goes nowhere is worse than a short
  rail.

  Searching the record is not searching TMDB. The box in the chrome narrows
  what is already on the wall by name, through `?q=`; `/add` asks TMDB for what
  is not on it yet. The query narrows before the chips are counted, so with
  something in the box a chip describes the results rather than a library that
  is no longer on screen.

  Density went with it, because that was the other half of the difference. The
  episode cells were `minmax(2.75rem,1fr)` and stretched to the container; they
  are now fixed 34×28 and wrap, the way the design draws them. A season is a
  shape to read at a glance, and cells that grow with the window are a row of
  buttons whose meaning changes as you resize. Season headings went to 9.5px
  mono, and the space between seasons from 32px to 10px.
- **2026-09-20** — The wall filters on the vocabulary the design names: still
  going, drifting, gaps, finished, unwatched, not on disk, added by hand, each
  chip carrying its count of the whole library. Facets rather than a partition
  — a show can be still going, drifting and full of holes at once.

  Two of them needed the API. `hasGap` is an unwatched episode with watched
  ones **either side of it, in the same season**; the first cut said "with a
  watched one after it" and flagged nine of eleven, because Bleach is 8 of 424
  with those eight in season 17 and every episode before them then counts as a
  hole. Bounded on both sides it flags exactly ONE PIECE, which is what the
  mockup's "Gaps 1" said against this same library. `manualOnly` is the absence
  of any ingested event, so a title added and never watched counts — that is
  how it got onto the wall.

  The wall now fetches the library once and narrows in the browser. A count of
  what survived the filter is not a count, and every chip carries one; filters
  are also instant rather than a round trip. `GET /titles` keeps its `state`
  parameter for callers that want it.
- **2026-09-20** — The title page draws its identity line and reads its figures
  off the API. `tvdb 392276 · tmdb 111110 · imdb tt11737520` under the name,
  each id named because a bare number says nothing about which catalogue it
  belongs to and TMDB numbers films and series separately; an id the title does
  not have is left out rather than printed empty. A film has a figure row for
  the first time — Infinity Castle reads `1 play · Feb 22 2026 first watched ·
  209d since last` where it previously showed nothing. `apps/web/src/title/
  figures.ts` is gone with its tests: it was the browser summing the grid, and
  the API now counts the same figures over a set a film is in too.
- **2026-09-20** — `GET /titles/:id` answers the identity line and the figure
  row: `ids` for the three external ids, and a `figures` block of plays,
  rewatched, first watched and last watched with each boundary's own precision.
  It replaces a first cut that summed the grid in the browser, which could only
  ever answer for a show — a film has no episode rows, its `watch_state` row
  carries a null episode. Two rules the SQL has to keep and the client version
  could not: season 0 is excluded so the figures agree with the seen fraction,
  and a null episode counts only for a film, because a show's title-level rows
  are Plex history that arrived without an episode number and summing those
  beside the per-episode rows counts the same watching twice.
- **2026-09-20** — The title page's figure row and presence pill. ONE PIECE now
  reads `19 plays · 15 of 17 episodes seen · 4 rewatched · Mar 15 2026 first
  watched · 176d since last`, which is the mockup's row against the real
  record. The first watch keeps the precision of the event it came from rather
  than the finest precision on the title — a remembered 2019 is genuinely the
  first watch even when a play last week knows the minute. The label on the
  last figure follows the precision: a coarse entry prints the period rather
  than a duration, and
  "since last" beside "2019" would read as nineteen years having passed. The
  presence pill is absent rather than "unknown" when nothing has reported,
  since no Sonarr webhook exists yet and every title would wear one.
- **2026-09-19** — The wall rebuilt to the designed tile. 118px columns on a
  13px grid, the state as a 3px bar under the poster rather than a badge over
  the artwork, names clamped to two lines with the subtitle past a colon
  trimmed and the full name on hover, and a title no longer on disk greyscaled
  instead of labelled. The tile's sentence became one mono figure: days since
  the last watch, or the period itself where the record only knows a month or a
  year, because counting days from a coarse entry's first instant would dress a
  guess up as a measurement. The year and the fraction moved to the title page,
  whose own metadata row now sets its figures in mono. Removing the badge makes
  state colour-only on the tile, so the link's `aria-label` is what carries it
  and has to keep doing so.
- **2026-09-19** — The design system applied to `apps/web`. The espresso
  palette and the Archivo / Martian Mono split live in `@theme`, with token
  names matching the mockup so the two can be read side by side. Checked in the
  running app rather than in the build output: gold and jade stay distinct at
  grid size, and Martian Mono's width is fine in the episode cells even at
  three digits. Two colours are derived rather than taken from the mockup —
  `--color-on-jade` for text on a jade fill, which the mockup hardcodes, and
  `--color-gap-tx`, because `--gap` as alert text is 3.97:1 and the mockup only
  ever fills a bar or a cell border with it. Skipped cells took gold rather
  than drift for the same reason: drift against gap is 1.22:1, and the two
  kinds of hole have to be told apart at cell size rather than in the popover.
  What the screens still owe the design is listed under Now.
- **2026-09-19** — The record reads for anyone; only the owner may change it.
  The guard was global-deny with a list of open paths, which made the whole
  thing a diary behind a login. The list is now keyed on method and route
  pattern together, so `GET /titles` and `GET /titles/:id` are open and `POST
  /titles` is not, and a write still cannot be opened by forgetting an entry.
  The guard resolves the session for every request and decorates
  `request.isOwner`, which is what lets the two open reads answer the owner
  more fully than a stranger: `GET /search` stays shut because it spends the
  TMDB key, `?includeExcluded=true` is clamped rather than refused, an excluded
  title is a 404 by id, and a gap's note is dropped on the way out while its
  reason survives. On the web side no control a visitor cannot use is shown at
  all — no gap form, no "Add a title", no excluded toggle, and `/add`
  redirects to `/login` with the way back attached. Reasoning in
  [authentication.md](authentication.md) § What a stranger may read.

- **2026-09-19** — Title metadata backfilled from TMDB. The Plex importer
  writes identity and history and never calls TMDB, so all eleven imported
  titles reached the wall with no poster — a grid of grey rectangles, which is
  exactly what the first round of mockups was rejected for. `pnpm
  backfill:metadata` walks every title with a TMDB id and no
  `metadata_fetched_at`, storing poster, overview and the fetch time; all
  eleven resolved, and a second run is a no-op. Keyed on the timestamp rather
  than on a null poster so a title TMDB has no artwork for is not asked about
  forever.
- **2026-09-19** — The settled design written down at last, in
  [web-design.md](web-design.md), with the approved mockup committed under
  `docs/design/`. It had been decided 2026-09-16 against real artwork and real
  history and then left in a chat log, which is why three screens got built on
  Tailwind's defaults.
- **2026-09-19** — Adding a title by hand at `/add`, reachable from the header.
  The query lives in the URL so a search is a place, but it is a plain query
  rather than a route loader: a loader would hold the navigation open until
  TMDB answers. Adding posts the candidate's kind and TMDB id, invalidates the
  wall and lands on the new title's page, treating 200 and 201 alike because
  either way the title now exists. A missing `TMDB_API_KEY` and an upstream
  failure are named rather than shown as a status, since one is the owner's to
  fix and the other is worth retrying.

- **2026-09-19** — The title page at `/titles/$id`: header from the same
  summary the wall draws, one grid per season, specials folded into a
  `<details>`. Every cell is a Radix popover trigger showing the episode's air
  date and watch history, and for a hole, a form that writes `PUT
  /episodes/:id/gap` or clears it with `DELETE`; the grid refetches rather than
  patching the cache. Seen wins over a stale reason in the cell's colour. Wall
  cards now link here. `@radix-ui/react-popover` is the first and only Radix
  package; recon was clean and the install diff was manifest plus lockfile.

- **2026-09-19** — The wall: `GET /titles` as a poster grid under `/`, with the
  state filter and the excluded toggle as links carrying `?state=` and
  `?excluded=true`, so a filter is a place the back button returns to. The
  route loader reads through the query cache; a stranger's 401 lands on the
  route's error component rather than an empty grid. The wire type is declared
  in `apps/web/src/api/titles.ts` by hand, mirroring the API's `TitleSummary`,
  since the web app cannot import the API package and `@engram/shared` has no
  reason to hold a response shape. Posters come straight from TMDB's image CDN
  at `w342`. Still no Radix: links and anchors covered every control.

- **2026-09-19** — `apps/web` scaffolded: Vite 8, React 19, TanStack Router with
  file-based routes and Query, Tailwind v4, tested through a memory-history
  router against a stubbed `fetch` under happy-dom. Wired into the root `tsc -b`
  graph as its own solution (browser `lib`, `noEmit`) and into Vitest as a
  second project so `test:cc` runs both. The generated `routeTree.gen.ts` is
  committed and excluded from Biome. `@tailwindcss/oxide`'s install script is
  denied like `esbuild`'s: the native binary arrives as an optional dependency.

- **2026-09-18** — Owner-only authentication shipped, all five steps. GitHub
  OAuth ported from `vyoh.gg` rather than reinvented: signed state with a
  timing-safe verify and a nonce cookie pinning the callback to the browser that
  started it, an owner check on the numeric id, and an opaque session token
  whose SHA-256 is all the database holds. The guard is global with an opt-out
  list, which is the opposite of how `vyoh.gg` applies the same guard and
  deliberately so — this API is private by design, so a forgotten entry locks a
  route rather than opening one.

  Three bugs the port carried or the shape invited, each caught before it
  shipped: `verifyState` compared UTF-16 string length against a `timingSafeEqual`
  that measures bytes, so one multibyte character in a crafted `state` threw
  instead of returning null; `next` was clamped when the state was minted but
  used raw when the redirect was built; and the nonce cookie was collected into
  an array rather than set on the reply, so a failed session write answered 500
  carrying no `Set-Cookie` and left the nonce live. The first two exist in
  `vyoh.gg` too and were reported there.

  Verified against the live database end to end: signed out, signed in, a
  guarded route reached, logout clearing the cookie and the row, the same cookie
  then shut out, and logging out again still answering 204.

- **2026-09-17** — `POST /watch-events` landed, which closes the manual write
  path: history older than this Plex server can now be entered at all. One
  request marks one scope — a whole title, one season, or one episode — and the
  route expands it into the per-episode events `watch_state` groups on, because
  a season-level row would be invisible to every query the UI makes.

  Idempotent by construction rather than by a check before writing: the event id
  is derived as `manual:{titleKey}:S2E5`, so pressing "mark season watched"
  twice writes nothing the second time and the response says how much was
  already on record. A date appended to that id is what makes a rewatch a second
  event instead of a no-op, and it is the date as written rather than as stored,
  so a remembered 2019 stays distinct from a known 1 January.

  Precision is read off the shape of the date rather than sent beside it —
  `2019` is a year, `2019-06-14` a day, an ISO instant is exact. Two fields
  could contradict each other and the check constraint only catches half of
  that. An instant must name its offset, or the same string would mean two
  different moments on a laptop and on the server, and a day that does not exist
  is refused in both forms: `new Date` rolls `2019-02-30T12:00:00Z` forward to 2
  March rather than failing.

  Specials sit outside a whole-title mark and are reachable by naming season 0,
  since marking a show watched is not a claim about its OVAs.

  Verified end to end against the live database: a season marked, re-marked as a
  no-op, dated as a rewatch, that date re-submitted as a no-op, a single episode
  already covered, a season that does not exist refused with 422, an unknown
  title with 404, a movie marked with no episode row and refused a season. The
  resulting `watch_state` reported one episode as `plays=3 first=2019 (year)
  last=(exact)` — the remembered year and the real Plex play each keeping their
  own precision, which is what the two boundary columns exist for. The five rows
  were then removed and the table was back to its 86.

- **2026-09-17** — `POST /titles` landed: a title the disk has never held can be
  stored, with its whole episode grid. One TMDB call carries the details and,
  via `append_to_response`, the tvdb id a show is keyed on; a show TMDB cannot
  give one for is refused with 422 rather than keyed on something else, since a
  second identity for one title is worse than no row. Episodes are created
  eagerly, one call per season, so a gap is a fact rather than an inference.

  Re-posting a title refreshes what TMDB says about it and answers 200 instead
  of 201, which makes the add screen safe to retry. Metadata is refreshed but
  identity is not: an id already on the row survives a TMDB response that omits
  it, because the Plex resolution pass found ids TMDB alone does not always
  return. Whether the row is new comes from `xmax` in the same statement rather
  than a prior select, so two concurrent posts cannot both claim to have created
  it, and the title and its episodes are written in one transaction.

  `tmdbId` is validated as digits before it reaches a URL: `..` in that position
  resolves against the base and would aim the owner's API key at an endpoint of
  the caller's choosing. Uncaught errors no longer answer with their own text
  either, which was echoing constraint names to the client.

  Verified end to end against the live database: search, create, re-create, five
  episode rows with names, air dates and runtimes, an upsert with every incoming
  id null leaving all three intact, the traversal refused, then the rows removed
  and the database back to 11 titles and 79 episodes.

- **2026-09-17** — `DATABASE_URL` and Compose agree again; the port mismatch
  that made every migration need an override is gone.

- **2026-09-17** — Titles can be marked as not the owner's: `intent.excluded_at`
  is a nullable timestamp, and a non-null value hides the title from the default
  view. A shared Sonarr and Radarr put things on disk nobody here will watch,
  and `want = false` could not say so — it is every row's default and already
  means "no opinion". Verified against the live database: column present and
  nullable, a round trip carrying a reason in `note`, and `excluded_at is null`
  partitioning cleanly. Reasoning in [data-model.md](data-model.md).

- **2026-09-17** — Title search landed: `GET /search?q=` over TMDB's
  `/search/multi`, returning kind, tmdb id, name, year, poster path and
  overview. Verified against live TMDB — 20 results for "the witcher", both
  kinds, posters and years intact. The key is a v3 one and authenticates by
  query parameter; the same key as a bearer token returns 401, so nothing about
  a request may reach a log line, and the client's error type carries the
  upstream status and nothing else. `/search/multi` also returns people, which
  are dropped. The route answers 503 rather than going unregistered when no key
  is configured, so a missing capability does not look like a wrong path.

  Routes now assemble through `buildApp()` in `apps/api/src/app.ts` and
  `server.ts` is the entry that owns the process. That is what makes a route
  testable: the first HTTP tests in the repo drive `app.inject()` against a
  stub, with no port, network or database.

- **2026-09-17** — UI direction settled. A poster wall filtered by state is the
  home, a title page built around an episode grid is where the work happens, and
  adding a title by hand is a screen of its own rather than a setting. Espresso
  ground so artwork is the only saturated thing on screen; jade for the
  affirmative, kept clear of the gold that means "in progress"; Archivo names
  things and Martian Mono sets every figure. Long names wrap to two lines and
  drop a subtitle past a colon, which is a layout answer to truncation rather
  than a typographic one.

  Two findings drove it. The owner's own record contains the argument: ONE PIECE
  S2E5 sits between a rewatch of E4 and a play of E6, so the UI has to let you
  say whether a hole was skipped or never downloaded. And TMDB returns
  `poster_path` inline with a search result while its image CDN needs no key
  — verified 2026-09-17, an unauthenticated poster returns 200 and a bad path
  returns 404 rather than 403 — so added titles carry artwork immediately and a
  generated cover is only the fallback.

- **2026-09-17** — Date precision landed, so the record can hold something
  watched years ago. `watched_at` is nullable and `watched_precision` carries
  `exact | day | month | year | unknown`, tied together by a check constraint in
  both directions; `watch_state` reports a precision per boundary rather than
  one for the row, since a group can hold a remembered year and an exact play at
  once. Verified against the live database: all 86 existing plays backfilled to
  `exact` with timestamps intact, the column default dropped so a later insert
  must state its own precision, a dateless row accepted and surfacing with null
  boundaries and a real `play_count`, both invalid combinations rejected, and a
  2019 entry beside an exact play reporting `year` on first and `exact` on last.
  Reasoning in [data-model.md](data-model.md).

- **2026-09-16** — Plex dump importer landed. All 86 plays imported from the
  archive with nothing dropped or degraded: 11 titles, 79 episodes, 6 rewatches
  detected. Re-running inserts 0 new events, so the idempotency the reconcile
  design depends on is proven rather than assumed. Plex history carries no
  progress fields at all — a row exists only because Plex already decided the
  item was watched — so these events are stored `completed` with a null
  percentage, and `completed` stays computed at ingest so Tautulli's real
  percentages can use the same threshold later.

- **2026-09-16** — `apps/api` landed: Drizzle schema for the five tables,
  Postgres 18 in Compose, migrations, config validation, health and readiness
  endpoints, and `ops/backup.sh`. Verified against a live database: the
  migration applies, `watch_state` derives correctly, re-ingesting the same
  source event is a no-op, and a duplicate canonical key is rejected.
  `watch_state` is a view rather than a table, so it cannot drift from the
  events it summarises and there is no rebuild step to forget.

- **2026-09-16** — `packages/shared` landed: canonical identity model
  (`titleKey`, `episodeKey`, `sameTitle`, `mergeIds`) and the Plex GUID
  normalizer, 19 tests. Shows key on tvdb and movies on tmdb to match what
  Sonarr and Radarr use natively, so their webhook payloads need no translation.
  `titleKey` returns null rather than inventing a key for a title with no
  external id: such a title cannot survive a redownload and must go to manual
  resolution. The normalizer moved out of `tools/`, which now imports it, so
  there is one implementation rather than two drifting copies.
- **2026-09-16** — Plex history archived before any further decay: 86 plays, 11
  titles, 2025-10-24 → 2026-09-13. Resolution pass returned 11/11 titles with
  full TMDB/TVDB/IMDb coverage. Findings in [plex-api-findings.md](plex-api-findings.md).
- **2026-09-16** — Named the project, chose separate API + React SPA over a
  single Next.js app, on the grounds that the background work (webhook receiver,
  nightly reconcile, enrichment queue, Plex write-back) is real backend work.
