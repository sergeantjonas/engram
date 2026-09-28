#!/usr/bin/env bash
# Fills in what the nightly library walk cannot: the episodes of each show
# that nothing has been watched in, which the walk does not write, and the
# artwork and overviews of titles it added. Both read TMDB, and the walk's
# route deliberately fetches nothing, so they run here on a timer instead.
#
#   /srv/engram/backfill.sh
#
# Inside the API container that is already running, rather than a one-off
# `compose run`: exec reaches the image the last deploy pinned and the env it
# started with, where `run` would build a container from the compose file and
# take `main` for any ENGRAM_IMAGE_TAG left unset.

set -uo pipefail

# Relative to this script for the reason backup.sh gives: a timer runs with no
# meaningful working directory of its own.
here="$(cd "$(dirname "$0")" && pwd)"
compose_file="${COMPOSE_FILE:-$here/compose.prod.yaml}"
[ -f "$compose_file" ] || { echo "no compose file at $compose_file" >&2; exit 1; }

# Both run whatever the first one did. Stopping at the first failure would let
# one show TMDB keeps failing on hold every new title's artwork back night
# after night, and each exits non-zero on any title TMDB fails on, so the unit
# still reports it.
status=0
backfill() {
  echo "==> $*"
  docker compose -f "$compose_file" exec -T api node "$@" || status=1
}

backfill dist/titles/backfill-cli.js
# Every title, not only those never fetched: show status and the next air date
# go stale, and this run is what keeps them current. A refresh never erases
# artwork or an overview TMDB has stopped returning.
backfill dist/titles/backfill-metadata-cli.js --refresh
exit "$status"
