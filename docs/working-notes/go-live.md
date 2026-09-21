# Go live

**Status:** Plan — not started, written 2026-09-21. Read before the first
deploy. The machine's own conventions are the `shared-vps` skill; this note
holds only what is true of Engram.

## What makes this deploy unusual

Most first deploys start from an empty database. This one cannot. The
development database already holds the only copy of 655 hand-made marks —
Bleach's 424 episodes, Dexter's 96, every season the viewer claimed before
learning Plex still had the dates. They came from a person sitting at a
keyboard, not from a source that can be replayed. **A production database that
starts empty loses them permanently**, and no ingest run brings them back.

So the ordering is not a preference:

1. Land the unified ingest and run every backfill **locally**, against the
   development database, where a bad run is a `docker compose down -v` away
   from a retry.
2. Verify the merged record locally — the counts in
   [open-work.md](open-work.md) are the expected result, so they double as the
   acceptance check.
3. `pg_dump` that database and restore it as the production database's first
   content.
4. Only then point a browser at it.

Deploying first and backfilling against production inverts every one of those
safety properties for no gain.

## The box

Engram is the second tenant on the netcup VPS. Measured 2026-09-21: `vyoh` is
the only tenant, on loopback 2009 and 2010, with 6.4 GB of 7.9 GB available and
227 GB of 251 GB free. Two more loopback ports and a Postgres container fit
comfortably. Per the box's convention, ask `ss -lntp` for free ports at deploy
time rather than trusting those numbers — they are a snapshot, and the
dev-machine habit of 2011/2012 is not a reservation.

Everything else — nginx as the only ingress, loopback-only binds, Postgres
inside this project's own compose stack, images built in CI and pulled on the
box, memory limits, capped logs — is the shared convention and is not restated
here.

## Names and the session cookie

Two hostnames, because the SPA and the API are separate origins:
`engram.vyoh.gg` and `api.engram.vyoh.gg`.

The session cookie is `SameSite=Lax` and host-only by default
([apps/api/src/auth/cookies.ts:44](../../apps/api/src/auth/cookies.ts#L44)),
which is the production form of the trap the README already records for
`localhost` versus `127.0.0.1`: the SPA's `credentials: 'include'` call to a
different host drops the cookie on the floor. `SESSION_COOKIE_DOMAIN` exists
for exactly this and must be set to `.engram.vyoh.gg`, which makes the two
hosts same-site and leaves `Lax` correct. Getting this wrong produces a sign-in
that appears to succeed and then behaves as signed out.

`WEB_ORIGIN` must be `https://engram.vyoh.gg` with no trailing slash — config
rejects one — and its `https://` is also what flips the cookie's `Secure`
flag on.

## Before the first deploy

- **A second GitHub OAuth app**, or at minimum a second callback URL. The
  development app points at localhost; production needs
  `https://api.engram.vyoh.gg/auth/callback`. Separate apps are better: one
  client secret leaking from a laptop should not authorise production.
- **`/srv/engram/.env` by hand.** `DATABASE_URL`, the Postgres vars it must
  agree with, both OAuth values, `OWNER_GITHUB_USER_ID`, `WEBHOOK_SECRET`,
  `OAUTH_STATE_SECRET`, `TMDB_API_KEY`, `SESSION_COOKIE_DOMAIN`, `WEB_ORIGIN`.
  Production secrets have no local counterpart, so nothing rsyncs them.
- **`VITE_API_ORIGIN` is baked in at build time**, so DNS and the decision
  above must be settled before CI builds the image, not after.
- **A compose file for the box.** The existing `docker-compose.yml` is the
  development database alone; production needs api, web and Postgres with
  memory limits and log caps.

## Backups, before anything is entrusted to it

`ops/backup.sh` exists and is meant for cron; on this box it becomes
`engram-backup.service` plus a `.timer` writing to `/var/backups/engram`, mode
700. The history is the product, so this lands with the first deploy, not after
it. Drill the restore against the real dump from step 3 above — a drill on an
empty schema proves only that the script runs, and the dump being drilled is
the irreplaceable one.

## Ingest after go-live

Being reachable is what unblocks the rest of
[ingest-architecture.md](ingest-architecture.md). Tautulli and Sonarr cannot
post to a laptop, which is half of why webhooks are deferred; the other half is
that Tautulli is still not installed. Once Engram is on 443 behind a
certificate:

- The webhook routes become verifiable against the real senders.
- The nightly reconcile has somewhere to run — a timer on the box, alongside
  the backup, rather than a script someone remembers to invoke.
- The Plex library walk moves from a one-time backfill to that same nightly
  job, which is what keeps it a reconciliation rather than an import.

Owner-only ingest filtering must land before any of that, per
[open-work.md](open-work.md) — the server is shared, and a webhook fires for
every viewer on it.
