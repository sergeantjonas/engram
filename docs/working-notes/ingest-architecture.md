# Ingest architecture

**Status:** Design — agreed 2026-09-16, extended 2026-09-21 with the library
walk, the claim-grain rule, owner-only ingest and the measured Tautulli
payload. Owner-only ingest and the whole Tautulli path are built rather than
planned. Read before chunk 4.

## Sources

| Source | Gives | Why it is the right one |
|---|---|---|
| Sonarr / Radarr webhooks | library add + delete | Payload already carries `tvdbId`, `tmdbId`, `imdbId`. No resolution pass needed. Fires `SeriesAdd` before anything downloads, and `SeriesDelete` / `EpisodeFileDelete` on removal. |
| Tautulli webhook | live playback stops | Body is author-defined, so the payload contains exactly the fields wanted. Does not need Plex Pass, unlike Plex's own webhooks. |
| ~~Tautulli history pull~~ | ~~nightly reconcile~~ | Dropped 2026-09-21. The library walk took this job and does it better — see below. |
| Plex history dump | one-time backfill | Already captured — see [plex-api-findings.md](plex-api-findings.md). |
| Plex library walk | one-time backfill, then reconcile | The deeper record. Reaches 2019 where the history log stops at Oct 2025, and carries external ids inline. Added 2026-09-21. |
| The viewer, by hand | claims about media that was never here | The only source for a show watched before this server existed, or never on it at all. Undated by nature. |

## Claim grain and precedence

Six sources now describe the same viewing, so the question stops being "which
source is right" and becomes "what does a row mean". A `watch_event` is not a
play. It is **one source's claim about one episode**, and sources differ in how
finely they can make one:

| Grain | Sources | A row means |
|---|---|---|
| Play-grained | Plex history, Tautulli | This episode was played, at this instant. Two rows are two viewings. |
| Episode-grained | Plex library walk | This episode has been watched, most recently then. One row per episode however often it was played. |
| Claim-grained | The viewer, by hand | This episode has been watched. No date, and possibly no file. |

Nothing is deduplicated at ingest and nothing supersedes anything. Every source
keeps writing its own claims under its own `(source, source_event_id)`, the
append-only rule holds, and reconciliation happens in the projection — which is
the whole reason `watch_state` is a view. A manual mark from before the walk
and a dated claim from the walk are both true: the viewer really did assert it,
and Plex really does know when.

`watch_state` already collapses correctly on everything except its count and
its dates. It
groups by `(title_id, episode_id)`, `min`/`max(watched_at)` ignore the undated
claims, and `array_agg(… ORDER BY watched_at)` sorts nulls last, so both
precisions already resolve to the dated claim on their own. But `play_count` is
`count(*)`, which counts claims. It is already wrong today: the eight Stranger
Things S5 episodes carrying a manual mark *and* a history row read as two plays
of a single viewing, while Bleach S17E47's genuine rewatch (2026-09-05 and
2026-09-12, two history rows) reads as two for the right reason. The library
walk turns every such collision into three.

So `play_count` counts completed play-grained rows only, floored at one once something finished so an episode
known solely from a manual mark still reads as watched once. `seen` stays
`bool_or(completed)` and needs no change.

Built 2026-09-21, ahead of the walk that exposes it, and with one addition the
plan above did not have: `watch_event.plays`. An episode-grained source counts
rather than enumerates, so its row carries its own total and the view takes
`greatest(completed play-grained rows, max(plays), one if anything completed)`
— the larger wins because the two describe the same viewing from different
angles. Null everywhere else: a
play-grained row is one play by definition and a mark by hand asserts only that
something was seen.

Measured against the live record on the day: Stranger Things dropped from 50
claims to 42 viewings, because its eight S5 episodes each carried a manual mark
*and* a history row; Bleach S17E45 and S17E47, two genuine rewatches with two
history rows apiece, still read as two.

**Two sources feed `library_presence`, and neither is a watch.** Sonarr and
Radarr know what is on disk; the Plex library walk knows what Plex can see.
Neither knows what was viewed, and nothing about presence may ever be inferred
from a watch or the reverse — Bleach is the standing proof, with 416 episodes
claimed by hand against 8 on disk. Radarr belongs in the table above alongside
Sonarr for the same reason it always did.

