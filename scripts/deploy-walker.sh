#!/usr/bin/env bash
# Installs the nightly library walk on the Bytesized slot, from a laptop.
#
#   scripts/deploy-walker.sh                                # the current commit's image
#   ENGRAM_WALKER_TAG=sha-abc1234 scripts/deploy-walker.sh  # a rollback, or a retry
#   scripts/deploy-walker.sh --run                          # and walk once, now
#
# The secrets are not this script's to carry. ~/.config/engram/walker.env on
# the slot is written there by hand, mode 600, and nothing here reads a value
# out of it — only whether each one is set.
set -euo pipefail

HOST="${ENGRAM_WALKER_HOST:-enyo}"
IMAGE="ghcr.io/sergeantjonas/engram-walker"

cd "$(dirname "$0")/.."

run_now=
case "${1:-}" in
  '') ;;
  --run) run_now=1 ;;
  *) echo "usage: $0 [--run]" >&2; exit 1 ;;
esac

# sha- alone: CI publishes no moving tag for the walker, and the slot runs
# exactly the one named here until the next deploy names another.
# Cut rather than --short=7, which is a minimum: git lengthens an ambiguous
# abbreviation, and CI's tag is always seven.
TAG="${ENGRAM_WALKER_TAG:-sha-$(git rev-parse HEAD | cut -c1-7)}"
[[ "$TAG" =~ ^sha-[0-9a-f]{7}$ ]] || {
  echo "refusing to deploy an unrecognised tag: $TAG" >&2
  exit 1
}

# The units come from the tag's own commit, not the working tree, so a
# rollback takes its units back with its image and an uncommitted edit is
# never what the slot runs.
commit="${TAG#sha-}"
for unit in engram-walker.service engram-walker.timer; do
  git cat-file -e "$commit:deploy/walker/$unit" 2>/dev/null || {
    echo "$commit has no deploy/walker/$unit — is that commit fetched here?" >&2
    exit 1
  }
done

echo "==> checking $IMAGE:$TAG is published"
docker manifest inspect "$IMAGE:$TAG" >/dev/null 2>&1 || {
  echo "$IMAGE:$TAG is not on the registry — has CI finished?" >&2
  exit 1
}

# One connection for every step below, so a key with a passphrase asks once.
ctl_dir="$(mktemp -d)"
ctl="$ctl_dir/ctl"
trap 'ssh -o ControlPath="$ctl" -O exit "$HOST" 2>/dev/null || true; rm -rf "$ctl_dir"' EXIT
ssh -fNM -o ControlPath="$ctl" "$HOST"
on_slot() { ssh -o ControlPath="$ctl" "$HOST" "$@"; }

# Non-interactive, so the slot's .bashrc exports none of this: the rootless
# daemon's socket has to be named, and XDG_RUNTIME_DIR stays the real one,
# which is what `systemctl --user` needs to find its manager.
docker_env='export DOCKER_HOST="unix://$HOME/.docker/run/docker.sock";'

# Before anything is installed: a timer over a missing or half-filled env file
# fails every night, and docker's --env-file keeps quotes as part of the
# value, so a quoted secret is a wrong secret that looks right.
echo "==> checking the env file on $HOST"
on_slot 'set -e
  f="$HOME/.config/engram/walker.env"
  [ -f "$f" ] || { echo "$f is missing — write it by hand first" >&2; exit 1; }
  [ "$(stat -c %a "$f")" = 600 ] || { echo "$f must be mode 600" >&2; exit 1; }
  for name in PLEX_TOKEN ENGRAM_INGEST_URL INGEST_SECRET PLEX_SERVER_ID; do
    grep -q "^$name=." "$f" || { echo "$name is not set in $f" >&2; exit 1; }
  done
  if grep -Eq "^[A-Z_]+=[\"'\'']" "$f"; then
    echo "$f quotes a value; docker would keep the quotes" >&2; exit 1
  fi'

# A warning, not a refusal: without the ping key the walk still runs, and its
# check on healthchecks.io goes quiet and alerts, which is the failure showing.
on_slot 'h="$HOME/.config/engram/heartbeat.env"
  if [ ! -f "$h" ] || ! grep -q "^HC_PING_KEY=." "$h"; then
    echo "warning: $h has no HC_PING_KEY, so the walk will report nothing and its check will alert" >&2
  elif [ "$(stat -c %a "$h")" != 600 ]; then
    echo "warning: $h should be mode 600" >&2
  fi'

# Read before it is replaced: the image this deploy takes over from is the
# rollback target, and the one kept when older images are removed below.
previous="$(on_slot 'sed -n "s/^WALKER_IMAGE=//p" "$HOME/.config/engram/walker.image" 2>/dev/null' || true)"

# Anonymous: the slot holds no registry credentials, so a package that is
# still private on GHCR fails here rather than at 04:30.
echo "==> pulling $TAG on $HOST"
on_slot "$docker_env docker pull -q '$IMAGE:$TAG' >/dev/null" || {
  echo "the pull failed — is the engram-walker package public on GHCR?" >&2
  exit 1
}

echo "==> installing the units"
on_slot 'mkdir -p "$HOME/.config/systemd/user" "$HOME/.local/state/engram" "$HOME/.local/share/engram"'
for unit in engram-walker.service engram-walker.timer; do
  git show "$commit:deploy/walker/$unit" | on_slot "cat > \"\$HOME/.config/systemd/user/$unit\""
done
# A tag older than the heartbeat has units that never call it, so a rollback
# to one installs without it rather than being refused.
if git cat-file -e "$commit:ops/heartbeat.sh" 2>/dev/null; then
  git show "$commit:ops/heartbeat.sh" | on_slot 'cat > "$HOME/.local/share/engram/heartbeat.sh" && chmod 755 "$HOME/.local/share/engram/heartbeat.sh"'
fi
on_slot "umask 077 && printf 'WALKER_IMAGE=%s\n' '$IMAGE:$TAG' > \"\$HOME/.config/engram/walker.image\""
on_slot 'systemd-analyze --user verify "$HOME/.config/systemd/user/engram-walker.service" "$HOME/.config/systemd/user/engram-walker.timer"'
on_slot 'systemctl --user daemon-reload && systemctl --user enable --now --quiet engram-walker.timer'

# Scoped to the walker's own repository by name. The slot runs other
# containers, and their images are not this script's to remove.
on_slot "$docker_env docker image ls --format '{{.Repository}}:{{.Tag}}' '$IMAGE' \
  | grep -vxF -e '$IMAGE:$TAG' -e '${previous:-$IMAGE:$TAG}' | xargs -r docker rmi >/dev/null" || true

if [ -n "$run_now" ]; then
  # A oneshot's start returns when the walk has, with whether it failed.
  echo "==> walking now"
  status=0
  on_slot 'systemctl --user start engram-walker.service' || status=$?
  on_slot 'tail -n 20 "$HOME/.local/state/engram/walker.log"' || true
  [ "$status" -eq 0 ] || { echo "the walk failed" >&2; exit "$status"; }
fi

on_slot 'systemctl --user list-timers engram-walker.timer --no-pager | head -2'
echo "==> installed $TAG on $HOST"
