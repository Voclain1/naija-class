#!/bin/sh
# Restores the newest nightly dump into a scratch database and compares row
# counts with the live one (db-restore-test.yml, monthly). Also lists the
# WAL-G base backups, so a broken WAL archive shows up here too.
set -eu
. /ops/env.sh
latest=$(rclone lsf "backup:${BACKUP_BUCKET}/dumps/daily" | sort | tail -1)
[ -n "$latest" ] || { echo "no dumps found"; exit 1; }
echo "restoring $latest"
rclone copyto "backup:${BACKUP_BUCKET}/dumps/daily/${latest}" /tmp/restore.dump
trap 'rm -f /tmp/restore.dump; dropdb --if-exists restore_test' EXIT
dropdb --if-exists restore_test
createdb restore_test
pg_restore --no-owner --no-privileges -d restore_test /tmp/restore.dump

status=0
for table in schools users students invoices payments; do
  live=$(psql -tAc "SELECT count(*) FROM $table")
  restored=$(psql -d restore_test -tAc "SELECT count(*) FROM $table")
  echo "$table: live=$live restored=$restored"
  if [ "$live" -gt 0 ] && [ "$restored" -eq 0 ]; then status=1; fi
done
if [ -n "${WALG_S3_PREFIX:-}" ]; then
  echo "WAL-G base backups:"; wal-g backup-list || status=1
fi
exit $status
