#!/usr/bin/env bash
# Proves the off-box copy restores, starting from only what outlives the box:
# a key that can read the bucket and the owner's age identity.
#
#   AGE_IDENTITY=<(…the identity, from the password manager…) scripts/offsite-drill.sh
#
# with B2_KEY_ID and B2_APPLICATION_KEY already exported, from the password
# manager rather than typed on the command line, where they would stay in the
# shell's history.
#
# From the laptop, never the box: the identity is the one thing that must not
# be there. The read key is the laptop's own too — listFiles and readFiles on
# the bucket under engram/, plus readFileRetentions to see the lock.
#
# It fetches the newest copy B2 holds, checks it against the SHA-1 B2 recorded,
# decrypts it here, and restores it into a scratch database on the box through
# restore-drill.sh, which checks every table that holds the record against
# what the copy itself holds.

set -euo pipefail

HOST="${ENGRAM_DEPLOY_HOST:-vyoh}"
PREFIX="engram/"
: "${B2_KEY_ID:?}" "${B2_APPLICATION_KEY:?}" "${AGE_IDENTITY:?}"
# -r rather than -f: a process substitution is a readable pipe, not a file.
[ -r "$AGE_IDENTITY" ] || { echo "no identity at $AGE_IDENTITY" >&2; exit 1; }

for tool in age curl jq shasum base64 gzip ssh; do
  command -v "$tool" >/dev/null || { echo "$tool is not installed" >&2; exit 1; }
done

work="$(mktemp -d)"
# The decrypted dump is the whole history; it leaves this machine only for the
# box's scratch database.
trap 'rm -rf "$work"' EXIT

b2() { curl -sS --fail-with-body --connect-timeout 30 --max-time 600 "$@"; }

auth="$(printf 'Authorization: Basic %s\n' \
    "$(printf '%s:%s' "$B2_KEY_ID" "$B2_APPLICATION_KEY" | base64 | tr -d '\n')" \
  | b2 -H @- https://api.backblazeb2.com/b2api/v4/b2_authorize_account)" \
  || { echo "authorize: $auth" >&2; exit 1; }

token="$(jq -r .authorizationToken <<< "$auth")"
api="$(jq -r .apiInfo.storageApi.apiUrl <<< "$auth")"
download="$(jq -r .apiInfo.storageApi.downloadUrl <<< "$auth")"
jq -e '.apiInfo.storageApi.allowed.buckets | length == 1' <<< "$auth" >/dev/null \
  || { echo "the key must be restricted to the one bucket" >&2; exit 1; }
bucket_id="$(jq -r '.apiInfo.storageApi.allowed.buckets[0].id' <<< "$auth")"
bucket_name="$(jq -r '.apiInfo.storageApi.allowed.buckets[0].name' <<< "$auth")"
can_see_lock="$(jq -r '.apiInfo.storageApi.allowed.capabilities | index("readFileRetentions") != null' <<< "$auth")"

listing="$(printf 'Authorization: %s\n' "$token" \
  | b2 -H @- "$api/b2api/v4/b2_list_file_names?bucketId=$bucket_id&prefix=$PREFIX&maxFileCount=1000")" \
  || { echo "list: $listing" >&2; exit 1; }
# Retention keeps about thirty. A full page means the bucket is not pruning.
jq -e '.nextFileName == null' <<< "$listing" >/dev/null \
  || { echo "more than 1000 copies under $PREFIX — is the lifecycle rule set?" >&2; exit 1; }

copies="$(jq '[.files[] | select(.action == "upload")]' <<< "$listing")"
[ "$(jq length <<< "$copies")" -gt 0 ] || { echo "no copies under $PREFIX in $bucket_name" >&2; exit 1; }
newest="$(jq 'max_by(.uploadTimestamp)' <<< "$copies")"
name="$(jq -r .fileName <<< "$newest")"
[[ "$name" =~ ^engram/engram-[0-9T:-]+Z\.sql\.gz\.age$ ]] || { echo "unexpected name $name" >&2; exit 1; }

now="$(date +%s)"
age_hours=$(( (now - $(jq '.uploadTimestamp / 1000 | floor' <<< "$newest")) / 3600 ))
oldest_days=$(( (now - $(jq 'min_by(.uploadTimestamp).uploadTimestamp / 1000 | floor' <<< "$copies")) / 86400 ))
echo "$(jq length <<< "$copies") copies under $PREFIX, the oldest $oldest_days days old"
echo "newest: $name, uploaded ${age_hours}h ago"
# The timer fires at midnight plus up to 45 minutes.
[ "$age_hours" -le 26 ] || echo "  more than a day old — has the nightly upload been failing?"

printf 'Authorization: %s\n' "$token" \
  | b2 -H @- -D "$work/headers" -o "$work/sealed" "$download/file/$bucket_name/$name" \
  || { echo "download: $(< "$work/sealed")" >&2; exit 1; }
[ "$(shasum -a 1 "$work/sealed" | cut -d' ' -f1)" = "$(jq -r .contentSha1 <<< "$newest")" ] \
  || { echo "the download does not match the SHA-1 B2 recorded for it" >&2; exit 1; }

header() { tr -d '\r' < "$work/headers" | awk -F': ' -v h="$1" 'tolower($1) == h { print $2 }'; }
if [ "$can_see_lock" != true ]; then
  echo "lock: unknown, this key has no readFileRetentions"
elif [ -n "$(header x-bz-file-retention-mode)" ]; then
  until_s=$(( $(header x-bz-file-retention-retain-until-timestamp) / 1000 ))
  echo "lock: $(header x-bz-file-retention-mode) until $(date -u -r "$until_s" +%Y-%m-%dT%H:%MZ 2>/dev/null || date -u -d "@$until_s" +%Y-%m-%dT%H:%MZ)"
else
  echo "lock: none — nothing stops the box's key from hiding this copy into deletion"
fi

age -d -i "$AGE_IDENTITY" -o "$work/dump.sql.gz" "$work/sealed"
gzip -t "$work/dump.sql.gz"
echo "decrypted with $AGE_IDENTITY"
echo

# Restored on the box, whose Postgres is the version the dump came from, into
# a scratch database restore-drill.sh drops again. The plaintext copy lands
# beside the box's own dumps and is removed however the drill ends.
read -r -d '' remote <<'EOF' || true
f="$(mktemp /var/backups/engram/.drill-XXXXXX)" || exit 1
trap 'rm -f "$f"' EXIT
cat > "$f" && /srv/engram/restore-drill.sh "$f"
EOF
ssh "$HOST" "$remote" < "$work/dump.sql.gz"
