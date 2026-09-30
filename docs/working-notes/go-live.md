# Go live

**Status:** Done, 2026-09-21 — Engram is live at <https://engram.vyoh.gg>
with the full record restored and a nightly backup running. The last gap,
an off-box copy, closed 2026-09-29: every nightly dump goes to Backblaze B2
under a 30-day lock, and a drill from the B2 copy passed the same evening.
Nothing yet says when a night fails. Kept as the account of how it got there.
The machine's own conventions are the `shared-vps` skill; this note holds
only what is true of Engram.

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

`engram-backup.service` plus a `.timer`, installed 2026-09-21, writing to
`/var/backups/engram` at mode 700. Two details the unit had to get right,
both found by reading rather than by running it: the deploy lands the script
flat at `/srv/engram/backup.sh`, not under `ops/`, and the stack is
`compose.prod.yaml`, which Compose does not look for on its own — the script
resolves it relative to itself, and the unit's `WorkingDirectory` is what
makes that work.

`/var/backups/engram` is outside `/srv` deliberately. The deploy rsyncs into
`/srv/engram`, and a backup living inside the directory a deploy writes to is
one flag away from being destroyed by the thing it exists to survive. The
timer carries a 45-minute random delay so two tenants' dumps do not collide
at midnight on four shared cores, and `Persistent=true` so a box that was off
at the scheduled time still gets one.

**The drill passed against the real record**, which is the only version of it
worth running: `ops/restore-drill.sh` restores the newest dump into a scratch
database, compares the row count of each table that holds the record, and
drops the copy. All six matched — 82 titles, 2467 episodes, 1109 events, 81
presence rows, 2 intents, 0 gaps. A drill against an empty schema proves the
script runs and nothing else.

It compared against the live record then, which held on the day it ran.
Tautulli writes every play, and from 2026-09-29 the walk and the backfill
write every night, so a dump a few hours old differs from live without being
wrong. So the drill now compares the restore against the rows the dump's own
`COPY` blocks carry, and prints live beside them. Live decides one thing: a
dump holding no titles, or more than live, fails, because a restore matches
a dump of an empty or wrong database just as faithfully, and nothing deletes
a title. Re-run
that day against the go-live dump itself, it restored to the six counts
above while live stood at 113 titles, 3525 episodes and 1767 events.

**Until 2026-09-29, nothing left the box.** The dumps sit on the same disk as
the database they came from, so they survive a bad migration, a wrong delete
or a botched restore, and not the disk dying or the VPS going away. For a
project whose whole argument is that the record should outlive the thing
holding it, that was the last real gap. The owner intends an off-box copy when the next
machine is set up; vyoh has the same gap and the same answer.

Scoped 2026-09-29. The copy goes to **Backblaze B2**, on the free
tier, in the EU region. What decided it is what someone who has broken into
the box could do to the copy. Each tenant has a bucket of its own, engram's
being `vyoh-engram-backup` in `eu-central-003`, and the box holds a key per
tenant that can write and do nothing else. So it cannot read what it sent,
and cannot delete it once the bucket holds it under a lock — see below for
why a key alone does not settle the delete. Retention is the bucket's to
enforce, not the box's.
Each dump is encrypted with `age` before it leaves, and only the public key
is on the box.
The private key is kept by the owner, in a password manager and on paper,
and never here. Losing it makes every off-box copy unreadable, which is the
one real risk in this design. The size is measured rather than guessed: an
engram dump is 780 KB and a vyoh one 172 MB, so thirty days of both is about
5.2 GB against the 10 GB free.

Weighed and not taken:
- Google Drive and MEGA: the credential on the box could delete what it
  uploaded, and the owner's own Drive was not to be exposed.
- The Bytesized slot: not what a seedbox is for.
- The owner's laptop pulling the dumps: it needs no new credential, but runs
  only while the laptop is awake. It stays the fallback.

The work is one chunk per tenant, each in its own repo:
- ~~the upload hooked after the nightly dump~~ — installed 2026-09-29;
- ~~retention set on the bucket~~ — a 30-day compliance lock, and a lifecycle
  rule that hides a copy 30 days after upload and deletes it a day later;
- ~~a restore drill run from the B2 copy, not the local one~~ — passed
  2026-09-29, `scripts/offsite-drill.sh`.

