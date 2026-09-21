# Integration ideas

**Status:** Idea pool — browse before scoping. Nothing here is committed to.

Engram is the only component in the stack with a memory. Sonarr knows what is on
disk, Plex knows what is playing now, Tautulli knows what happened recently.
None of them know what was watched two years ago through a delete-and-redownload
cycle. Every idea below is a case of lending that memory to something that lacks
it.

Explicitly **not** a goal: replacing Plex, Sonarr or Radarr.

## Highest value

- **Watched-state restoration.** Sonarr fires `SeriesAdd`; Engram has history for
  that tvdbId; re-scrobble the previously-watched episodes into Plex once files
  land. Re-download a half-watched show and Plex knows where you were. This is
  the founding use case and nothing in the stack does it today.
- **Abandoned-series nudges.** "Untouched since 2025-12-02, two episodes in —
  dropped or paused?" One tap writes an `intent` row. Highest daily value per
  line of code, and the most direct answer to the original problem: not
  remembering what was watched.
- **Unmonitor what is finished.** `PUT /api/v3/episode/monitor` so quality
  upgrades stop re-downloading watched episodes. Real savings on a capped
  seedbox, and it proves the write path into Sonarr before the full request
  feature is attempted.

## Uses the combination no single tool has

- **Next-up across deletions.** Plex's Continue Watching dies when media is
  removed. Engram's survives: on S02E06, TVDB says it exists, Sonarr says it is
  not on disk, one button to request it. Needs history + presence + intent
  together.
- **Gap detection.** Watched E01–E08 and E10. Skipped, or never downloaded?
  Cross-referencing history against Sonarr's episode file list answers it
  unambiguously.
- **Safe to delete.** Fully-watched series still on disk, with sizes from Sonarr.
  The inverse matters more: a delete-guard flagging anything mid-watch. Sonarr
  supports tags, so Engram can write `engram:finished` and let existing cleanup
  tooling act on it.
- **Return alerts that account for the viewer.** Sonarr knows a new season is
  coming; it does not know whether the last one was finished. "S03 airs in two
  weeks, you finished S02 in August" via ntfy or Discord.

## Unglamorous but worth doing early

- **Trakt-format export.** A few hours of work, and it means never being locked
  into Engram. Building this to own the data means being able to walk away from
  it too.
- **Manual entry.** Shipped 2026-09-19 as the add screen, and it earned itself
  on shows rather than on films: 655 episodes claimed by hand against media
  Plex had never heard of. The original reasoning here was that one movie in 86
  plays meant films get watched off-Plex — cinema, someone else's couch, a
  plane. Wrong, checked 2026-09-21: the viewer watches everything on Plex, and
  the 27 unwatched films on disk are a backlog, not a hole in the record. The
  feature was right; the argument for it was not. Films need a queue, not a
  reconstruction.

## Postponed deliberately

- **Request a series from Engram → Sonarr adds it.** `POST /api/v3/series` with a
  tvdbId, quality profile and root folder. Less advanced than it sounds
  (Overseerr is essentially this plus a UI), but deferred until the core lands.
  The schema already accommodates it: it writes an `intent` row and makes one
  call, with no table changes. See [data-model.md](data-model.md).

## Suggested order after the core

1. Watched-state restoration
2. Abandoned-series nudges
3. Unmonitor finished
