# Episode alerts

**Status:** Building — scoped 2026-10-07, and Sonarr's webhooks read from
source the same day. Chunk 1 built, deployed and connected 2026-10-07, and
its first real grabs, imports and series add read against the source that
evening; a delete and a series delete have not fired yet. Chunk 2 built
2026-10-07 and deployed 2026-10-10: the `alert` table and the ready decision.
Chunk 3 built 2026-10-10 and not yet deployed: the walk lists every show's
episodes and the API keeps them as `library_episode`.
Chunk 5 built and deployed 2026-10-10: delivery through the notify hub, live
at `notify.vyoh.gg` the same day. From the API container the hub answered
its health check, refused a post with no secret, and took Engram's secret.
A test alert inserted by hand for Dexter: Resurrection S01E01 reached the
hub 5 seconds after it was decided and Discord 67 seconds after that, the
hub's quiet period; it stays in the table, delivered. Chunk 4 remains.

A new episode of a show being followed lands on disk at some hour of the
night, and nothing says so. Sonarr can post to Discord, but it pings for every
series it holds, dropped ones included, it cannot say where the viewer stands,
and it has no alert at all for the episode that aired and never came. Engram
knows what is followed and how far along it is, which is what turns a
download log into something worth being told.

## Settled

- **2026-10-04 — An alert reports only what happened without the owner.**
  Adding a series, a search started by hand, an upgrade, a delete: the owner
  already knows, so none of them pings, and neither does what follows directly
  from them. The rule is shared across projects, in commonplace's
  `notify-hub.md` § What earns an alert.
- **2026-10-04 — Recently aired episodes only.** That is the test that keeps
  the rule without asking Sonarr why it acted: the seasons it fetches after a
  series is added, or an old episode searched for by hand, aired long ago. How
  recent is a number for chunk 2.
- **2026-10-04 — Three alerts: ready, stuck, overdue.** Ready is the import.
  Stuck is a grab with no import hours later. Overdue is an episode that aired
  with nothing grabbed. A grab alone never pings: on the seedbox the import
  usually follows within minutes, and two pings for one episode is noise.
- **2026-10-04 — `SeriesAdd` creates the title**, rather than the next walk,
  and is never an alert. Sonarr is the owner's alone; Plex is the shared half,
  and the titles the walk brings in for other viewers are excluded by hand.
- **2026-10-04 — No Sonarr API key.** It has no read-only scope, so it would
  stay on the slot beside Sonarr, and the check that needs it is hourly, which
  goes beyond the one nightly container Bytesized authorized on 2026-09-27.
  Without it, overdue counts from the TMDB air date and the library walk is
  the reconcile. Revisited only if a day-late alert proves too coarse.
- **2026-10-09 — Delivery goes through the notify hub from the start.** The
  owner chose to build `notify.vyoh.gg` first rather than a Discord sender in
  Engram to be replaced by it later, so Engram never holds a Discord URL.
- **2026-10-07 — Alerts are rows before they are messages.** Deciding is
  Engram's and is built first; delivery drains what was decided. A Discord
  outage then delays an alert rather than losing it, and moving delivery
  behind the hub later touches nothing upstream of it.

## Followed

Derived, so no column: a show, not dropped, not excluded, and either wanted or
with a play behind it. `intent.started_at` exists in the schema and nothing
writes it, so "started" means a play in `watch_state`. A show the viewer has
caught up on stays followed, and it is exactly the one whose next episode
matters.

## What Sonarr sends

Read 2026-10-07 from Sonarr's source at `v4.0.20.3012`, the installed version
(`src/NzbDrone.Core/Notifications/Webhook/` and `NotificationService.cs`), not
yet from a live delivery — the first real ones are read against this.

- **Every event names the series by `tvdbId`**, alongside `tmdbId` and
  `imdbId`, so a show keys the way `titleKey` wants with no resolution pass.
  Each episode carries its season, number, title, `airDate` and `airDateUtc`:
  the ready alert's recency test has the exact air time for free. Overdue
  still has only TMDB's day, because an episode nothing grabbed is in no
  payload.
