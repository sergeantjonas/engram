#!/usr/bin/env bash
# Tells healthchecks.io how the unit that ran it ended, from that unit's
# ExecStopPost: a success, or a failure saying how the run ended.
#
#   ExecStopPost=-/srv/engram/heartbeat.sh engram-backup journal
#   ExecStopPost=-/srv/engram/heartbeat.sh engram-backfill
#
# The first argument is the check's slug, which is also the unit's name.
# `journal` as the second attaches the run's last journal lines to a failure.
# Only a unit whose output is safe to hand a third party asks for it: the
# backup's lines are file names, sizes and B2's errors, where the backfill's
# name titles and the walk's name the Plex server and the address it reached,
# which stay on their hosts. HC_PING_KEY, the project's ping key, comes from
# the unit's EnvironmentFile.
#
# What raises the alarm is a check going quiet, not this script succeeding: a
# night that never runs, a host that is down and a key that is missing all end
# with no ping, and healthchecks.io alerts once the check's grace runs out. So
# this always exits 0, and the unit's own result is never changed by it.

set -uo pipefail

slug="${1:-}"
attach="${2:-}"

[[ "$slug" =~ ^[a-z0-9-]+$ ]] || { echo "heartbeat: refusing slug '$slug'" >&2; exit 0; }
[ -n "${HC_PING_KEY:-}" ] || { echo "heartbeat: HC_PING_KEY is not set, so $slug goes unreported and will alert" >&2; exit 0; }

path=""
body="/dev/null"
# systemd sets SERVICE_RESULT for ExecStopPost; anything but success, a
# timeout included, is a failure.
if [ "${SERVICE_RESULT:-}" != success ]; then
  path="/fail"
  body="$(mktemp)"
  trap 'rm -f "$body"' EXIT
  echo "result=${SERVICE_RESULT:-unknown} exit=${EXIT_CODE:-?}/${EXIT_STATUS:-?}" >"$body"
  if [ "$attach" = journal ] && [ -n "${INVOCATION_ID:-}" ]; then
    journalctl -q --no-pager -o cat -n 30 _SYSTEMD_INVOCATION_ID="$INVOCATION_ID" 2>&1 |
      sed 's/\x1b\[[0-9;]*m//g' >>"$body"
  fi
fi

# The key reaches curl in a config on stdin rather than in the URL on its
# command line, which every user on the host can read from the process list.
printf 'url = "https://hc-ping.com/%s/%s%s"\n' "$HC_PING_KEY" "$slug" "$path" |
  curl -fsS --max-time 10 --retry 3 -o /dev/null -K - --data-binary @"$body" ||
  echo "heartbeat: could not reach healthchecks.io, so $slug will alert" >&2
exit 0
