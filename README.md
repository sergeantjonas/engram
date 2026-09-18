# Engram

A personal, self-hosted record of everything watched on Plex.

Plex tracks watch state against library items. Delete the media and that history
degrades with it, so the answer to "have I already seen this?" quietly rots as
the disk gets cleaned up. Engram keeps its own durable record, keyed to external
IDs rather than Plex's internal ones, so the history survives the media.

## Design

**Identity is external.** Plex `ratingKey`s are ephemeral: delete a series and
re-add it and every key changes. Engram stores TMDB / TVDB / IMDb IDs plus
season and episode number, which survive a re-download.

**Events are append-only.** A `watch_event` is a fact that happened. Whether
something counts as "seen" is a projection derived from those events and can be
rebuilt at any time. Raw ingest payloads are kept alongside the parsed rows, so
a normalizer bug is recoverable rather than lossy.

**Webhooks are an optimization, not the source of truth.** Plex does not always
emit a clean playback-stop (app killed, network drop, server restart), so a
push-only design silently loses episodes. Tautulli's webhook gives freshness; a
nightly pull of its history gives correctness. Ingest is idempotent on
`(source, source_event_id)`, so reconciliation is free to re-run.

**Metadata is cached locally.** Posters, titles, runtimes and air dates come
from TMDB and are stored here. The moment the UI has to ask Plex for a poster,
the dependency this project exists to remove is back.

## Architecture

```
Tautulli webhook  ─┐
Tautulli history  ─┼─→ normalize → watch_event (append-only) ─→ watch_state
Plex history dump ─┘        ↑                                      ↓
                          TMDB ──────────────────────────────→ read model
```

- `apps/api` — Fastify. Webhook receiver, reconcile job, TMDB enrichment,
  Plex write-back.
- `apps/web` — React SPA.
- `packages/shared` — types and the GUID normalizer, shared by both.
- `tools/` — one-shot scripts. Currently the Plex history archiver.

## Status

Early. The history archiver works, and the API has identity, ingest, a manual
write path and owner-only authentication. The web app is not built yet.

## Getting started

```bash
cp .env.example .env     # add your Plex token
pnpm dump:history        # archive Plex's own history before it degrades
```

The history dump is time-sensitive and standalone: it needs nothing else in
this repo, and it captures data that is actively decaying.

### Running it

```bash
docker compose up -d                          # Postgres on 55432, loopback only
pnpm --filter @engram/api run db:migrate      # create or update the schema
pnpm dev                                      # every app in apps/, watched
```

`pnpm dev` builds once, then runs each app's own `dev` script in parallel. The
API lands on `http://127.0.0.1:2012` and rebuilds on save. It is deliberately
not on 3000: the port is registered as the GitHub OAuth app's callback host, so
a collision would mean editing that registration rather than a flag.

Every route except `/health`, `/ready` and the four `/auth/*` routes needs an
owner session, so a bare `curl` answers 401 by design. Sign in by opening
`http://127.0.0.1:2012/auth/github/login` in a browser.

## Notes

Design and planning live in [docs/working-notes/](docs/working-notes/). Start
with [open-work.md](docs/working-notes/open-work.md) for what's next, or
[plex-api-findings.md](docs/working-notes/plex-api-findings.md) for what the
Plex API actually returns.