- **Two triggers send `eventType: "Download"`.** *On Import* sends one per
  episode file, with `episodeFile` and `isUpgrade`, and only for a new
  download — never a disk rescan. *On Import Complete* sends one per release,
  with `episodeFiles`, `fileCount` and a `releaseType` of `SeasonPack` or
  other, and no `isUpgrade` at all. The receiver tells them apart by
  `episodeFiles`. Chosen: *On Import*, not *On Import Complete*; it matches
  *On Episode File Delete*, which is also per file, and maps each file to its
  episodes exactly. A season pack is then one event per file, and the burst
  collapses where every burst does, at delivery. *On File Upgrade* is on as
  well, the owner's choice on 2026-10-07: a quality upgrade is kept as an
  import, told apart by `isUpgrade` and `deletedFiles` in `raw`, and is never
  an alert.
- **No event carries an id or a timestamp.** Idempotency derives from what is
  there: a grab per `downloadId` and episode, an import or a delete per
  `episodeFile.id` and episode, each with its kind, so a file's import and
  its delete stay two facts. A grab is dated when it arrives, which is all
  stuck needs.
- **A grab does not say what caused it.** RSS, a search, an interactive
  pick: Sonarr knows, and the payload has no field for it. A manual search
  for last night's episode still pings when it lands; rare enough to accept.
- **A delete says why** — `MissingFromDisk`, `Manual`, `Upgrade`,
  `NoLinkedEpisodes` or `ManualOverride`. The upgrade case is sent only when
  *On Episode File Delete For Upgrade* is on; it stays off.
- **One attempt, then Sonarr stops asking.** A failed post is logged and not
  retried, and a webhook still failing five minutes after its first failure
  is paused, skipping every event until it recovers. So the receiver answers
  2xx to anything it cannot plan, as Tautulli's does, and an outage on the
  box loses what Sonarr sent during it. That makes chunk 3's reconcile a
  requirement for overdue rather than a nicety.
- **Episodes are numbered the way TVDB numbers them.** Engram's grids come
  from TMDB and Plex, and where the orderings differ — long anime most of
  all — an event names a season and number the grid may not have. The
  receiver creates the row, as the Tautulli store does for Plex's numbering,
  and it is then one of the episodes [data-model.md](data-model.md) § Eight
  episodes TMDB has never heard of describes. Chunk 4 has to tell such a row
  from a TMDB episode that never arrived, or every misnumbered show reads as
  overdue.
