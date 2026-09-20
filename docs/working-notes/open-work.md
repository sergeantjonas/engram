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
4. The `intent` write route on the API, and the wall's want / dropped / excluded
   controls that need it.

The three screens above were built on Tailwind's defaults — slate greys and
system-ui — because the design had never been written down. The palette and the
type split landed 2026-09-19, so the shell, the wall, the grid and the add
screen are on espresso and Archivo / Martian Mono now. What the screens still
owe the design, all checked against the running app rather than guessed:

- **The title page is still a third of the design's.** Its `02 · Title` opens
  with a 158px backdrop hero that the poster overlaps by 46px, sets the figures
  in a bordered stat box rather than an inline row, and puts a 216px list of
  every title down the left as a second pane. Then the twelve-month strip, then
  the grid, then the activity feed, then the CTA row. Header and grid exist.
- Missing entirely: the next-up strip, the list view behind the rail's LIST,
  and the title page's twelve-month strip, activity feed and
  mark-season-watched control. The rail carries only HOME and ADD until the
  screens behind LIST and YEAR exist.

The chip row landed 2026-09-20 with the facets the design names. What is left
of item 4 above is the `intent` write route and the want / dropped / excluded
controls: nothing writes `intent`, so those three are read-only on every card.

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

The API covers the reads the SPA needs and two of its three write paths —
adding a title, marking episodes watched, and explaining a hole. **One is
missing:** nothing writes `intent`, so the wall cannot set want, dropped or
excluded, which the settled design treats as part of filtering by state. That is
a small route over a table that already exists, and it can land alongside the
screen that needs it rather than ahead of it.

## Next

1. **Owner-only ingest** — an allowlist of Plex account ids in config, enforced
   at the ingest boundary, dropping a play by anyone else rather than storing
   it. Reasoning in [ingest-architecture.md](ingest-architecture.md). Must land
   before webhooks do: the backfill is owner-only by property of the Plex
   endpoint, and Tautulli fires for every user on the server.
2. **Webhook receivers** — Tautulli and Sonarr, per
   [ingest-architecture.md](ingest-architecture.md). Deferred deliberately:
   Tautulli is not installed, and receiving live webhooks in development needs
   either a tunnel or a netcup deploy. Routes must check `WEBHOOK_SECRET`, and
   must be added to the guard's open list when they land — they have no cookie
   jar, so the secret is their authentication rather than a session. The list
   is keyed on method and route pattern together, so the entry is `POST
   /webhooks/...` and nothing else about the path is opened with it.

## Blocked

- **Tautulli is not installed.** Bytesized was having problems as of 2026-09-16.
  Live webhook ingest cannot be verified until it is up. Everything through
  chunk 4's importer is unaffected, since the Plex dump is already captured.
- **Tautulli webhook payload shape is unverified.** Which external-id parameters
  actually populate per media type needs one empirical check against a throwaway
  endpoint before any parsing code is trusted.

## Decisions still open

- **What to do with a season 0 that is mostly featurettes.** House of the
  Dragon's title page opens with `Specials · 0 of 89`: TMDB's season 0 for it
  is 89 behind-the-scenes clips, and `backfill:episodes` pulled every one. The
  count is honest and season 0 is already excluded from the fraction, the
  facets and the figures, so nothing is wrong — but a line saying you have not
  watched 89 featurettes is the first thing the page says about the show.
  Options: collapse a season 0 above some size, drop `episode_group`-less
  specials at backfill time, or leave it. Nothing is broken either way.
- **How long a show sits before it is drifting.** `DRIFTING_AFTER_DAYS` in
  `apps/web/src/wall/facets.ts` is 180. It is a judgement made against a
  library of eleven: at 180 it separates the four genuinely abandoned from the
  five still in rotation, where 90 would have called almost everything
  drifting. Worth revisiting once the library is bigger, or once `dropped` can
  be set and says the same thing explicitly.
- **Whether `want`, `dropped` and `onDisk` are public.** They ride along on
  every card and a stranger sees all three. The first two read as annotations
  rather than facts about a title, and `onDisk` discloses what the library
  holds. Left public when the read/write split landed because the wall is the
  library — but that was not argued, it was defaulted. See
  [authentication.md](authentication.md) § What a stranger may read.
- **Whether legacy-agent libraries exist here.** If they do, the season and
  episode in a legacy GUID are the only carrier of that information and
  `parseGuid` currently discards it. See
  [ingest-architecture.md](ingest-architecture.md).

## Done

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
