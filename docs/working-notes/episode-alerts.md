# Episode alerts

**Status:** Plan — scoped 2026-10-07, nothing built. First step: read what
Sonarr's webhooks send, from its source for the installed version.

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

Not yet read. Before chunk 1, from Sonarr's source at the installed version,
then confirmed against the first real deliveries:

- **What each event carries** — `Grab`, `Download`, `EpisodeFileDelete`,
  `SeriesAdd`, `SeriesDelete`: the series ids, the episodes, and whether each
  episode carries its `airDateUtc`. If `Download` does, the ready alert's
  recency test has an exact time for free.
- **What makes a delivery unique**, for idempotency on
  `(source, source_event_id)` the way every other ingest is.
- **A season pack** — one event per file, or one per release. Per file means
  ready alerts collapse per title over a short window.
- **Whether a grab says it was automatic.** If not, a manual search for last
  night's episode still pings when it lands; rare enough to accept.
- **How it authenticates.** The receiver already reads `x-engram-token`
  ([webhooks.ts:37](../../apps/api/src/routes/webhooks.ts#L37)); if Sonarr's
  form cannot send a header, basic auth carries the same secret.

## The model

Two tables, both generated from `schema.ts`.

- **What Sonarr did, per episode.** The lean is an append-only event table —
  grab, import, delete, each with its raw payload and a unique
  `(source, source_event_id)` — with the current answer per episode a view
  over it, the way `watch_event` and `watch_state` are. The walk's reconcile
  is a nightly snapshot rather than an event, and its shape is chunk 3's to
  settle.
- **`alert`** — one row per thing worth saying, unique on its key
  (`ready:show:tvdb:392276:3:5`), with a delivered time that stays null until
  chunk 5. A second decision about the same thing is a conflict, not a second
  ping.

The decision is a pure `planAlerts` that takes the event, whether the show is
followed and where the viewer stands, and returns rows, tested with plain
inputs like `planWatchEvents`.

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

## Chunk 2 · Alerts, and ready

The `alert` table and `planAlerts`, run on every import: followed, recently
aired, not an upgrade. The row records where the viewer stands — "one behind"
— at the moment it was decided. Nothing sends it yet; it is read on the box.

## Chunk 3 · The walk keeps every episode

The walk already fetches every episode of every watched show and keeps only
the watched ones ([dump-library.mjs:118](../../tools/dump-library.mjs#L118)).
Kept, they say which episodes Plex has, which is the reconcile overdue needs:
without it a missed `Download` reads as a late episode. Same container, same
schedule and the same Plex requests as before, so inside the 2026-09-27
authorization; the walker image is rebuilt and pulled on the slot. Shows
wanted but not started are not fetched today — one request each, decided
here.

## Chunk 4 · Stuck and overdue

A timer on the box, hourly. It reads only Engram's database, so how often it
runs costs Bytesized nothing; only the reconcile it trusts is nightly. Stuck:
a grab with no import after a few hours. Overdue: a followed show's episode
whose air date ended a full day ago, with no grab, no import, and absent from
the last walk. The unit checks in with healthchecks.io like the others.

## Chunk 5 · Discord

Drains undelivered alerts to a Discord webhook, collapsing a burst per title
into one message. The URL lives in `/srv/engram/.env` and never reaches a log:
whoever holds it can post. Moves behind commonplace's notify hub once a second
project sends.

## Needed from the owner

- The Sonarr version (System → Status), before the source is read.
- After chunk 1 deploys: a webhook under Settings → Connect, pointed at the
  same base URL Tautulli posts to, with the secret.
- Before chunk 5: a Discord webhook URL.

## Not in this arc

- **Sonarr's API**, for exact air times and its own missing list. Settled
  above.
- **Radarr.** A film arrives because the owner asked for it, which the rule
  already answers.
- **The hub.** commonplace's `notify-hub.md`, once a second sender exists.
- **Alerts in the web app.** Discord is where they are read.
