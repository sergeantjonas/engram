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
- **Episode alerts for followed shows.** An alert reports only what happened
  without the owner: adding a series, searching by hand, an upgrade or a
  delete never pings. The test is a recently aired episode of a followed show
  — wanted or started, not dropped or excluded. Three alerts pass it:

  - **Ready** — the episode was imported. "S03E05 is on disk, you're one
    behind" says where the viewer stands, which Sonarr's own Discord
    connection cannot, and that connection pings for every series in it,
    dropped ones included.
  - **Stuck** — grabbed, and still not imported hours later. A grab alone
    does not ping: on the seedbox the import usually follows within minutes,
    and two pings for one episode is noise.
  - **Overdue** — aired, and nothing grabbed. Sonarr has no alert for this
    at all.

  Ready and stuck ride the Sonarr receiver open-work.md already owes: `Grab`
  and `Download` carry the `tvdbId` and the episodes, and `Download` feeds
  `library_presence` as well. `isUpgrade` never pings. Two things to measure
  on the live install: whether a season pack arrives as one event or one per
  file, and if per file the pings collapse per title over a short window; and
  whether a grab says it was automatic, without which a manual search for last
  night's episode still pings when it lands.

  Settled 2026-10-04: `SeriesAdd` creates the title the moment Sonarr has it,
  rather than at the next walk, and is never an alert. Sonarr is the owner's
  alone; it is Plex that is shared, and the titles the walk brings in for
  other viewers are excluded by hand.

  Stuck and overdue are scheduled checks rather than events. Stuck needs only
  what the receiver records, a grab with no import after it. Overdue needs two
  things Engram lacks. `episode.air_date` is a day with no time, and the
  network's local day at that, so the earliest safe "late" is the end of the
  day after it. And `library_presence` is per title, while "this episode has
  no file" is per episode; the check trusts only presence a reconcile backs,
  or a missed `Download` webhook reports as a late episode.

  The library walk can be that reconcile at no extra cost: it already fetches
  every episode of every watched show and keeps only the watched ones
  ([dump-library.mjs:118](../../tools/dump-library.mjs#L118)). Shows wanted but
  not started are not fetched; covering them is one Plex request each.
  Sonarr's API would give exact air times and the same reconcile, but its key
  has no read-only scope, so it stays on the slot beside Sonarr, and an hourly
  check — the only kind for which exact times matter — goes beyond the nightly
  container Bytesized authorized. Deferred until a day-late alert proves too
  coarse.

  Deciding whether to ping belongs here; delivering it does not. Only Engram
  knows what is followed, but the Discord webhook URL — a credential, whoever
  holds it can post — and never pinging twice for one thing are wanted by other
  projects too, a wishlist price drop on vyoh.gg being the first. The delivery
  side is `notify-hub.md` in commonplace, the cross-project notes repo.

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
