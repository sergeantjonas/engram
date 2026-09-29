#!/usr/bin/env bash
# Sends a dump off the box: encrypted with age to the owner's public key, then
# uploaded to Backblaze B2 under a key that can write into engram/ and nothing
# else.
#
#   /srv/engram/offsite.sh                 # the newest dump in BACKUP_DIR
#   /srv/engram/offsite.sh <dump.sql.gz>
#
# Runs after backup.sh in the same unit, which is why the newest dump is the
# right default: a dump that fails stops the unit before this starts.
#
#   B2_KEY_ID, B2_APPLICATION_KEY   the upload key
#   OFFSITE_AGE_RECIPIENT           age1…, the public half; the private half
#                                   is never on this box
#
# B2's native API over curl rather than a sync tool: the three calls made here
# need nothing past writeFiles, where a sync tool also wants to list what is
# already there. B2 refuses an upload whose SHA-1 does not match the bytes that
# arrived, so an upload that succeeds is a complete one.

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/engram}"
: "${B2_KEY_ID:?}" "${B2_APPLICATION_KEY:?}" "${OFFSITE_AGE_RECIPIENT:?}"

# The key is made with this prefix and refused below without it, so a key
# pasted in from the wrong entry fails loudly instead of writing somewhere else.
PREFIX="engram/"

for tool in age curl jq sha1sum base64; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed" >&2; exit 1; }
done

dump="${1:-}"
if [ -z "$dump" ]; then
  dump="$(ls -1t "$BACKUP_DIR"/engram-*.sql.gz 2>/dev/null | head -1 || true)"
fi
[ -n "$dump" ] && [ -f "$dump" ] || { echo "no dump to send (looked in $BACKUP_DIR)" >&2; exit 1; }

name="$PREFIX$(basename "$dump").age"
# B2 wants the name percent-encoded; holding it to characters that encode to
# themselves avoids encoding it at all.
[[ "$name" =~ ^[A-Za-z0-9._/-]+$ ]] || { echo "refusing to name an upload $name" >&2; exit 1; }

sealed="$(mktemp)"
trap 'rm -f "$sealed"' EXIT
age -r "$OFFSITE_AGE_RECIPIENT" -o "$sealed" "$dump"
sha1="$(sha1sum "$sealed" | cut -d' ' -f1)"

# A oneshot unit has no start timeout, so a hung transfer would hold the unit
# open and the next night's dump would never start.
b2() { curl -sS --fail-with-body --connect-timeout 30 --max-time 600 "$@"; }
# What B2 said and nothing more: a transfer cut off partway through a good reply
# leaves a live token in the body, and the body goes to the journal.
b2_said() { jq -er 'select(.code) | "\(.status) \(.code): \(.message // "")"' <<< "$1" 2>/dev/null || echo "no answer B2 could have sent"; }

# Credentials reach curl on stdin, not as arguments, which every user on the
# box can read from the process list.
send() {
  local auth token api bucket target reply stored

  auth="$(printf 'Authorization: Basic %s\n' \
      "$(printf '%s:%s' "$B2_KEY_ID" "$B2_APPLICATION_KEY" | base64 | tr -d '\n')" \
    | b2 -H @- https://api.backblazeb2.com/b2api/v4/b2_authorize_account)" \
    || { echo "authorize: $(b2_said "$auth")"; return 1; }
  jq -e . <<< "$auth" >/dev/null 2>&1 || { echo "authorize answered with something other than JSON"; return 1; }

  # Checked on every run rather than trusted from the day the key was made:
  # a key that can also read or delete voids the reason for sending this here.
  jq -e --arg prefix "$PREFIX" '.apiInfo.storageApi.allowed
      | .capabilities == ["writeFiles"]
        and .namePrefix == $prefix
        and (.buckets | length) == 1' <<< "$auth" >/dev/null \
    || { echo "the key must hold writeFiles alone, on one bucket, under $PREFIX; it holds $(jq -c .apiInfo.storageApi.allowed <<< "$auth")"; return 2; }

  token="$(jq -r .authorizationToken <<< "$auth")"
  api="$(jq -r .apiInfo.storageApi.apiUrl <<< "$auth")"
  bucket="$(jq -r '.apiInfo.storageApi.allowed.buckets[0].id' <<< "$auth")"

  # A fresh upload URL on every attempt: B2 answers a busy or expired one with
  # a 503 or a 401 and expects the client to ask for another.
  target="$(printf 'Authorization: %s\n' "$token" \
    | b2 -H @- "$api/b2api/v4/b2_get_upload_url?bucketId=$bucket")" \
    || { echo "get upload url: $(b2_said "$target")"; return 1; }

  reply="$(printf 'Authorization: %s\nX-Bz-File-Name: %s\nContent-Type: application/octet-stream\nX-Bz-Content-Sha1: %s\n' \
      "$(jq -r .authorizationToken <<< "$target")" "$name" "$sha1" \
    | b2 -H @- --data-binary @"$sealed" "$(jq -r .uploadUrl <<< "$target")")" \
    || { echo "upload: $(b2_said "$reply")"; return 1; }

  stored="$(jq -r .contentSha1 <<< "$reply" 2>/dev/null)"
  [ "$stored" = "$sha1" ] \
    || { echo "upload answered with SHA-1 ${stored:-none}, not the $sha1 that was sent"; return 1; }
  echo "sent $name ($(du -h "$sealed" | cut -f1)) as $(jq -r .fileId <<< "$reply")"
}

for attempt in 1 2 3; do
  status=0
  out="$(send)" || status=$?
  [ "$status" -eq 0 ] && { echo "$out"; exit 0; }
  echo "attempt $attempt: $out" >&2
  # A key with the wrong reach is not going to change between attempts.
  [ "$status" -eq 2 ] && exit 1
  [ "$attempt" -lt 3 ] && sleep $((attempt * 15))
done
exit 1
