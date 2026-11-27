#!/bin/sh
# Nightly, two independent copies:
#   1. pg_dump of the whole database — the simple restore, kept 14 days daily
#      and 8 weeks on Sundays;
#   2. a WAL-G base backup — with the WAL archived continuously by Postgres,
#      it can be rolled forward to any minute. Keeps the last 7.
# HEALTHCHECK_PING_URL (optional) is pinged only when both succeed, so a
# backup that stops running is noticed rather than discovered.
set -eu
. /ops/env.sh
[ -n "${BACKUP_BUCKET:-}" ] || { echo "backup: BACKUP_BUCKET not set, nothing to do"; exit 1; }

umask 077
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
file="$scratch/school-kit-${stamp}.dump"
echo "$(date -u +%FT%TZ) dump started"
pg_dump -Fc -f "$file"
size=$(wc -c < "$file")
[ "$size" -gt 1024 ] || { echo "dump is only ${size} bytes; refusing to upload"; exit 1; }
pg_restore --list "$file" >/dev/null
digest=$(sha256sum "$file")
digest=${digest%% *}
printf '%s  %s\n' "$digest" "$(basename "$file")" > "$file.sha256"

publish() {
  remote="backup:${BACKUP_BUCKET}/dumps/$1/$(basename "$file")"
  rclone copyto "$file" "$remote"
  # A completion marker is written only after reading the object back.
  rclone copyto "$remote" "$scratch/readback"
  actual=$(sha256sum "$scratch/readback")
  [ "${actual%% *}" = "$digest" ] || { echo "off-site dump checksum mismatch"; return 1; }
  rclone copyto "$file.sha256" "$remote.sha256"
}
publish daily
[ "$(date -u +%u)" != "7" ] || publish weekly
# Pair-wise retention. A dump is VALID only with its checksum marker, so each
# pair is removed marker-first (a dump without a marker is never mistaken for a
# backup, and a marker never outlives its dump). Pairs are judged by the UTC
# stamp in their name, not by object age. Never touches other prefixes or
# unrecognised names, and always keeps the newest KEEP_MIN complete pairs, so a
# long outage of the nightly job can never prune the last good backups.
KEEP_MIN=3
prune() { # folder days
  folder="backup:${BACKUP_BUCKET}/dumps/$1"
  list="$scratch/list.$1"
  rc=0; rclone lsf --files-only "$folder" > "$list" || rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq 3 ] || { echo "prune $1: listing failed (rclone exit $rc)"; return 1; }
  [ "$rc" -eq 0 ] || : > "$list"   # exit 3 = folder not created yet
  cutoff=$(date -u -d "$2 days ago" +%Y%m%d%H%M%S)
  norm() { n=${1#school-kit-}; n=${n%%.*}; n=$(printf '%s' "$n" | tr -d 'TZ-'); [ ${#n} -eq 12 ] && n="${n}00"; printf '%s' "$n"; }
  # complete pairs, newest first
  pairs="$scratch/pairs.$1"
  grep -E '^school-kit-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4,6}Z[.]dump[.]sha256$' "$list" | sort -r | while read -r m; do
    if grep -qxF "${m%.sha256}" "$list"; then echo "$m"; fi
  done > "$pairs"
  keep=$(head -n "$KEEP_MIN" "$pairs")
  # reverse order: for one stamp "X.dump.sha256" sorts before "X.dump", so the
  # marker is removed first
  grep -E '^school-kit-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4,6}Z[.]dump([.]sha256)?$' "$list" | sort -r | while read -r f; do
    [ "$(norm "$f")" -lt "$cutoff" ] || continue
    case "$f" in *.sha256) m=$f;; *) m=$f.sha256;; esac
    if printf '%s\n' "$keep" | grep -qxF "$m"; then continue; fi
    rclone deletefile "$folder/$f"
  done
}
prune daily 15
prune weekly 57
echo "$(date -u +%FT%TZ) dump ok: $(basename "$file"), ${size} bytes"

if [ -n "${WALG_S3_PREFIX:-}" ]; then
  wal-g backup-push "$PGDATA"
  wal-g delete retain FULL 7 --confirm
  echo "$(date -u +%FT%TZ) base backup ok"
fi

[ -z "${HEALTHCHECK_PING_URL:-}" ] || curl -fsS -m 10 -o /dev/null "$HEALTHCHECK_PING_URL"