The walk was the first thing to write that table at all, on 2026-09-21: 81
rows where there had been none, so `onDisk` stopped being null everywhere and
the *Not on disk* facet stopped matching nothing. It also does the half a
webhook structurally cannot. A webhook reports events, so silence is
ambiguous; a walk sees the whole library at once, so a title that was present
and is not in this walk has gone, and gets `present = false` with a
`removed_at`. That sweep is scoped to rows whose `source` is the walk's own,
because Plex not seeing a file says nothing about what Sonarr knows.

## Host topology

The media stack (Plex, Sonarr, Radarr, Tautulli) runs on a Bytesized slot.
Engram runs on a separate netcup VPS, deliberately: an app built to outlive
deleted media should not share a lifecycle with the host doing the deleting.

Measured 2026-09-16, from outside the Bytesized box:

- Direct inbound to the slot works. Plex answers on port 6066 (not 32400) at
  both the shared host IP and `enyo.bysh.me`, ~110ms. Bytesized does not filter
  inbound on the ports it assigns.
- Plex's own relay times out, so it is a fallback that would not save us if
  direct access were ever blocked.
- The slot also exposes a plaintext `http://` route on the same port, which is
  why connection ranking scores plaintext last — the Plex token is account-wide
  and must never travel in the clear.

Outbound from Bytesized is not directly testable without running something on
the box, but Sonarr's indexer traffic and Plex's own plex.tv registration prove
outbound HTTPS is open. Engram should still listen on 443 behind a TLS proxy
rather than a custom port, so no egress filter can matter.

**Answered 2026-09-21: Tautulli got a dedicated port.** It answers on
`http://enyo.bysh.me:8181` and at the shared host IP, not behind a reverse
proxy with its own auth, so netcup can reach its API for the nightly
reconcile. The guess above was right.

One setting came with that answer: `/api/v2` replies `API not enabled`. That
blocks a pull and `get_activity`, and nothing else — a webhook is Tautulli
posting outward and needs no API of its own.

`/` redirects to `/welcome` on this install even though it is set up, which
is worth writing down only because it was briefly read as evidence that it
was not. `/home` serves the dashboard; the redirect says nothing about
configuration.

The third is a decision rather than a step: **port 8181 is plaintext, with no
TLS listener on it.** The Plex token is already kept off the wire for this
reason, and a Tautulli API key is the same kind of secret — it reads the
entire watch history of everyone on the server. Sending it from netcup to
Bytesized in the clear crosses the public internet. Either the reconcile
reaches Tautulli over something encrypted, or it does not use an API key at
all and lives on the webhook plus the Plex library walk, which is already
built and already the deeper record.

## Webhooks are an optimization, not the source of truth

Plex does not reliably emit a clean playback-stop: app killed, network drop,
server restart. A push-only design loses episodes silently, which is the worst
possible failure for an app whose only job is remembering.

So: the webhook gives freshness and the nightly reconcile gives correctness.
Idempotency on `(source, source_event_id)` makes re-running the reconcile
free, so there is no reason not to.

**What the reconcile is changed on 2026-09-21.** It was Tautulli's
`get_history`; it is the Plex library walk. The walk reaches 2019 where
Tautulli can only know what it has watched since it was installed, it carries
external ids inline, and it was already built. Keeping a second pull beside it
would mean issuing a Tautulli API key — a secret that reads the whole
server's viewing — and sending it over a port with no TLS on it. The job was
already done by something that needs no key at all.

**Tautulli keeps the webhook, and earns it.** Four things the walk cannot
give, none of which are about being authoritative:

- **Latency.** The walk is a nightly poll. A webhook is seconds, which is the
  difference between a record and a log you check on.
- **Grain.** The walk writes one row per episode carrying a `viewCount` and
  the most recent date, so every rewatch but the last is a number rather than
  a moment. Tautulli reports each play with its own instant.
- **Progress.** `view_offset` and percent complete, which is what
  `watch_event.completed` is supposed to be decided from. The walk sees only
  Plex's binary watched flag.
- **Who and where.** `{user_id}` is what the owner allowlist filters on for a
  source that is not owner-scoped by construction, and `player` / `platform`
  are columns this is the first source to fill.

It also needs no key from us: Tautulli posts to Engram and `WEBHOOK_SECRET`
authenticates it, so nothing of ours travels over 8181 at all.

**"Now watching" needs neither.** Plex answers `/status/sessions` directly
with the account token Engram already holds — current sessions with user,
player, platform and view offset. Verified 2026-09-21. Reaching for Tautulli
to display live playback would add a dependency for something the server
already says.

