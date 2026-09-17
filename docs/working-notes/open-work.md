# Open work

**Status:** Index — what to do next. Read first.

## Now

**Manual write path.** A core write path rather than a convenience: the record
is what the project keeps, and Plex reaches back only to 2025-10-24. Finding a
title and storing one are done; what remains is `POST /watch-events` — bulk
season marking over the derived `manual:{titleKey}:S2E5` id in
[data-model.md](data-model.md).

Its pure half has landed: `parseWatchedAt` and `manualEventId` in
`@engram/shared`, and `planWatchEvents` in `apps/api/src/watch/plan.ts`, which
expands a scope (whole title, one season, one episode) into the per-episode
events `watch_state` needs. What remains is the route that reads the title and
its grid and writes them.

## Next

1. **Owner-only authentication.** GitHub OAuth, porting the hand-rolled flow
   already running in `vyoh.gg` rather than inventing a second one. Settled
   2026-09-17; the design, the build order and what it is waiting on are in
   [authentication.md](authentication.md). Start there rather than here.

   Nothing authenticates a request today, so this gates the netcup deploy
   rather than local work — the API binds loopback. Three of its five steps
   need no GitHub credentials and are not blocked on the owner.
2. **`apps/web`** — Vite + React SPA, shaped by the settled design: a poster
   wall filtered by state, a title page built around the episode grid, and
   adding a title by hand as a screen of its own.
3. **Owner-only ingest** — an allowlist of Plex account ids in config, enforced
   at the ingest boundary, dropping a play by anyone else rather than storing
   it. Reasoning in [ingest-architecture.md](ingest-architecture.md). Must land
   before webhooks do: the backfill is owner-only by property of the Plex
   endpoint, and Tautulli fires for every user on the server.
4. **Webhook receivers** — Tautulli and Sonarr, per
   [ingest-architecture.md](ingest-architecture.md). Deferred deliberately:
   Tautulli is not installed, and receiving live webhooks in development needs
   either a tunnel or a netcup deploy. Routes must check `WEBHOOK_SECRET`.

## Blocked

- **Tautulli is not installed.** Bytesized was having problems as of 2026-09-16.
  Live webhook ingest cannot be verified until it is up. Everything through
  chunk 4's importer is unaffected, since the Plex dump is already captured.
- **Tautulli webhook payload shape is unverified.** Which external-id parameters
  actually populate per media type needs one empirical check against a throwaway
  endpoint before any parsing code is trusted.
- **Nothing authenticates a write.** `POST /titles` is reachable by anyone who
  can reach the port. The API binds loopback, so this blocks the netcup deploy
  rather than local work. See [authentication.md](authentication.md).

## Decisions still open

- **Whether legacy-agent libraries exist here.** If they do, the season and
  episode in a legacy GUID are the only carrier of that information and
  `parseGuid` currently discards it. See
  [ingest-architecture.md](ingest-architecture.md).

## Done

- **2026-09-17** — `POST /titles` landed: a title the disk has never held can be
  stored, with its whole episode grid. One TMDB call carries the details and,
  via `append_to_response`, the tvdb id a show is keyed on; a show TMDB cannot
  give one for is refused with 422 rather than keyed on something else, since a
  second identity for one title is worse than no row. Episodes are created
  eagerly, one call per season, so a gap is a fact rather than an inference.

  Re-posting a title refreshes what TMDB says about it and answers 200 instead
  of 201, which makes the add screen safe to retry. Metadata is refreshed but
  identity is not: an id already on the row survives a TMDB response that omits
  it, because the Plex resolution pass found ids TMDB alone does not always
  return. Whether the row is new comes from `xmax` in the same statement rather
  than a prior select, so two concurrent posts cannot both claim to have created
  it, and the title and its episodes are written in one transaction.

  `tmdbId` is validated as digits before it reaches a URL: `..` in that position
  resolves against the base and would aim the owner's API key at an endpoint of
  the caller's choosing. Uncaught errors no longer answer with their own text
  either, which was echoing constraint names to the client.

  Verified end to end against the live database: search, create, re-create, five
  episode rows with names, air dates and runtimes, an upsert with every incoming
  id null leaving all three intact, the traversal refused, then the rows removed
  and the database back to 11 titles and 79 episodes.

- **2026-09-17** — `DATABASE_URL` and Compose agree again; the port mismatch
  that made every migration need an override is gone.

- **2026-09-17** — Titles can be marked as not the owner's: `intent.excluded_at`
  is a nullable timestamp, and a non-null value hides the title from the default
  view. A shared Sonarr and Radarr put things on disk nobody here will watch,
  and `want = false` could not say so — it is every row's default and already
  means "no opinion". Verified against the live database: column present and
  nullable, a round trip carrying a reason in `note`, and `excluded_at is null`
  partitioning cleanly. Reasoning in [data-model.md](data-model.md).

