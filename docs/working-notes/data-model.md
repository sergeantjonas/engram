# Data model

**Status:** Design — agreed in principle 2026-09-16, no tables written yet. Read before chunk 3.

## Principles

**Identity is external.** Plex `ratingKey`s are ephemeral. Canonical identity is
a TMDB / TVDB / IMDb id plus, for episodes, season and episode number. Those
survive a delete-and-redownload cycle; nothing Plex-internal does.

**Events are append-only.** A `watch_event` is a fact that happened and is never
mutated. Whether something counts as "seen" is a projection derived from those
facts and rebuildable at any time.

**Raw payloads are kept.** Every ingested event stores the original payload
alongside the parsed columns. When the normalizer turns out to be wrong in six
months, the fix is a re-derivation rather than a data loss.

**`title` rows are permanent.** Media comes and goes underneath them. A title is
never deleted, because outliving the media is the entire point of the project.

## Tables

```
title             identity + cached TMDB metadata. Permanent.
                  (id, kind, tmdb_id, tvdb_id, imdb_id, name, year,
                   poster_path, overview, metadata_fetched_at)

episode           (id, title_id, season, number, name, air_date, runtime,
                   tmdb_episode_id)

library_presence  is it on disk right now?
                  (title_id, present, first_seen_at, removed_at, source)

intent            do I want to watch it?
                  (title_id, want, started_at, dropped_at, note)

watch_event       append-only facts
                  (id, source, source_event_id, title_id, episode_id,
                   started_at, stopped_at, duration_sec, view_offset_sec,
                   percent_complete, completed, user_id, player, platform, raw)
                  UNIQUE (source, source_event_id)

watch_state       derived projection, rebuildable
                  (title_id, episode_id, first_watched_at, last_watched_at,
                   play_count, seen)
```

## Why presence and intent are separate tables

The obvious shortcut is one `status` enum on `title`. It is wrong, because the
two axes are orthogonal: a show can be on disk and abandoned, or wanted and not
on disk. Collapsing them forces invalid states to be representable and valid
ones to be inexpressible.

Keeping them apart also means the future Sonarr-request feature is purely
additive — it writes an `intent` row and makes one API call, and no existing
table has to change. Same for Sonarr's add/delete webhooks, which only ever
touch `library_presence`.

`intent` is also what gives Engram the two things Plex genuinely cannot express:
"want to watch" and "dropped after S2".

## Idempotency

`UNIQUE (source, source_event_id)` is what makes re-ingest safe. Backfill and
nightly reconcile can run as often as they like and converge rather than
duplicate. This is what allows webhooks to be treated as an optimization rather
than a source of truth.

## Open questions

- Postgres vs SQLite. Postgres chosen for jsonb on `raw` and for concurrent
  access from the API and the worker, but deployment target is still unsettled
  and SQLite would make the whole app a single process plus a file. Drizzle
  keeps the query layer portable either way.
- Multi-user: the owner's history is single-account today (`accountID: 1`).
  `user_id` is carried on `watch_event` so Plex Home users can be split later
  without a migration, but no UI accounts for it yet.
- Whether `episode` rows are created eagerly for a whole season on first sight,
  or lazily per watched episode. Eager makes gap detection trivial and costs a
  TMDB call per season.