## Whose history this is

The Plex server is shared with other people. Engram is a record of one person's
viewing, and a housemate's plays landing in it would be wrong twice over: the
statistics stop describing anyone, and the app starts keeping a log of what
somebody else watched without being asked.

The backfill is safe by accident of the endpoint — Plex's history is scoped to
the calling token's account, verified 2026-09-17 in
[plex-api-findings.md](plex-api-findings.md). Nothing else is. Tautulli fires a
webhook for every play on the server and identifies the viewer with `{user_id}`;
Sonarr and Radarr are not per-user at all, though they only ever write
`library_presence`.

So the ingest boundary filters on an allowlist of account ids from config,
defaulting to the owner's, and a play by anyone else is **dropped rather than
stored**. Storing it and filtering on read would leave the record on disk, which
is the part that needed consent. `watch_event.account_id` already exists to keep
the owner's own Plex Home profiles separable later.

Built 2026-09-21 as `PLEX_ACCOUNT_IDS`, enforced in `planImport` before a row
is parsed rather than before it is written — the cheapest way not to keep a
log of someone else's viewing is never to build the row. Three properties are
worth stating because each was a decision:

- **A row with no account is not the owner's.** It cannot be shown to belong
  to the one person this record is about, so it is not kept. `accountID: 0` is
  a real id and is distinguished from absent. The library walk is the one
  exemption and needs no gate: it reads the calling token's own view of the
  library, so every row it writes is the owner's by construction, and it
  stores a null account because there is no per-item account to record rather
  than because one was missing.
- **A foreign play is counted, not dropped.** The importer treats a dropped
  row as a failure and exits non-zero; a housemate watching something is not a
  defect in the dump, and every import of a shared server's history would
  otherwise report one.
- **The default is the owner, never everyone.** Unset means `1`, which is the
  server owner on every Plex install, and an allowlist that parses to nobody
  is refused as the typo it is.

It changes nothing about what is stored today: all 86 history rows are
account 1, verified again on the day. It is there for Tautulli, which fires
for every viewer on the server.

## Tautulli specifics

**The shared secret travels as a `token` key in the payload.** Not because
the agent cannot send a header — it can, there is a JSON Headers field
beside the JSON Data one — but because a body is the better place for it.
The query string, the third option, is the worst: nginx writes it to its
access log in full and Fastify repeats it in its own request log, leaving
the secret at rest in two files. A header and a body are both absent from
those logs, and the body keeps the whole configuration in one field.

The receiver strips `token` before it logs the payload, which is the part
that would otherwise undo the choice, and it accepts a header too — Sonarr
and Radarr are next through here and may prefer one.

Recorded because it was first written down wrong: the note claimed the agent
had no header field at all, inferred from a report that none was visible
under the trigger rather than from looking at the agent's own settings.
Where a thing is in a UI and whether it exists are different questions.

The webhook body is authored by hand in the notification agent, using Tautulli's
parameter substitution. Fields worth requesting: `{media_type}`, `{show_name}`,
`{episode_name}`, `{season_num}`, `{episode_num}`, `{year}`, `{themoviedb_id}`,
`{thetvdb_id}`, `{imdb_id}`, `{guid}`, `{rating_key}`,
`{grandparent_rating_key}`, `{duration_sec}`, `{view_offset}`,
`{progress_percent}`, `{user_id}`, `{player}`, `{platform}`, `{unixtime}`.

**Measured 2026-09-21** against the live install, one real episode and one
real film, and the answer is the good one: **every external id populates for
both kinds.** Nothing needs a resolution pass.

| | film | episode |
|---|---|---|
| `themoviedb_id` | 1311031 | 205715 |
| `thetvdb_id` | 357931 | 417909 |
| `imdb_id` | tt32820897 | tt13159924 |
| `empty` | `show_name`, `grandparent_rating_key` | *nothing* |

For an episode the ids are the **show's**, not the episode's, which is
exactly what `titleKey()` takes. Both matched what the library walk had
already stored, so the webhook and the walk agree on identity.

Four things the documented parameter list does not tell you, each of which a
parser written from it would have got wrong:

- **`season_num` and `episode_num` are `"0"` on a film, not empty.** A
  parser testing for presence mints a phantom S0E0 for every movie. Gate on
  `media_type`, never on whether a field arrived.
