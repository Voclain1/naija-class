#!/bin/sh
# Restores the newest nightly dump into a scratch database and compares row
# counts with the live one (db-restore-test.yml, monthly). Also lists the
# WAL-G base backups, so a broken WAL archive shows up here too.
set -eu
. /ops/env.sh
latest=$(rclone lsf "backup:${BACKUP_BUCKET}/dumps/daily" | grep -E '^school-kit-[0-9TZ:-]+[.]dump[.]sha256$' | sort | tail -1)
[ -n "$latest" ] || { echo "no dumps found"; exit 1; }
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
dump=${latest%.sha256}
echo "restoring $dump"
rclone copyto "backup:${BACKUP_BUCKET}/dumps/daily/$dump" "$scratch/$dump"
rclone copyto "backup:${BACKUP_BUCKET}/dumps/daily/$latest" "$scratch/$latest"
expected=$(cut -d ' ' -f 1 "$scratch/$latest")
actual=$(sha256sum "$scratch/$dump")
[ "${actual%% *}" = "$expected" ] || { echo "off-site dump checksum mismatch"; exit 1; }
dropdb --if-exists restore_test
createdb restore_test
trap 'rm -rf "$scratch"; dropdb --if-exists restore_test' EXIT
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges -d restore_test "$scratch/$dump"

status=0
for table in schools users students invoices payments; do
  live=$(psql -tAc "SELECT count(*) FROM $table")
  restored=$(psql -d restore_test -tAc "SELECT count(*) FROM $table")
  echo "$table: live=$live restored=$restored"
  if [ "$live" -gt 0 ] && [ "$restored" -eq 0 ]; then status=1; fi
done
if [ -n "${WALG_S3_PREFIX:-}" ]; then
  echo "WAL-G base backups:"; wal-g backup-list --json | grep -q '"backup_name"' || status=1
fi
exit $status
