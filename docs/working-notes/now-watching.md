# Now watching

**Status:** In progress — scoped 2026-09-25; chunks 1 and 2 landed the same
day, not deployed. Three chunks, one commit each, in order, then a step that is the
owner's, in Tautulli, once chunks 1 and 2 are deployed. No migration.

The wall's band says what to watch next from the record, and while something
is playing it says the wrong thing: "you stopped after S17E48 four days ago"
is false the moment S17E49 is on screen. Now watching is the band that knows a
session is live. It is the first thing Engram shows that the record does not
hold and never will — a session is true for as long as it plays and is never
written down.

## Settled

- **2026-09-25 — Tautulli pushes it; nothing polls Plex.** Plex's
  `/status/sessions` answers the question directly, but only to a token on the
  box, and the only token that reads it is the owner's account token: the
  server-scoped `accessToken` plex.tv issues for an owned server is the same
  string, checked 2026-09-25. That token administers the whole server and the
  plex.tv account, on a box with a second tenant. Pulling Tautulli's
  `get_activity` instead is worse — an API key that reads everyone's viewing,
  sent over 8181 in plaintext, which
  [ingest-architecture.md](ingest-architecture.md) already refused for the
  reconcile. Tautulli posts to Engram under `WEBHOOK_SECRET` today, so the
  push adds no secret anywhere. This reverses ingest-architecture.md
  § Webhooks are an optimization, "Now watching needs neither".
- **2026-09-25 — Nothing is stored.** Sessions live in the API's memory. A
  restart forgets a live session until its next event, which leaves the band
  absent rather than wrong, and a deploy is a moment the owner chose.
- **2026-09-25 — It replaces Next up while a session is live**, and is absent
  when nothing plays. Answers [web-design.md](web-design.md) § Still open.
- **2026-09-25 — Public.** `GET /now-watching` goes on the guard's open list.
  The answer is the title, the episode, the progress and the Play in Plex
  link; no player, device, address or other account leaves the API.
- **2026-09-25 — The SPA asks every 30 seconds while the tab is visible.** The
  poll ends at Engram; nothing upstream is asked on a timer.
- **2026-09-25 — Plex's artwork never reaches the browser.** A session's
  `thumb` and `art` paths load only with the token attached. The band draws
  Engram's cached poster, or the generated cover where none is stored.

## What Tautulli sends

Read 2026-09-25 from Tautulli's source on master (`plexpy/notifiers.py`,
`common.py`, `notification_handler.py`), not yet from the live install —
step 4 measures that.

- **22 triggers, none on a timer.** Every playback trigger fills the same
  session fields, so each one is a fresh reading of where the session is.
- **`{action}`** is the trigger's name without `on_`: `play`, `stop`,
  `pause`, `resume`, `error`, `intro`, `commercial`, `credits`, `watched`,
  `buffer`, `change`, and `intdown` for the server becoming unreachable.
- **`{session_key}`** identifies the session. **`{user_streams}`** is how
  many sessions the same Tautulli user has live at that moment — excluding the
  stopping one on a `stop`, which Tautulli filters out to avoid racing its own
  database, and on nothing else: an `error` counts its own session.
- **`{view_offset}`** in milliseconds, **`{remaining_duration_sec}`** in
  seconds (`duration_sec − progress_duration_sec`), and **`{unixtime}`** for
  when the notification fired.
- **`{plex_url}`** is the item on app.plex.tv, which is what makes Play in
  Plex possible without keeping a `ratingKey`.
- **A server trigger carries no `{user_id}`.** `intdown` is built by
  `build_server_notify_params`, which has no session to take one from.

The triggers to turn on: Playback Start, Stop, Pause, Resume and Error, the
Intro and Credits markers, and Plex Server Down. The agent takes a body per
trigger; each playback body is today's plus `action`, `session_key`,
`user_streams`, `view_offset`, `remaining_duration_sec` and `plex_url`, and
Server Down's is `action` and `unixtime` alone.

## The model

One entry per `session_key`: the title's external ids and names as the
payload gives them, the season and episode, `playing` or `paused`, the offset
and the instant it was true at, and an expiry. A pure function takes the
current entries, one event and nothing else, and returns the next entries:

- **`stop` and `error` remove the session; `intdown` removes every one.** The
  record of which sessions ended survives `intdown`.
- **Every other playback action writes the entry.** `pause` leaves it paused,
  `play` and `resume` playing; a marker or anything else keeps the state it
  found, and a session first seen through one is playing.