- **`episode_name` on a film is the film's title.** Only `show_name` is
  empty, so "has an episode name" does not mean "is an episode".
- **The units differ inside one payload.** `view_offset` is milliseconds,
  `duration_sec` is seconds — 502000 against 9301 for a film stopped 8:22
  into 2:35:01, which `progress_percent: 5` confirms. Dividing one by the
  other without converting is out by a thousand.
- **Everything is a string.** Tautulli substitutes into a JSON template, so
  `"season_num": "1"`, never `1`.

**And the one that would have failed silently: `{user_id}` is not the
account id the history endpoint uses.** Tautulli reported `7597797` for the
owner; the server's own `/accounts` calls the owner `1` and gives its two
shared users `49291007` and `181142893`. `PLEX_ACCOUNT_IDS=1` is right for
the backfill and would reject every webhook event.

Settled 2026-09-21 with a second list rather than a shared one:
`TAUTULLI_USER_IDS`, holding Tautulli's ids and named for it. One list
carrying both namespaces would work, and then fail the first time somebody
put a Plex account id in it to exclude a housemate and nothing happened.
Empty allows nobody — a write path cannot be opened by omission — and the
check runs before the payload is logged, because a log line is a record of
what somebody watched just as much as a row is.

Use the **Playback Stop** trigger, not **Watched**. Watched fires mid-playback at
the threshold and loses the true final offset.

**A stop is stored whether or not it finished.** Playback Stop fires on every
stop, including the 18 second sample that happened to be the first real
payload this received. Those are kept rather than dropped: a partial play is a
fact like any other, `view_offset_sec` and `percent_complete` are columns the
nightly walk can never fill, and `watch_state.seen` is `bool_or(completed)`, so
nothing partial reads as watched.

Everything else in `watch_state` takes the same filter, and each for a reason
found by asking what the column would say otherwise. `play_count` counts rows
for this source, so one episode watched across three sittings would have read
as three plays. `first_watched_at` and `last_watched_at` would have moved to
the day of a two-minute sample, which is worse than it sounds: the wall's
ordering, the title header and the next-up band all read them, so a title
glanced at would sort and date as watched today while the episode under it
still read unseen. A null
boundary pairs with `unknown` precision, the same rule
`watch_event_precision_date` holds the events themselves to.

`completed` is decided at **90%**, which is Plex's own default rather than a
figure of our own. The walk reports Plex's binary watched flag, so any other
threshold would have the two sources disagree about the same play by
construction, and the disagreement would read as a bug in whichever was
consulted second. The percentage is measured from `view_offset` over
`duration_sec` rather than taken from `{progress_percent}`, which Tautulli
rounds to whole percent: the 18 second stop reports `0`, and a stored
percentage claiming a play never started is the one value that column must not
hold.

On backfill via `cmd=get_history`: rows do *not* reliably carry external ids, so
the same resolve-via-metadata pass as the Plex dump applies. `reference_id`
groups rows belonging to one continuous watch (paused Tuesday, finished
Thursday) and is the natural dedupe key rather than `id`. `grouping=1` makes
Tautulli collapse them server-side.

## Legacy GUIDs carry the episode number

A legacy agent guid is `com.plexapp.agents.thetvdb://81189/1/1?lang=en`, where
the trailing `/1/1` is season and episode. `parseGuid` deliberately drops it,
because for modern libraries the episode number arrives as a separate field.

For a library scanned by an old agent, that suffix may be the only carrier of
season and episode. Decide before ingest whether such libraries exist here; if
they do, the parser needs an accessor for it rather than discarding it.

## Completion

Compute it from `percent_complete` rather than trusting any source's
`watched_status`, so the threshold is consistent across sources. Store both the
raw percentage and the derived boolean: queries stay simple and the threshold
stays re-derivable.

Plex uses 90%, Tautulli defaults lower. Credits mean a 42-minute episode is
often "finished" well before 90%.

## Enrichment

TMDB, free API key, cached locally. Rate-limited queue rather than inline calls.
Cache the title-to-id mapping keyed by show, so the lookup is paid once per
series rather than once per episode.

## Normalizer fallback order

1. External id present in the payload → direct hit
2. Parse `guid`, handling both modern and legacy agent shapes
3. TMDB search on title + year
4. Ambiguous → `needs_review` queue, resolved in the UI

Step 4 is the one that usually gets skipped. Matching does not need to be
perfect; it needs to be correctable.