**The upload** is `ops/offsite.sh`, a second `ExecStart` in
`engram-backup.service`, so it runs only after a dump succeeded and sends
that one. It seals the dump with `age` and makes the three B2 calls an
upload needs: authorize, ask for an upload URL, upload. It uses curl against
B2's native API, not rclone or the b2 CLI. A sync tool lists the destination
before it writes, which is a capability this key must not hold, and Debian's
rclone is 1.60. B2 checks the SHA-1 sent with the upload against the bytes it
received, so an upload that succeeds is complete. The script refuses a key
holding anything but `writeFiles`, or one that reaches past a single bucket
and the `engram/` prefix, and checks it on every run, because a master key
pasted in by mistake would void the design without a sound. On the first
real run that is what it caught: the master key sat in place of the upload
key, and the run sent nothing. The master key was on the box for four
minutes and was rotated the same evening.
The key and the recipient live in `/etc/engram/offsite.env`, root-only. That
keeps the key out of the tree a deploy writes to and away from other
accounts, and from nothing else: `deploy` drives the rootful Docker daemon and
owns the script systemd runs with the key, so whoever is `deploy` has the key.
The key's reach and the bucket's lock are the whole defence. Tested first
against a fake of those three calls in a Debian 13 container, including a
busy 503, a wrong key and an over-broad key, then against B2 on 2026-09-29.

**A key that can only write can still delete, given a lifecycle rule.** Found
while building: `b2_hide_file` needs nothing beyond `writeFiles`. So the box's
key can hide any copy it sent, or supersede one by uploading under the same
name, and the box has thirty of those names in `/var/backups/engram`. A
lifecycle rule that deletes hidden versions then does the deleting for it.
What closes that is **Object Lock** with a default retention. B2 allows it on
an existing bucket, and it can never be turned off again. A lifecycle rule
cannot delete a version that is still under retention.

Compliance mode, decided 2026-09-29. Governance was weighed first, because it
lets the owner's master key clear junk an intruder uploaded. But the console
sets only compliance, and compliance also holds against someone who takes
over the Backblaze account, which governance does not. What governance would
have saved is thirty days of storing junk, at a few dollars a terabyte a
month. The lock buys thirty days, not forever. An intruder who owns the box
can stop the uploads and hide every copy, and the lifecycle rule deletes each
one as its lock runs out, so noticing a stopped backup within the month is
what the lock is for. B2's docs did not say whether a bucket's default
retention applies to an upload from a key without `writeFileRetentions`; the
first drill read it back as `compliance`, thirty days from upload, so it
does.

**The drill** runs from the laptop and starts from only what outlives the
box: a second key, held on the laptop, with `listFiles`, `readFiles` and
`readFileRetentions` on the bucket under `engram/`, and the owner's age
identity. The identity is the one thing that must never be on the box. The
drill fetches the newest copy, checks it against the SHA-1 B2 recorded, and
reports how many copies there are, how old the newest is, and the lock it
carries. Then it decrypts the copy and restores it into a scratch database on
the box through `restore-drill.sh`, which checks each table against what the
copy itself holds. Tested 2026-09-29 against the same fake, extended
with listing and download, with `ssh` stood in by a local shell. It chose the
newest copy and delivered the box's dump byte for byte. It reported a lock,
no lock, and a key that cannot see locks, and it failed on a corrupted
download and on the wrong identity.

**Installed 2026-09-29**, in this order. First `age` and `jq` on the box, both
from Debian 13. Then two keys, each made through `b2_create_key` with an exact
list rather than whatever one of the console's access types bundles, and both
on the bucket under `engram/`. The upload key holds `writeFiles` alone, since
the script refuses anything more; the laptop's drill key holds `listFiles`,
`readFiles` and `readFileRetentions`. Then `/etc/engram/offsite.env` at 0600
holding `B2_KEY_ID`, `B2_APPLICATION_KEY` and `OFFSITE_AGE_RECIPIENT`, a deploy
on the images already running, and the unit copied in and started by hand.
The owner checked beforehand that the age public key pairs with the private
key they hold, by round-tripping a string through both.

**The first drill passed against B2** the same evening. It found one copy,
minutes old, under a compliance lock until 2026-10-29, which it decrypted and
restored. All six tables matched the dump and the live record: 113 titles,
3525 episodes, 1767 events, 81 presence rows, 3 intents and 0 gaps. The first
unattended night, 2026-09-30, sent its copy at 00:03, a second after the dump.
Whether
the lifecycle rule prunes cannot show until a copy is 31 days old. A drill
after 2026-10-30 should report an oldest copy of no more than 31 days.

vyoh's backup ran as root, so its dumps were unreadable to `deploy`. Moving
it to `deploy` was handed to vyoh's own repo the same day, as the step before
its half. The history is the product, so this lands with the first deploy, not after
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
- The nightly reconcile has somewhere to push to. That reconcile is the Plex
  library walk, not a Tautulli pull, and it runs on the Bytesized slot rather
  than on this box, because the Plex token it needs is not allowed here —
  see [ingest-architecture.md](ingest-architecture.md) § Where the walk runs.
  What this box gains is the route it posts to and a timer, alongside the
  backup, for the TMDB backfills a new title needs.

Owner-only ingest filtering landed 2026-09-21 and is a precondition met
rather than one outstanding — the server is shared, and a webhook fires for
every viewer on it.
