# Open work

**Status:** Index — what to do next. Read first.

## Now

**Chunk 2 — `packages/shared`.** Canonical id model + GUID normalizer, pure and
fixture-driven. The real dump in `tools/out/` is the fixture source, and
`tools/plex-client.mjs` already holds a working `parseGuids` with tests to move
across. No infrastructure needed to test any of it.

## Next

3. **`apps/api`** — Fastify skeleton, Drizzle schema per [data-model.md](data-model.md),
   Postgres via compose, migrations, health check.
4. **Ingest** — Plex dump importer first (data is already on disk), then the
   Tautulli and Sonarr webhook receivers per [ingest-architecture.md](ingest-architecture.md).
5. **`apps/web`** — Vite + React SPA shell.

## Blocked

- **Tautulli is not installed.** Bytesized was having problems as of 2026-09-16.
  Live webhook ingest cannot be verified until it is up. Everything through
  chunk 4's importer is unaffected, since the Plex dump is already captured.
- **Tautulli webhook payload shape is unverified.** Which external-id parameters
  actually populate per media type needs one empirical check against a throwaway
  endpoint before any parsing code is trusted.

## Decisions still open

- **Postgres vs SQLite.** Postgres assumed for jsonb and concurrency; SQLite
  would make the whole app one process plus a file. Turns on the deployment
  target.
- **Deployment target.** Whether Bytesized allows Docker or arbitrary
  long-running processes is unknown. If not, the app runs elsewhere and pulls
  Tautulli over HTTPS — it only needs read access, so co-location is optional.
- **Eager vs lazy `episode` row creation.** Eager makes gap detection trivial at
  the cost of a TMDB call per season.

## Done

- **2026-09-16** — Chunk 1 landed: workspace skeleton, working notes, and the
  `tools/` archiver. Reviewer found three blocking bugs in the archiver, all
  reproduced by probe: a clamped page size was read as end-of-history (100 of
  1200 rows captured, reported as success), a server ignoring the paging offset
  looped forever, and `?? servers[0]` could resolve ratingKeys against the wrong
  server. Pagination moved into `plex-client.mjs` behind an injectable `get` so
  all three are covered by regression tests.

- **2026-09-16** — Plex history archived before any further decay: 86 plays, 11
  titles, 2025-10-24 → 2026-09-13. Resolution pass returned 11/11 titles with
  full TMDB/TVDB/IMDb coverage. Findings in [plex-api-findings.md](plex-api-findings.md).
- **2026-09-16** — Named the project, chose separate API + React SPA over a
  single Next.js app, on the grounds that the background work (webhook receiver,
  nightly reconcile, enrichment queue, Plex write-back) is real backend work.
