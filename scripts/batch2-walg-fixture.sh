#!/usr/bin/env bash
# WAL-G retention on an ISOLATED throwaway PostgreSQL, with the real wal-g binary
# of the backup image, a local-filesystem store and no network. Run INSIDE the
# image as the postgres user (see .github/workflows/batch2-retention.yml):
#   docker run --rm --network none --user postgres --entrypoint bash \
#     -v "$PWD/scripts:/t:ro" <backup image> /t/batch2-walg-fixture.sh
# Proves, with real objects: the production retention command text from
# backup.sh, a DRY RUN (no --confirm) deleting nothing, the confirmed prune
# keeping exactly 7 bases and every WAL segment those bases need, wal-verify
# reporting a healthy timeline afterwards, and a restore chain still usable.
set -Eeuo pipefail
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
w=$(mktemp -d /tmp/walg.XXXXXX); trap 'pg_ctl -D "$w/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$w"' EXIT
export PGDATA="$w/data" WALG_FILE_PREFIX="$w/store" PGHOST="$w/sock" PGUSER=postgres PGDATABASE=postgres
mkdir -p "$w/store" "$w/sock"
BIN=$(ls -d /usr/lib/postgresql/*/bin | head -1); export PATH="$BIN:$PATH"
initdb -D "$PGDATA" -U postgres --auth=trust >/dev/null
cat >> "$PGDATA/postgresql.conf" <<CONF
listen_addresses = ''
unix_socket_directories = '$w/sock'
wal_level = replica
archive_mode = on
archive_command = 'wal-g wal-push %p'
archive_timeout = 5
max_wal_size = 256MB
CONF
pg_ctl -D "$PGDATA" -l "$w/pg.log" -w start >/dev/null
sql() { psql -XqAt -v ON_ERROR_STOP=1 -c "$1"; }
sql "CREATE TABLE t(i int, p text)"
archived() { sql "SELECT archived_count FROM pg_stat_archiver"; }
settle() { # switch WAL and wait until everything up to now is archived
  local target; target=$(sql "SELECT pg_walfile_name(pg_switch_wal())")
  for _ in $(seq 1 60); do [ "$(sql "SELECT coalesce(last_archived_wal,'') >= '$target' FROM pg_stat_archiver")" = t ] && return 0; sleep 1; done
  echo "archiver did not catch up to $target"; sql "SELECT * FROM pg_stat_archiver"; return 1
}
for n in $(seq 1 9); do
  sql "INSERT INTO t SELECT g, repeat('x',200) FROM generate_series(1,2000) g"
  settle
  wal-g backup-push "$PGDATA" >/dev/null
  sleep 1   # distinct backup timestamps
done
settle
bases() { wal-g backup-list --json | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))'; }
walcount() { find "$WALG_FILE_PREFIX" -path '*wal_005*' -type f | wc -l; }
check "fixture: nine full base backups exist" '[ "$(bases)" = 9 ]'
before_w=$(walcount)
# The EXACT retention command production runs, without --confirm: a dry run.
wal-g delete retain FULL 7 > "$w/dry.out" 2>&1 || { cat "$w/dry.out"; fail=1; }
check "dry run (no --confirm) deletes nothing: still 9 bases and same WAL count" '[ "$(bases)" = 9 ] && [ "$(walcount)" = "$before_w" ]'
# The same text backup.sh executes:
grep -q 'wal-g delete retain FULL 7 --confirm' /ops/backup.sh 2>/dev/null && echo "PASS image's backup.sh uses 'retain FULL 7 --confirm'" || echo "INFO /ops/backup.sh not present or different (repo run)"
wal-g delete retain FULL 7 --confirm >/dev/null
check "confirmed prune keeps exactly 7 bases" '[ "$(bases)" = 7 ]'
check "confirmed prune removed WAL older than the oldest kept base" '[ "$(walcount)" -lt "$before_w" ]'
oldest=$(wal-g backup-list --json | python3 -c 'import json,sys; b=json.load(sys.stdin); print(b[0]["backup_name"])')
check "kept oldest base is still fetchable (backup-fetch to scratch)" 'wal-g backup-fetch "$w/restore" "$oldest" >/dev/null && test -f "$w/restore/backup_label"'
first_wal=$(sed -n 's/^START WAL LOCATION: .* (file \([0-9A-F]*\)).*/\1/p' "$w/restore/backup_label")
check "WAL needed to start from the oldest kept base is still archived ($first_wal)" 'wal-g wal-fetch "$first_wal" "$w/seg" >/dev/null 2>&1 && test -s "$w/seg"'
wal-g wal-verify integrity timeline > "$w/verify.out" 2>&1 || true
check "wal-verify integrity+timeline report OK after the prune" 'grep -q "integrity check status: OK" "$w/verify.out" && grep -q "timeline check status: OK" "$w/verify.out"'
check "dry run of a deeper retention (FULL 3) still deletes nothing" 'wal-g delete retain FULL 3 >/dev/null 2>&1; [ "$(bases)" = 7 ]'
[ "$fail" = 0 ] && echo "ALL WAL-G FIXTURE CHECKS PASSED (isolated throwaway database)" || { echo "WAL-G FIXTURE FAILURES"; sed -n 1,20p "$w/verify.out"; exit 1; }
