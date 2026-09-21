#!/usr/bin/env bash
# Proves a dump can be restored, by restoring it and counting what came back.
#
#   ops/restore-drill.sh                       # the newest dump in BACKUP_DIR
#   ops/restore-drill.sh /var/backups/engram/engram-2026-09-21T....sql.gz
#
# Changes nothing. It restores into a scratch database, compares every table's
# row count against the live one, and drops the scratch copy. A drill against
# an empty schema proves only that the script runs — this one proves the dump
# holds the record.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/engram}"
POSTGRES_USER="${POSTGRES_USER:-engram}"
POSTGRES_DB="${POSTGRES_DB:-engram}"
SCRATCH="${SCRATCH_DB:-engram_drill}"

here="$(cd "$(dirname "$0")" && pwd)"
if [ -z "${COMPOSE_FILE:-}" ]; then
  for candidate in "$here/compose.prod.yaml" "$here/../compose.prod.yaml" "$here/../docker-compose.yml"; do
    [ -f "$candidate" ] && { COMPOSE_FILE="$candidate"; break; }
  done
fi
[ -n "${COMPOSE_FILE:-}" ] || { echo "no compose file found next to $0" >&2; exit 1; }

dump="${1:-}"
if [ -z "$dump" ]; then
  dump="$(ls -1t "$BACKUP_DIR"/engram-*.sql.gz 2>/dev/null | head -1 || true)"
fi
[ -n "$dump" ] && [ -f "$dump" ] || { echo "no dump to drill (looked in $BACKUP_DIR)" >&2; exit 1; }
echo "drilling $dump"

psql() { docker compose -f "$COMPOSE_FILE" exec -T postgres psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" "$@"; }

# Dropped on every exit path, so a failed drill does not leave a copy of the
# whole history sitting in the cluster.
cleanup() { psql -d postgres -q -c "drop database if exists $SCRATCH;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
psql -d postgres -q -c "create database $SCRATCH owner $POSTGRES_USER;"

gunzip -c "$dump" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$SCRATCH" -q >/dev/null

counts() {
  psql -d "$1" -t -A -F' ' -c "
    select 'title', count(*) from title
    union all select 'episode', count(*) from episode
    union all select 'watch_event', count(*) from watch_event
    union all select 'library_presence', count(*) from library_presence
    union all select 'intent', count(*) from intent
    union all select 'episode_gap', count(*) from episode_gap
    order by 1;"
}

live="$(counts "$POSTGRES_DB")"
restored="$(counts "$SCRATCH")"

echo
printf '%-18s %10s %10s\n' table live restored
diff_found=0
while read -r name n; do
  m="$(echo "$restored" | awk -v t="$name" '$1==t {print $2}')"
  printf '%-18s %10s %10s%s\n' "$name" "$n" "${m:-missing}" "$([ "$n" = "${m:-}" ] || echo '   <-- differs')"
  [ "$n" = "${m:-}" ] || diff_found=1
done <<< "$live"

echo
if [ "$diff_found" -ne 0 ]; then
  echo "the dump does not match the live record — do not trust it" >&2
  exit 1
fi
echo "every table matches; the dump restores to the record that is live"