- **An event older than the entry is dropped**, by `unixtime`, so a late
  redelivery cannot rewind the band. An ended session's key is remembered, with
  the later of its stops, for the same reason — a pause delivered after its
  own stop must not bring it back. A key Plex hands out again is told apart by
  its later instant, so the hour it is kept for only bounds the memory.
- **`user_streams` bounds the entries.** Read as how many of the viewer's
  other sessions are live — the count itself on a `stop`, one fewer on
  anything else — it keeps that many of theirs seen most recently and drops
  the rest, so a Stop that never arrived is corrected by the next thing the
  owner plays. Per viewer, because Tautulli counts per viewer and the
  allowlist is a list. A count describes its own instant, so a session heard
  from after the event is never dropped by it.
- **Entries expire.** A playing one at its instant plus
  `remaining_duration_sec` plus five minutes, a paused one — or one whose
  runtime is unknown — an hour after it was last heard from. An expired entry
  is left out of the read and swept by the next event, never on a timer.
- **A payload with no `action` is a `stop`**; one whose `action` cannot be
  read is unknown, never a stop. Only Playback Stop is turned on today, so
  the receiver can ship before the template changes — and has to:
  a Start arriving at today's receiver is planned as a play that did not
  finish and written into a record that is append-only.

Progress does not tick. The read answers the offset advanced to the moment it
answers, and the band draws it as it arrives, so the bar steps every 30
seconds rather than moving — one thing moves in this app, and it is not this.

## Chunk 1 · The receiver reads `action`

Landed 2026-09-25. API only. `action` is parsed with the rest of the payload in
[tautulli.ts](../../apps/api/src/ingest/tautulli.ts). `stop`, or no action,
takes today's path unchanged; every other known action is answered 204 and
writes nothing; an unknown one is logged by name and answered 204. `intdown`
passes the user filter, since it carries no user and writes no row. A test per
branch beside the existing webhook tests. Once this is deployed the triggers
can be turned on without harm, before chunk 2 exists.

## Chunk 2 · Live sessions and `GET /now-watching`

Landed 2026-09-25. API only. The model above as a pure function in
[live/sessions.ts](../../apps/api/src/live/sessions.ts), with the clock passed
in; its entries held by an object `buildApp` creates, so each test app starts
empty; the receiver hands it every owner event, `stop` included, ahead of the
record's write, so a write that fails cannot leave the session showing.
`readLiveEvent` in [tautulli.ts](../../apps/api/src/ingest/tautulli.ts) reads
the payload and shares the title's identity with the play's plan. A stop from
a template without `session_key` still records its play, and warns that it
could not be read as a live event. `GET /now-watching` on the open list: each
live entry resolved to a stored title through `titleKey()` for its id, name
and poster, and answered with the payload's names alone while the title is not
stored yet — the Stop is what creates it. `plex_url` is passed through only
when it starts with `https://app.plex.tv/`. Unit tests for each rule in the
model; route tests through `app.inject()`.

## Chunk 3 · The band

Web. A query with a 30-second `refetchInterval` that pauses while the tab is
hidden. The wall draws Now watching in Next up's place while the answer holds
a session, and Next up otherwise; it follows the kind filter, so a film shows
under All and Movies and a show under All and Series. A card holds the poster
or the generated cover, the name, the episode code in mono, a bar with the
time left, *Paused* as a word rather than a colour, and *Play in Plex* when
there is a link — one card per session, and more than one is rare. Its scrim
and contrast are measured the way
[visual-finish.md](visual-finish.md) chunk 4 measured Next up's. Checked in
headless Chrome, with `/now-watching` answered from fixtures by the CDP
harness. web-design.md's § Still open entry moves into § 01.

## Step 4 · Turned on and measured

The owner's, once chunks 1 and 2 are deployed: add the triggers and fields
above to Tautulli's webhook agent, then play something for a few minutes.
One payload of each action is read from the API's log on the box, and
anything that differs from the source reading goes into
[ingest-architecture.md](ingest-architecture.md) § Tautulli specifics.

## Not in this arc

Three triggers would change the record rather than the band, and each is a
decision of its own:

- **Credits marker as "finished".** Reaching the credits says more than any
  percentage — ingest-architecture.md notes credits make a 42-minute episode
  finished well before 90%. Only for items Plex has marked.
- **Watched as the instant.** A play is dated by its Stop
  ([tautulli.ts:216](../../apps/api/src/ingest/tautulli.ts#L216)), so pausing
  on the credits and stopping the next morning dates the episode to the
  morning. Tautulli's Watched fires as the threshold is crossed.
- **Recently Added for `library_presence`.** On disk within seconds rather
  than at the nightly walk.

Keeping the latest live event somewhere a restart cannot reach would close
the one gap the model leaves, and would reverse "nothing is stored".
