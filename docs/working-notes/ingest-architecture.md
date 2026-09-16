# Ingest architecture

**Status:** Design — agreed 2026-09-16. Read before chunk 4.

## Sources

| Source | Gives | Why it is the right one |
|---|---|---|
| Sonarr / Radarr webhooks | library add + delete | Payload already carries `tvdbId`, `tmdbId`, `imdbId`. No resolution pass needed. Fires `SeriesAdd` before anything downloads, and `SeriesDelete` / `EpisodeFileDelete` on removal. |
| Tautulli webhook | live playback stops | Body is author-defined, so the payload contains exactly the fields wanted. Does not need Plex Pass, unlike Plex's own webhooks. |
| Tautulli history pull | nightly reconcile | The authoritative record. Catches everything the webhook missed. |
| Plex history dump | one-time backfill | Already captured — see [plex-api-findings.md](plex-api-findings.md). |

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
