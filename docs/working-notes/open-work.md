# Open work

**Status:** Index — what to do next. Read first.

## Now

**Chunk 3 — `apps/api`.** Fastify skeleton, Drizzle schema per
[data-model.md](data-model.md), Postgres via compose, migrations, health check.
The Postgres-vs-SQLite decision below has to be settled first.

## Next

4. **Ingest** — Plex dump importer first (data is already on disk), then the
   Tautulli and Sonarr webhook receivers per [ingest-architecture.md](ingest-architecture.md).
5. **UI design brainstorm** — interactive, with mockups and previews. Owner
   asked for this before any frontend work starts, so chunk 5 is deliberately
   deferred until it happens. Read model and screen inventory are open
   questions until then.
6. **`apps/web`** — Vite + React SPA shell, shaped by whatever the brainstorm
   settles on.

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
