# Ingest architecture

**Status:** Design — agreed 2026-09-16, extended 2026-09-21 with the library
walk and the claim-grain rule. Read before chunk 4.

## Sources

| Source | Gives | Why it is the right one |
|---|---|---|
| Sonarr / Radarr webhooks | library add + delete | Payload already carries `tvdbId`, `tmdbId`, `imdbId`. No resolution pass needed. Fires `SeriesAdd` before anything downloads, and `SeriesDelete` / `EpisodeFileDelete` on removal. |
| Tautulli webhook | live playback stops | Body is author-defined, so the payload contains exactly the fields wanted. Does not need Plex Pass, unlike Plex's own webhooks. |
| Tautulli history pull | nightly reconcile | The authoritative record. Catches everything the webhook missed. |
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

`watch_state` already collapses correctly on everything except one column. It
groups by `(title_id, episode_id)`, `min`/`max(watched_at)` ignore the undated
claims, and `array_agg(… ORDER BY watched_at)` sorts nulls last, so both
precisions already resolve to the dated claim on their own. But `play_count` is
`count(*)`, which counts claims. It is already wrong today: the eight Stranger
Things S5 episodes carrying a manual mark *and* a history row read as two plays
of a single viewing, while Bleach S17E47's genuine rewatch (2026-09-05 and
2026-09-12, two history rows) reads as two for the right reason. The library
walk turns every such collision into three.

So `play_count` counts play-grained rows only, floored at one so an episode
known solely from a manual mark still reads as watched once. `seen` stays
`bool_or(completed)` and needs no change.

Built 2026-09-21, ahead of the walk that exposes it, and with one addition the
plan above did not have: `watch_event.plays`. An episode-grained source counts
rather than enumerates, so its row carries its own total and the view takes
`greatest(play-grained rows, max(plays), 1)` — the larger wins because the two
describe the same viewing from different angles. Null everywhere else: a
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

**Open:** how Bytesized exposes Tautulli. Plex got a dedicated port, so Tautulli
likely will too, but their installer may instead put it behind a reverse proxy
with its own auth. That decides whether netcup can reach Tautulli's API for the
nightly reconcile. Unanswerable until Bytesized is back up.

## Webhooks are an optimization, not the source of truth

Plex does not reliably emit a clean playback-stop: app killed, network drop,
server restart. A push-only design loses episodes silently, which is the worst
possible failure for an app whose only job is remembering.

So: the webhook gives freshness, the nightly `get_history` pull gives
correctness. Idempotency on `(source, source_event_id)` makes re-running the
reconcile free, so there is no reason not to.

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

## Tautulli specifics

The webhook body is authored by hand in the notification agent, using Tautulli's
parameter substitution. Fields worth requesting: `{media_type}`, `{show_name}`,
`{episode_name}`, `{season_num}`, `{episode_num}`, `{year}`, `{themoviedb_id}`,
`{thetvdb_id}`, `{imdb_id}`, `{guid}`, `{rating_key}`,
`{grandparent_rating_key}`, `{duration_sec}`, `{view_offset}`,
`{progress_percent}`, `{user_id}`, `{player}`, `{platform}`, `{unixtime}`.

Per-media-type availability of the external-id parameters is **unverified** —
coverage differs between movies and episodes and depends on which agent scanned
the library. Point the webhook at a throwaway endpoint and watch one episode and
one movie before trusting any of them.

Use the **Playback Stop** trigger, not **Watched**. Watched fires mid-playback at
the threshold and loses the true final offset.

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
