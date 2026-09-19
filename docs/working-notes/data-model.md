# Data model

**Status:** Implemented 2026-09-16 in `apps/api/src/db/schema.ts`, extended 2026-09-17 with date precision and excluded titles. The imported grids were partial until the 2026-09-18 backfill; see that section for why the importer still writes them that way. Extended 2026-09-19 with `episode_gap`, the viewer's own account of a hole. This note carries the reasoning; the schema is the source of truth for shape.

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
The delete rules encode that: `watch_event` restricts, so a title with history
cannot be removed at all, while `episode`, `library_presence` and `intent`
cascade — and the episode cascade is itself blocked by the event restrict.

## Tables

```
title             identity + cached TMDB metadata. Permanent.
                  (id, key, kind, tmdb_id, tvdb_id, imdb_id, name, year,
                   poster_path, overview, metadata_fetched_at, created_at)
                  key is the canonical string from titleKey(), unique, so
                  identity is enforced by the database rather than by
                  whichever ingest path happens to run first

episode           (id, title_id, season, number, name, air_date, runtime,
                   tmdb_episode_id)

library_presence  is it on disk right now?
                  (title_id, present, first_seen_at, removed_at, source)

intent            do I want to watch it?
                  (title_id, want, started_at, dropped_at, excluded_at, note)
                  excluded_at non-null means "not mine, never was", which
                  want = false cannot say: false is every row's default

watch_event       append-only facts
                  (id, source, source_event_id, title_id, episode_id,
                   started_at, watched_at, watched_precision, duration_sec,
                   view_offset_sec, percent_complete, completed, account_id,
                   player, platform, raw, ingested_at)
                  UNIQUE (source, source_event_id)
                  (title_id, episode_id) is a composite foreign key, so an
                  event cannot name one title and an episode of another
                  CHECK ((watched_precision = 'unknown') = (watched_at IS NULL))

session           a signed-in browser, which is only ever the owner's
                  (id, token_hash, github_user_id, created_at, expires_at,
                   absolute_expires_at)
                  only the SHA-256 of the cookie's token is stored, so a leaked
                  backup yields nothing a caller can present
                  see authentication.md for the flow that writes these

episode_gap       the viewer's own account of a hole in a season
                  (episode_id, reason, note, recorded_at)
                  reason is skipped | missing: a decision versus an absence,
                  which look identical in the history
                  one row per episode, overwritten rather than appended — this
                  is a current answer, and no row means "no comment" rather
                  than "not skipped"

watch_state       SQL view over watch_event, not a table: it cannot drift
                  from its source and needs no rebuild step
                  (title_id, episode_id, first_watched_at, last_watched_at,
                   first_watched_precision, last_watched_precision,
                   play_count, seen)
                  first/last are null when every event behind the row is
                  undated, so ordering on them needs NULLS LAST
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

## Titles that are not yours

A shared Sonarr and Radarr put things on disk that the owner will never watch,
and a library view that cannot be told so is a library view that degrades as the
disk fills. That is an intent statement, so it belongs here rather than as a
flag on `title`: presence says what is on disk, intent says who cares.

`want = false` cannot carry it, because it is every row's starting value and
already means "no opinion recorded". So `excluded_at` is a nullable timestamp
beside the `started_at` and `dropped_at` already on the table, with the existing
`note` saying why; a non-null value hides the title from the default view. A
timestamp rather than a flag because when the decision was made is worth as much
here as it is for the other two, and because it keeps "dropped after S2" —
started, then abandoned — distinct from "never mine", which was never started.

Excluding something needs a `title` row to exist, since `intent` is keyed on it.
A series sitting in Sonarr that was never watched has none yet, so exclusion is
something done to a title Engram already knows about rather than a filter over
Sonarr's catalogue.

## Dates you do not have

The record is the point; when something happened is metadata about the record.
A series watched years before Plex existed here has no timestamp to offer, and
demanding one would mean either refusing the row or inventing a date — so
`watched_at` is nullable and `watched_precision` says how much of it to believe:
`exact | day | month | year | unknown`. A coarse entry stores the first instant
of the period it names, so 2019 is 2019-01-01 at precision `year`, and the UI
renders "2019" rather than a January that never happened.

Precision is read off the shape of what the viewer wrote — `2019` is a year,
`2019-06-14` a day, a full ISO instant is exact — rather than being a field of
its own. Two fields can disagree, and a request claiming `exact` for `2019`
would describe the first of January as a moment someone lived through; the
check constraint cannot see that.

A check constraint ties the two together in both directions: `unknown` if and
only if the date is null. That is the whole of what the database enforces — it
cannot also check that a `year` event sits on the first of January, because the
expression would not be immutable. Storing the first instant of the period is
the writer's job.

`watch_state` carries a precision per boundary, `first_watched_precision` and
`last_watched_precision`, rather than one for the row. A group holding a
remembered 2019 and an exact play from last week has a `first_watched_at` that
is only good to the year and a `last_watched_at` that is good to the second;
collapsing those into one column would describe the 2019 date as exact and
produce precisely the invented January this design exists to avoid. Aggregates
skip nulls, so one dated event among several still yields a real first and last.

## Idempotency

`UNIQUE (source, source_event_id)` is what makes re-ingest safe. Backfill and
nightly reconcile can run as often as they like and converge rather than
duplicate. This is what allows webhooks to be treated as an optimization rather
than a source of truth.

It also covers entry by hand, which is why the id for a manual row is derived
rather than random: `manual:{titleKey}:S2E5` means marking a season watched
twice is a no-op instead of a duplicate. A dateless manual entry is therefore
one "seen" fact per episode; a dated manual rewatch appends its date to the id.

## The imported grids were partial

The Plex importer creates an `episode` row only for an episode that was played,
which predates the 2026-09-17 decision to create them eagerly. It still behaves
that way — `plex-dump.ts` writes an episode only inside its `hasEpisode` branch
— so re-running the import reproduces the problem rather than repairing it, and
a backfill is the only remedy. Every title that came from the dump carries a
grid of exactly the episodes with history, and a gap is indistinguishable from a
season that ends early.

ONE PIECE is the proof and the reason it matters: its rows run
`S2E4, S2E6` with no S2E5 between them, so the title reads 15 of 15 and
complete. Bleach reads 8 of 8. Nothing downstream can tell a skipped episode
from one that was never on disk, which is the distinction the UI exists to
offer.

`POST /titles` already writes a full grid from TMDB, one call per season, and
`backfill:episodes` runs that same path over every stored show. It ran on
2026-09-18 and took the table from 79 rows to 829. Bleach went from 8 of 8 and
apparently complete to 8 of 424; ONE PIECE's season 2 gained the E5 row it never
had, so the hole between E4 and E6 is now a fact in the database rather than an
absence nothing can describe.

The script is insert-only and idempotent — `episode` is unique on (title,
season, number) — so it is safe to re-run after any future import. It has to be
re-run after one, because the importer is unchanged and will keep writing
partial grids.

Existing rows keep their id and gain their metadata. The conflict clause
updates name, air date, runtime and TMDB episode id but never `episode.id`, so
`watch_event`'s composite foreign key is untouched. That is not a refinement:
the rows the importer wrote are exactly the watched ones, and they arrived
without air dates, so insert-only would have left the grid able to date every
episode except the ones actually seen.

Specials come with it. TMDB files promotional clips under season 0 alongside
genuine OVAs and offers no way to tell them apart: of the 193 specials, 89
belong to House of the Dragon, 76 to The Boys and 24 to Fallout, which are
featurettes, while Bleach's 4 are real. They are stored because dropping season
0 would leave a watched OVA with no row to mark, and they are excluded from the
progress fraction, so the cost is a season the grid should collapse by default
rather than a wrong count.

## Why a hole needs the viewer to explain it

ONE PIECE S2E5 sits between a rewatch of E4 and a play of E6. Nothing in the
history says whether it was skipped on purpose or never downloaded, and the two
are the same shape: no `watch_event`.

`library_presence` looks like the answer and is not. It is keyed on `title_id`
as its primary key, so it is per title rather than per episode, and it holds no
rows at all — only a Sonarr or Radarr webhook would write it, and those are
deferred. Even fixed, it would answer "was it on disk", which is not the same
question: an episode can sit on disk for a year and be deliberately skipped.

So `episode_gap` records what the viewer says, settled 2026-09-19. It is
declared, not derived, which is the same principle as `intent` and the same
principle as the project: the record is what the owner asserts, not what the
disk currently happens to hold. A gap on a seen episode is stale rather than
wrong — the grid shows it as watched either way.

## Eight episodes TMDB has never heard of

`Bleach S17E41` through `S17E48` carry ten watch events between them and match
nothing TMDB returns for tmdb id 30984, which has no season 17 at all. They are
the only rows left with no name, no air date and no TMDB episode id, and no
amount of re-running the backfill will fix them: there is nothing upstream to
fetch.

The likely cause is that Plex numbered *Thousand-Year Blood War* as a
continuation of the original series while TMDB files it as its own title. If
that is right the repair is not metadata but identity — those events belong to a
different `title` — and it is a decision about what the record should say, not a
lookup. `backfill:episodes` reports the count on every run so they stay visible
rather than becoming eight quietly unlabelled cells in the grid.

## Open questions

- ~~Postgres vs SQLite~~ — settled 2026-09-16: Postgres, hosted on a netcup
  VPS rather than on Bytesized. Full root means Docker, real timers, and a
  lifecycle independent of the media stack.
- Multi-user: the owner's history is single-account today (`accountID: 1`).
  `account_id` is carried on `watch_event` so Plex Home users can be split
  later without a migration, but no UI accounts for it yet.
- ~~Eager vs lazy `episode` rows~~ — settled 2026-09-17: eager, a whole season
  at a time. Marking a season watched has to write one event per episode, so the
  rows have to exist anyway, and a season present in full is what makes a gap
  like ONE PIECE S2E5 a fact rather than an inference. The cost is one TMDB call
  per season.
