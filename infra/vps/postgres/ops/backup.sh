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
prune() { # a folder not created yet is not an error
  if rclone lsf "backup:${BACKUP_BUCKET}/dumps/$1" >/dev/null 2>&1; then
    rclone delete --min-age "$2" "backup:${BACKUP_BUCKET}/dumps/$1"
  fi
}
prune daily 15d
prune weekly 57d
echo "$(date -u +%FT%TZ) dump ok: $(basename "$file"), ${size} bytes"

if [ -n "${WALG_S3_PREFIX:-}" ]; then
  wal-g backup-push "$PGDATA"
  wal-g delete retain FULL 7 --confirm
  echo "$(date -u +%FT%TZ) base backup ok"
fi

[ -z "${HEALTHCHECK_PING_URL:-}" ] || curl -fsS -m 10 -o /dev/null "$HEALTHCHECK_PING_URL"
