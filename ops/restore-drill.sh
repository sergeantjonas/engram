#!/usr/bin/env bash
# Proves a dump can be restored, by restoring it and counting what came back.
#
#   ops/restore-drill.sh                       # the newest dump in BACKUP_DIR
#   ops/restore-drill.sh /var/backups/engram/engram-2026-09-21T....sql.gz
#
# Changes nothing. It restores into a scratch database, compares the row count
# of every table that holds the record against what the dump itself holds, and
# drops the scratch copy. The live count is printed beside them and decides
# only whether the dump is of this record at all: the nightly walk and every
# play write to the live record, so a dump a few hours old differs from it
# without being wrong. A drill against an
# empty schema proves only that the script runs — this one proves the dump
# restores to the record it holds.
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

# The tables that hold the record. collection and collection_part are a TMDB
# cache and session is sign-ins, none of which a restore exists to bring back.
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

restored="$(counts "$SCRATCH")"
live="$(counts "$POSTGRES_DB")"

# The rows each COPY block in the dump carries. Text-format COPY escapes a
# newline and a backslash inside a value, so a row is exactly one line, and a
# line that is only `\.` can only be the end of a block.
dumped="$(gunzip -c "$dump" | awk '
  /^COPY public\./ { t = substr($2, 8); n = 0; inside = 1; next }
  inside && $0 == "\\." { print t, n; inside = 0; next }
  inside { n++ }')"

lookup() { echo "$1" | awk -v t="$2" '$1 == t { print $2 }'; }

echo
printf '%-18s %10s %10s %10s\n' table dump restored live
diff_found=0
moved=0
while read -r name m; do
  d="$(lookup "$dumped" "$name")"
  n="$(lookup "$live" "$name")"
  note=""
  if [ "$d" != "$m" ]; then
    note='   <-- differs from the dump'; diff_found=1
  elif [ "$n" -lt "$m" ]; then
    # Legitimate after a mark is taken back, and also what losing rows looks
    # like, so it is not folded into the ordinary case below.
    note='   (live has fewer)'; moved=1
  elif [ "$n" != "$m" ]; then
    note='   (live has moved on)'; moved=1
  fi
  printf '%-18s %10s %10s %10s%s\n' "$name" "${d:-missing}" "$m" "${n:-?}" "$note"
done <<< "$restored"

echo
if [ "$diff_found" -ne 0 ]; then
  echo "the restore does not hold what the dump does — do not trust it" >&2
  exit 1
fi
# A restore matches a dump of an empty or wrong database as faithfully as a
# good one. Nothing deletes a title, so a dump holding none, or more than live
# does, is not a dump of this record.
dumped_titles="$(lookup "$dumped" title)"
live_titles="$(lookup "$live" title)"
if [ "$dumped_titles" -eq 0 ] || [ "$dumped_titles" -gt "$live_titles" ]; then
  echo "the dump holds $dumped_titles titles against $live_titles live — not a dump of this record" >&2
  exit 1
fi
[ "$moved" -eq 0 ] || echo "the live record has changed since this dump was taken, which decides nothing"
echo "every table restores to what the dump holds"
