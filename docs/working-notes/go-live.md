# Go live

**Status:** In progress, 2026-09-21. Images, CI, the production compose file,
the vhosts and the deploy script are built; DNS, the OAuth app, the box's
`.env`, the first deploy and the backup unit are not. Read before the first
deploy. The machine's own conventions are the `shared-vps` skill; this note
holds only what is true of Engram.

## What makes this deploy unusual

Most first deploys start from an empty database. This one cannot. The
development database already holds the only copy of the hand-made marks —
Bleach's 424 episodes, Dexter's 96, every season the viewer claimed before
learning Plex still had the dates, some 650 of them and the count moving as
the record is used. They came from a person sitting at a
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
  `https://api.engram.vyoh.gg/auth/github/callback`. Separate apps are better: one
  client secret leaking from a laptop should not authorise production.
- **`/srv/engram/.env` by hand.** `DATABASE_URL`, the Postgres vars it must
  agree with, both OAuth values, `OWNER_GITHUB_USER_ID`, `WEBHOOK_SECRET`,
  `OAUTH_STATE_SECRET`, `TMDB_API_KEY`, `SESSION_COOKIE_DOMAIN`, `WEB_ORIGIN`.
  Production secrets have no local counterpart, so nothing rsyncs them.
- **`VITE_API_ORIGIN` is baked in at build time**, so DNS and the decision
  above must be settled before CI builds the image, not after.
- ~~**A compose file for the box.**~~ `compose.prod.yaml`, committed: api, web
  and Postgres, every port on loopback, memory limits, capped logs, and every
  required secret as `${VAR:?}` so a missing one fails at `up` with its own
  name rather than crash-looping later.
- **DNS, before CI builds the web image.** Neither name resolved as of
  2026-09-21. `engram.vyoh.gg` and `api.engram.vyoh.gg`, A and AAAA, copied
  from what `vyoh.gg` already answers — the panel lists a gateway beside the
  server address, and a wrong A with a right AAAA still issues a certificate
  while serving nothing over IPv4.
- **The `VITE_API_ORIGIN` repository variable** on GitHub, since the image is
  built in CI rather than on a laptop. CI fails the run if it is unset rather
  than shipping a bundle that calls localhost.
- **Nothing, for the registry.** Both packages are pullable from the box with
  no credential, verified 2026-09-21 by pulling both from the box itself.
  That is "Inherit access from source repository", GHCR's default, doing its
  job over a public repo — the same reason vyoh has never needed a credential
  either. The images hold no secret, which was checked rather than assumed.

  Recorded because it was briefly got wrong: an anonymous `curl` against
  `ghcr.io/v2/...` returned 404 for both projects and was read as "private".
  The token that request fetches does not grant pull, so it answers 404 for
  a public package as readily as a private one. The only test worth running
  is the one the deploy runs — `docker pull` from the box.

## Backups, before anything is entrusted to it

`ops/backup.sh` exists and is meant for cron; on this box it becomes
`engram-backup.service` plus a `.timer` writing to `/var/backups/engram`, mode
700. Two details the unit has to get right, both found by reading rather than
by running it: the deploy lands the script flat at `/srv/engram/backup.sh`,
not under `ops/`, and the stack is `compose.prod.yaml`, which Compose does not
look for on its own — the script now resolves it relative to itself, so the
unit's `WorkingDirectory` is what makes that work. The history is the product, so this lands with the first deploy, not after
it. Drill the restore against the real dump from step 3 above — a drill on an
empty schema proves only that the script runs, and the dump being drilled is
the irreplaceable one.

## Ingest after go-live

Being reachable is the last thing the rest of
[ingest-architecture.md](ingest-architecture.md) is waiting on. Tautulli went
up 2026-09-21 and Sonarr is there; neither can post to a laptop, which is now
the only reason webhooks are deferred. Once Engram is on 443 behind a
certificate:

- The webhook routes become verifiable against the real senders.
- The first real payloads can be read off this box's own logs, which is what
  the capture was waiting for — no tunnel and no third party, decided
  2026-09-21.
- The nightly reconcile has somewhere to run — a timer on the box, alongside
  the backup, rather than a script someone remembers to invoke. That
  reconcile is the Plex library walk, not a Tautulli pull; the walk moves from
  a one-time backfill to that timer, which is what keeps it a reconciliation
  rather than an import.

Owner-only ingest filtering landed 2026-09-21 and is a precondition met
rather than one outstanding — the server is shared, and a webhook fires for
every viewer on it.
