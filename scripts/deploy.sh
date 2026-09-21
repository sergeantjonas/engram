#!/usr/bin/env bash
# Deploys engram to the shared VPS, from a laptop.
#
#   scripts/deploy.sh                      # the current commit's images
#   ENGRAM_IMAGE_TAG=sha-abc1234 scripts/deploy.sh   # a rollback, or a retry
#
# A rollback is a tag, not a rebuild. It does **not** undo a migration:
# migrations run on every API boot and are forward-only, so going back past a
# destructive one is a restore from backup, not a deploy.
set -euo pipefail

HOST="${ENGRAM_DEPLOY_HOST:-vyoh}"
REMOTE_DIR="${ENGRAM_REMOTE_DIR:-/srv/engram}"
API_IMAGE="ghcr.io/sergeantjonas/engram-api"
WEB_IMAGE="ghcr.io/sergeantjonas/engram-web"
WEB_URL="${ENGRAM_WEB_URL:-https://engram.vyoh.gg}"
API_URL="${ENGRAM_API_URL:-https://api.engram.vyoh.gg}"
# Must match compose's defaults, which are overridable there for the same
# reason the note says the port pair is not a reservation.
API_PORT="${API_PORT:-2012}"
WEB_PORT="${WEB_PORT:-2011}"

cd "$(dirname "$0")/.."

TAG="${ENGRAM_IMAGE_TAG:-sha-$(git rev-parse --short=7 HEAD)}"
[[ "$TAG" =~ ^(sha-[0-9a-f]{7}|main)$ ]] || {
  echo "refusing to deploy an unrecognised tag: $TAG" >&2
  exit 1
}

# Checked from here, before anything on the box is touched. CI pushes both
# images only after smoking both, so a missing one means the run failed or is
# still going — either way this is a deploy that would half-land.
echo "==> checking $TAG is published"
for image in "$API_IMAGE" "$WEB_IMAGE"; do
  docker manifest inspect "$image:$TAG" >/dev/null 2>&1 || {
    echo "$image:$TAG is not on the registry — has CI finished?" >&2
    exit 1
  }
done

# Only the ops surface, and never .env: production secrets have no local
# counterpart and nothing here should be able to overwrite them. No --delete
# on the top level for the same reason — .env lives in that directory.
echo "==> copying the ops surface to $HOST:$REMOTE_DIR"
ssh "$HOST" "mkdir -p '$REMOTE_DIR'"
rsync -az compose.prod.yaml ops/backup.sh "$HOST:$REMOTE_DIR/"
rsync -az --delete deploy/ "$HOST:$REMOTE_DIR/deploy/"

# --wait-timeout, because `restart: unless-stopped` means a container that
# crash-loops — a migration that fails, most likely — never reaches "exited"
# and `--wait` would sit there until someone noticed.
echo "==> pulling and starting $TAG"
ssh "$HOST" "cd '$REMOTE_DIR' && ENGRAM_IMAGE_TAG='$TAG' docker compose -f compose.prod.yaml pull --quiet \
  && ENGRAM_IMAGE_TAG='$TAG' docker compose -f compose.prod.yaml up -d --no-build --wait --wait-timeout 180"

# Recorded here rather than after the smokes: this is the tag the box is
# running as of now, whether or not what follows is happy with it. Written
# later, the file names the previous tag while the new one serves traffic.
ssh "$HOST" "echo '$TAG' > '$REMOTE_DIR/.image-tag'"

# Loopback first, so a failure here separates "the container is wrong" from
# "nginx, DNS or TLS is wrong". `/ready` as well as `/health`: the first
# answers without touching Postgres by design, so on its own it says nothing
# about whether the database is reachable.
echo "==> smoking loopback"
ssh "$HOST" "curl -fsS http://127.0.0.1:$API_PORT/health >/dev/null \
  && curl -fsS http://127.0.0.1:$API_PORT/ready >/dev/null \
  && curl -fsS http://127.0.0.1:$WEB_PORT/healthz >/dev/null"

# Then the public URL, which is the only check that covers DNS, the vhost,
# the certificate and the firewall at once. The body is asserted, not just
# the status: until engram's vhost exists nginx answers these names from
# whichever server block is default, and the other tenant returning 200
# would read as a successful deploy.
echo "==> smoking the public URLs"
curl -fsS "$API_URL/health" | grep -q '"status":"ok"' \
  || { echo "$API_URL/health did not answer as engram — is the vhost installed?" >&2; exit 1; }
curl -fsS "$WEB_URL/" | grep -qi 'engram' \
  || { echo "$WEB_URL did not answer as engram — is the vhost installed?" >&2; exit 1; }

# Scoped to this project's images. The daemon is shared with the other
# tenant, and an unscoped prune takes its dangling layers and local rollback
# targets with it.
ssh "$HOST" "docker image prune -f --filter 'label=org.opencontainers.image.source=https://github.com/sergeantjonas/engram' >/dev/null || true"
echo "==> deployed $TAG"
