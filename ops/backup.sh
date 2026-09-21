#!/usr/bin/env bash
# Dumps the Engram database and prunes old dumps.
#
# The whole point of this project is that the watch history outlives the media,
# which it does not do if it lives only in an unbacked-up container volume.
# Run from cron or a systemd timer, and send BACKUP_DIR somewhere off this box.
#
#   BACKUP_DIR=/var/backups/engram ops/backup.sh
#
# On the VPS the stack is `compose.prod.yaml`, which is not one of the four
# filenames Compose looks for on its own — so COMPOSE_FILE is defaulted below
# rather than left to be remembered in a unit file.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
POSTGRES_USER="${POSTGRES_USER:-engram}"
POSTGRES_DB="${POSTGRES_DB:-engram}"

# Resolved relative to this script rather than to the caller's directory: a
# timer runs with no meaningful cwd, and `docker compose` with no file and no
# match exits "no configuration file provided" rather than doing nothing
# visible.
here="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${COMPOSE_FILE:-}" ]; then
  for candidate in "$here/compose.prod.yaml" "$here/../compose.prod.yaml" "$here/../docker-compose.yml"; do
    [ -f "$candidate" ] && { COMPOSE_FILE="$candidate"; break; }
  done
fi
[ -n "${COMPOSE_FILE:-}" ] || { echo "no compose file found next to $0" >&2; exit 1; }

# A dump smaller than this is an empty or wrong database. Promoting one would
# start the retention clock on a worthless file and eventually prune the last
# good backup.
MIN_BYTES="${MIN_BYTES:-1000}"

mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
target="$BACKUP_DIR/engram-$stamp.sql.gz"

# Never leave a partial behind, whatever the exit path.
trap 'rm -f "$target.partial"' EXIT

# Run pg_dump inside the container so the client always matches the server;
# a host pg_dump older than the server refuses to run at all.
docker compose -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump --clean --if-exists --no-owner -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$target.partial"

size="$(wc -c < "$target.partial")"
if [ "$size" -lt "$MIN_BYTES" ]; then
  echo "dump is only ${size} bytes, refusing to promote it" >&2
  exit 1
fi

# Renamed only after a complete, plausible dump, so a truncated file is never
# mistaken for a usable backup.
mv "$target.partial" "$target"
trap - EXIT
echo "wrote $target ($(du -h "$target" | cut -f1))"

# Sweeps stale partials too, which a previous crash may have left behind.
find "$BACKUP_DIR" \( -name 'engram-*.sql.gz' -o -name 'engram-*.sql.gz.partial' \) \
  -mtime "+$KEEP_DAYS" -delete
echo "pruned dumps older than $KEEP_DAYS days"
