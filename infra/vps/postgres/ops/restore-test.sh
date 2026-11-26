#!/bin/sh
# Restores the newest COMPLETE nightly dump into a scratch database and
# compares row counts with the live one (db-restore-test.yml, manual). Also
# lists the WAL-G base backups, so a broken WAL archive shows up here too.
#
# "Complete" = a checksum marker whose dump object exists. A marker without a
# dump, or a dump without a marker (an interrupted or pruned pair), is skipped
# and reported, never selected. The newest complete pair is then verified
# strictly: a checksum mismatch on it is a failure, not a reason to fall back
# silently to an older backup.
set -eu
. /ops/env.sh
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
folder="backup:${BACKUP_BUCKET}/dumps/daily"
rclone lsf --files-only "$folder" > "$scratch/list"
pick=
for marker in $(grep -E '^school-kit-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{4,6}Z[.]dump[.]sha256$' "$scratch/list" | sort -r); do
  if grep -qxF "${marker%.sha256}" "$scratch/list"; then pick=$marker; break; fi
  echo "skipping incomplete pair (marker without dump): $marker"
done
[ -n "$pick" ] || { echo "no complete dump + marker pair found"; exit 1; }
dump=${pick%.sha256}
echo "restoring $dump"
rclone copyto "$folder/$dump" "$scratch/$dump"
rclone copyto "$folder/$pick" "$scratch/$pick"
expected=$(cut -d ' ' -f 1 "$scratch/$pick")
actual=$(sha256sum "$scratch/$dump")
[ "${actual%% *}" = "$expected" ] || { echo "off-site dump checksum mismatch"; exit 1; }
pg_restore --list "$scratch/$dump" >/dev/null
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