- **It authenticates with a header.** The webhook form takes custom headers
  (under advanced settings) besides basic auth, so it sends the
  `x-engram-token` the Tautulli route already read, and the Sonarr route
  reads alone ([webhooks.ts:203](../../apps/api/src/routes/webhooks.ts#L203)).

## The model

Two tables, both generated from `schema.ts`.

- **What Sonarr did, per episode** — `library_event`, landed 2026-10-07: an
  append-only grab, import or delete, each with its raw payload and a unique
  `(source, source_event_id)`, the way `watch_event` is. Any current answer
  per episode is a reading over it, written when a check first needs one;
  reasoning in [data-model.md](data-model.md) § Presence per episode is a log.
  The walk's reconcile is a nightly snapshot rather than an event:
  `library_episode`, settled in chunk 3.
- **`alert`** — landed 2026-10-07: one row per thing worth saying, unique on
  its key (`ready@show:tvdb:392276/s03e0005`), with a delivered time set once
  the hub has taken it, and a refused time if the hub never will. A second
  decision about the same thing is a conflict, not a second ping. `behind`
  holds where the viewer stood, on the definition Next up already uses: the
  episodes still unwatched between the furthest one watched and this one,
  holes before that point not counted.

Each decision is a pure function — `planReadyAlert` for the first — that
takes the event, whether the show is followed and the grid it stands on, and
returns the alert or the reason there is none, tested with plain inputs like
`planWatchEvents`.

## Chunk 1 · The Sonarr receiver

`POST /webhooks/sonarr`, on the guard's open list by method and pattern beside
Tautulli ([guard.ts:68](../../apps/api/src/auth/guard.ts#L68)), on
`WEBHOOK_SECRET`. `SeriesAdd` writes the title; grab, import and delete write
events, creating an episode row when the backfill has not yet, as the
Tautulli store does; an import marks the title present. Like Tautulli it
refuses nothing: a body it cannot plan is logged and answered 204, and the
walk recovers it. Closes the Sonarr half of open-work.md Next item 4. Then the
webhook is added in Sonarr, and the first deliveries are read against the
source.

Built 2026-10-07: `library_event`, `planSonarrEvent` in
[sonarr.ts](../../apps/api/src/ingest/sonarr.ts), `storeSonarrPlan` beside it,
and the route in [webhooks.ts](../../apps/api/src/routes/webhooks.ts). A
series delete marks the title gone only when it took its files, and only for
a title the record already has, and only by updating a presence row that is
there; a grab touches no presence. Each event row keeps the body with its own
episode alone, since a season pack names every episode, overview and all. A
grab of a whole long series could pass the 1 MiB that nginx and Fastify allow
by default; it would be refused once, which Sonarr survives, and the limit is
raised on this path as on the walk's if it ever is. Deployed and connected
the same day, with migration 0015 applied on the box.

Read on the box that evening, against the source:

- **A season searched for is grabbed episode by episode** when single
  releases are what the indexers offer: Dexter: Resurrection S1 arrived as
  eight grabs about seven seconds apart, each its own download. The
  downloads go through SABnzbd, so a `downloadId` reads `SABnzbd_nzo_…`, not
  a torrent hash.
- **The first grab created the title** — Sonarr already held the series, so
  no series add came first — with its tmdb and imdb ids filled in, and the
  eight episodes with Sonarr's air dates.
- **Each import followed its grab by about two minutes**, keyed on the file
  (`@import@1142`), with `isUpgrade` false and a `releaseType` of
  `singleEpisode`, and marked the title present under `source = 'sonarr'`.
- **A series add for a show already on record changed nothing.** Lost,
  stored since 2026-09-22 with 118 plays, matched on `show:tvdb:73739` and
  kept everything it had.
- Each row's `raw` held its own episode alone, with `airDateUtc`, and
  exactly the top-level fields the source builds.

## Chunk 2 · Alerts, and ready

The `alert` table and the ready decision, run on every import: followed,
recently aired, not an upgrade. The row records where the viewer stands —
"one behind" — at the moment it was decided; chunk 5 sends it.

Built 2026-10-07 as `planReadyAlert` in
[ready.ts](../../apps/api/src/alerts/ready.ts), with `decideReadyAlerts`
beside it reading the follow state and the grid and writing what it decides.
Recent is 14 days from Sonarr's own air instant, falling back to its air day:
a week is how often most shows air, and twice that covers a release the
overdue alert already flagged. An episode already watched gets nothing, and
one behind the furthest watched gets an alert with no `behind`, since it is
a hole being filled rather than what comes next. The
route decides after the import's rows are stored and swallows a failure into
the log, since a 500 would count towards Sonarr pausing the webhook; the
record line names each episode that got no alert and why.

A show added to Sonarr while it is airing still pings for last week's
episode when Sonarr fetches it. That is the owner's doing and the recency
test cannot tell it apart; Sonarr's add, which would, is not kept as an
event.

## Chunk 3 · The walk keeps every episode

The walk fetched every episode of every watched show and kept only the
watched ones. Kept, they say which episodes Plex has, which is the reconcile
overdue needs: without it a missed `Download` reads as a late episode. Same
container and schedule; the walker image is rebuilt and pulled on the slot.
Whether to also read the shows nobody had started was this chunk's to decide.

Built 2026-10-10. The owner chose to list **every show's** episodes, not only
the shows with a play: then `library_episode` is everything in Plex, so a
missing row means a missing file for any show, including one followed later.
Plex held 53 shows that day, 24 with a play, so the walk makes 29 more
requests a night, one per show it skipped before, and its post grows from
about 1 MB to 3 MB, inside the route's 16 MiB. That reads more than the
2026-09-27 authorization's "same Plex requests as before" assumed: the same
container on the same schedule, reading more of the same library.

- **A snapshot in Plex's numbering.** One row per episode the walk found —
  title, season, number, Plex's `addedAt` and the walk's time — keyed on the
  numbers rather than tied to an `episode` row, so an episode Plex numbers
  differently from TMDB is kept rather than refused, and is the evidence
  chunk 4 needs to tell a misnumbered show from a missing episode. Each walk
  upserts what it found and deletes what it did not; one that found nothing
  deletes nothing, like the title sweep. Reasoning in
  [data-model.md](data-model.md).
- **Only a counted walk rewrites it.** The walk sends `summary.leaves`, every
  episode it listed, and the API refuses a body short of that count as it
  refuses one short of its items. A walk that did not count — the old walker,
  or an old dump through `import:library` — leaves the snapshot alone, since
  its watched episodes alone would read as every other one gone.
- **Watched episodes are written exactly as before.** Unwatched ones go to
  the snapshot and nowhere else: no `episode` row, no event, nothing in the
  grid. An unwatched leaf with no number is left out quietly; a watched one
  is still reported as dropped and fails the run.

## Chunk 4 · Stuck and overdue

A timer on the box, hourly. It reads only Engram's database, so how often it
runs costs Bytesized nothing; only the reconcile it trusts is nightly. Stuck:
a grab with no import after a few hours. Overdue: a followed show's episode
whose air date ended a full day ago, with no grab, no import, and absent from
the last walk. The unit checks in with healthchecks.io like the others.

## Chunk 5 · Through the notify hub

Drains undelivered alerts to the hub's `POST /messages` at `notify.vyoh.gg`,
one message per alert under the alert's own key, and marks an alert delivered
once the hub has taken it. Engram holds the hub's URL and a secret of its own,
never a Discord URL; collapsing a burst, the channel and Discord itself are
the hub's. Taken ahead of chunks 3 and 4, so ready alerts reach Discord before
stuck and overdue exist.

Built 2026-10-10 as `deliverAlerts` in
[deliver.ts](../../apps/api/src/alerts/deliver.ts), on a 15-second interval in
the API process, with the hub's client in
[notify/client.ts](../../apps/api/src/notify/client.ts). `NOTIFY_ORIGIN` and
`NOTIFY_SECRET` are set together or not at all, checked at boot; unset,
alerts are decided and wait. A message reads "Dexter: Resurrection S01E04 is
ready", then the episode's name and where the viewer stands — "1 episode to
watch before it", or "You're caught up: it's next" — linked to the title's
page. What the hub says decides the row, as commonplace's contract has it: a
202 marks it delivered, and nothing else does, so a proxy answering 200 in
the hub's place cannot swallow an alert; a 400 or 413 is the message itself,
so it is marked refused, logged with the hub's reason and never sent again;
anything else — a 401, a 5xx, no answer — ends the pass with nothing marked,
and the next one tries again.
Taken and then not marked is harmless, since the hub drops the repeat by
key. Production held no alert yet when this was built, so switching it on
sends no backlog.

## Needed from the owner

- ~~The Sonarr version~~ — `4.0.20.3012`, given 2026-10-07.
- After chunk 1 deploys: a webhook under Settings → Connect, pointed at the
  same base URL Tautulli posts to, with an `x-engram-token` header carrying
  the secret, under the form's advanced settings; username and password left
  empty. Triggers on: *On Grab*, *On File Import*, *On File Upgrade*, *On
  Series Add*, *On Series Delete*, *On Episode File Delete*. Off: *On Import
  Complete*, *On Episode File Delete For Upgrade*, and the rest.
- After chunk 3 is pushed: the API deploy, then `scripts/deploy-walker.sh`
  for the walker's new image. Either order works — the API already running
  takes the larger walk and ignores what it does not read — and the snapshot
  starts with the first walk after both, at 04:30.
- Before chunk 5 deploys: `NOTIFY_ORIGIN=https://notify.vyoh.gg` and
  `NOTIFY_SECRET` in `/srv/engram/.env`, the second copied from the hub's
  `SOURCE_ENGRAM_SECRET` in `/srv/notify/.env`. The Discord webhook URL goes
  to the hub, not here. ~~The hub deployed~~ — live 2026-10-10.

## Not in this arc

- **Sonarr's API**, for exact air times and its own missing list. Settled
  above.
- **Radarr.** A film arrives because the owner asked for it, which the rule
  already answers.
- **The hub itself.** Built in `~/dev/notify.vyoh.gg`; commonplace's
  `notify-hub.md` holds the contract this posts to.
- **Alerts in the web app.** Discord is where they are read.
- **Manual Interaction Required.** Sonarr sends it when a download needs a
  hand to import, which happens without the owner and is often what stuck
  is. A candidate fourth alert, or a stuck that fires at once instead of
  hours later; found while reading the source, not yet decided.
