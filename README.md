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
a normalizer bug is recoverable rather than lossy. The one retraction is a mark
entered by hand, which is a claim rather than an observation and can simply be
the wrong one; nothing an ingest reported can be deleted through the API.

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
- `apps/web` — Vite + React SPA. TanStack Router and Query, Tailwind with Radix
  primitives.
- `packages/shared` — types and the GUID normalizer, shared by both.
- `tools/` — one-shot scripts. Currently the Plex history archiver.

### Why Fastify and not NestJS

The author's other project, `vyoh.gg`, is NestJS + Prisma, and this one
deliberately is not. Engram has one user and a surface measured in single-digit
routes; `buildApp({ config, db, tmdb, github })` is the entire dependency graph,
which is a thing to read rather than a container to configure. The API's whole
runtime dependency list is `fastify`, `drizzle-orm`, `postgres`, `zod` and the
shared package — no decorators, no `reflect-metadata`, nothing between the
request and the function that answers it.

The divergence is not free, and the cost is worth stating: porting `vyoh.gg`'s
GitHub OAuth flow meant translating controllers into route functions, guards
into `onRequest` hooks, DTOs into zod schemas, and hand-writing the
`Set-Cookie` serialisation Express gives NestJS for nothing. Roughly sixty lines
exist here that would not exist on the other stack. Consistency between the two
projects would have avoided that; the smaller surface was judged worth it.

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
API lands on `http://localhost:2012` and rebuilds on save. It is deliberately
not on 3000: the port is registered as the GitHub OAuth app's callback host, so
a collision would mean editing that registration rather than a flag. The SPA
lands on `http://localhost:2011`, which is the API's `WEB_ORIGIN`; both ports
are strict, so a collision fails loudly instead of quietly breaking CORS.

Use `localhost` for both, not `127.0.0.1`: the session cookie is host-only in
development, and the registered callback URL names `localhost`.

The record reads without a session: `GET /titles` and `GET /titles/:id` answer
anyone, so a bare `curl` gets the wall and any title page on it. Everything that
writes needs an owner session, and so does `GET /search`, which spends the TMDB
key. The two open reads answer the owner more fully than a stranger — excluded
titles and the notes on a hole are the owner's alone. Sign in from the SPA's
header, or by opening `http://localhost:2012/auth/github/login` in a browser.

## Notes

Design and planning live in [docs/working-notes/](docs/working-notes/). Start
with [open-work.md](docs/working-notes/open-work.md) for what's next, or
[plex-api-findings.md](docs/working-notes/plex-api-findings.md) for what the
Plex API actually returns.
