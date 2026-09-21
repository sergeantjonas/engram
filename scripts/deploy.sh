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
ssh "$HOST" "mkdir -p $REMOTE_DIR"
rsync -az compose.prod.yaml ops/backup.sh "$HOST:$REMOTE_DIR/"
rsync -az --delete deploy/ "$HOST:$REMOTE_DIR/deploy/"

echo "==> pulling and starting $TAG"
ssh "$HOST" "cd $REMOTE_DIR && ENGRAM_IMAGE_TAG=$TAG docker compose -f compose.prod.yaml pull --quiet \
  && ENGRAM_IMAGE_TAG=$TAG docker compose -f compose.prod.yaml up -d --no-build --wait"

# Loopback first, so a failure here separates "the container is wrong" from
# "nginx, DNS or TLS is wrong".
echo "==> smoking loopback"
ssh "$HOST" "curl -fsS http://127.0.0.1:2012/health >/dev/null && curl -fsS http://127.0.0.1:2011/healthz >/dev/null"

# Then the public URL, which is the only check that covers DNS, the vhost,
# the certificate and the firewall at once. A loopback check passes happily
# while every one of those is broken.
echo "==> smoking the public URLs"
curl -fsS "$API_URL/health" >/dev/null
curl -fsS "$WEB_URL/" >/dev/null

ssh "$HOST" "cd $REMOTE_DIR && docker image prune -f >/dev/null && echo $TAG > .image-tag"
echo "==> deployed $TAG"