- **2026-09-17** — Title search landed: `GET /search?q=` over TMDB's
  `/search/multi`, returning kind, tmdb id, name, year, poster path and
  overview. Verified against live TMDB — 20 results for "the witcher", both
  kinds, posters and years intact. The key is a v3 one and authenticates by
  query parameter; the same key as a bearer token returns 401, so nothing about
  a request may reach a log line, and the client's error type carries the
  upstream status and nothing else. `/search/multi` also returns people, which
  are dropped. The route answers 503 rather than going unregistered when no key
  is configured, so a missing capability does not look like a wrong path.

  Routes now assemble through `buildApp()` in `apps/api/src/app.ts` and
  `server.ts` is the entry that owns the process. That is what makes a route
  testable: the first HTTP tests in the repo drive `app.inject()` against a
  stub, with no port, network or database.

- **2026-09-17** — UI direction settled. A poster wall filtered by state is the
  home, a title page built around an episode grid is where the work happens, and
  adding a title by hand is a screen of its own rather than a setting. Espresso
  ground so artwork is the only saturated thing on screen; jade for the
  affirmative, kept clear of the gold that means "in progress"; Archivo names
  things and Martian Mono sets every figure. Long names wrap to two lines and
  drop a subtitle past a colon, which is a layout answer to truncation rather
  than a typographic one.

  Two findings drove it. The owner's own record contains the argument: ONE PIECE
  S2E5 sits between a rewatch of E4 and a play of E6, so the UI has to let you
  say whether a hole was skipped or never downloaded. And TMDB returns
  `poster_path` inline with a search result while its image CDN needs no key
  — verified 2026-09-17, an unauthenticated poster returns 200 and a bad path
  returns 404 rather than 403 — so added titles carry artwork immediately and a
  generated cover is only the fallback.

- **2026-09-17** — Date precision landed, so the record can hold something
  watched years ago. `watched_at` is nullable and `watched_precision` carries
  `exact | day | month | year | unknown`, tied together by a check constraint in
  both directions; `watch_state` reports a precision per boundary rather than
  one for the row, since a group can hold a remembered year and an exact play at
  once. Verified against the live database: all 86 existing plays backfilled to
  `exact` with timestamps intact, the column default dropped so a later insert
  must state its own precision, a dateless row accepted and surfacing with null
  boundaries and a real `play_count`, both invalid combinations rejected, and a
  2019 entry beside an exact play reporting `year` on first and `exact` on last.
  Reasoning in [data-model.md](data-model.md).

- **2026-09-16** — Plex dump importer landed. All 86 plays imported from the
  archive with nothing dropped or degraded: 11 titles, 79 episodes, 6 rewatches
  detected. Re-running inserts 0 new events, so the idempotency the reconcile
  design depends on is proven rather than assumed. Plex history carries no
  progress fields at all — a row exists only because Plex already decided the
  item was watched — so these events are stored `completed` with a null
  percentage, and `completed` stays computed at ingest so Tautulli's real
  percentages can use the same threshold later.

- **2026-09-16** — `apps/api` landed: Drizzle schema for the five tables,
  Postgres 18 in Compose, migrations, config validation, health and readiness
  endpoints, and `ops/backup.sh`. Verified against a live database: the
  migration applies, `watch_state` derives correctly, re-ingesting the same
  source event is a no-op, and a duplicate canonical key is rejected.
  `watch_state` is a view rather than a table, so it cannot drift from the
  events it summarises and there is no rebuild step to forget.

- **2026-09-16** — `packages/shared` landed: canonical identity model
  (`titleKey`, `episodeKey`, `sameTitle`, `mergeIds`) and the Plex GUID
  normalizer, 19 tests. Shows key on tvdb and movies on tmdb to match what
  Sonarr and Radarr use natively, so their webhook payloads need no translation.
  `titleKey` returns null rather than inventing a key for a title with no
  external id: such a title cannot survive a redownload and must go to manual
  resolution. The normalizer moved out of `tools/`, which now imports it, so
  there is one implementation rather than two drifting copies.
- **2026-09-16** — Plex history archived before any further decay: 86 plays, 11
  titles, 2025-10-24 → 2026-09-13. Resolution pass returned 11/11 titles with
  full TMDB/TVDB/IMDb coverage. Findings in [plex-api-findings.md](plex-api-findings.md).
- **2026-09-16** — Named the project, chose separate API + React SPA over a
  single Next.js app, on the grounds that the background work (webhook receiver,
  nightly reconcile, enrichment queue, Plex write-back) is real backend work.
