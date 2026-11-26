#!/usr/bin/env bash
# Batch 2 acceptance: retention and heartbeat gating, on ISOLATED FIXTURES ONLY.
# Needs rclone (any recent version; the image pins v1.76.0). Touches no
# production system, no network, no real credentials. It runs the REAL `prune`
# function text extracted from infra/vps/postgres/ops/backup.sh, and the real
# backup.sh against stub tools, so a change to either is exercised.
#   bash scripts/batch2-retention-fixture.sh
set -Eeuo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
backup_sh="$here/infra/vps/postgres/ops/backup.sh"
command -v rclone >/dev/null || { echo "rclone is required"; exit 2; }
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
ago() { date -u -d "@$(( $(date +%s) - $1 ))" +%Y%m%d%H%M.%S; } # seconds ago

# ---- 1. dump retention -------------------------------------------------------
export RCLONE_CONFIG_BACKUP_TYPE=local
bucket="$work/bucket"; export BACKUP_BUCKET="$bucket"
mk() { # folder days-old [minutes-offset]
  local stamp; stamp=$(date -u -d "$2 days ago" +%Y-%m-%dT%H%M%SZ)
  mkdir -p "$bucket/dumps/$1"
  : > "$bucket/dumps/$1/school-kit-$stamp.dump"; : > "$bucket/dumps/$1/school-kit-$stamp.dump.sha256"
  touch -t "$(ago $(( $2 * 86400 )))" "$bucket/dumps/$1/school-kit-$stamp".dump*
}
for d in $(seq 0 20); do mk daily "$d"; done
for d in 0 7 14 21 28 35 42 49 56 63 70; do mk weekly "$d"; done
mkdir -p "$bucket/dumps/pre-batch3"; : > "$bucket/dumps/pre-batch3/old.dump"; touch -t "$(ago $(( 400 * 86400 )))" "$bucket/dumps/pre-batch3/old.dump"
# Boundary: dump just past 15d, its marker (written later) just inside it.
bs=$(date -u -d "@$(( $(date +%s) - 15*86400 - 300 ))" +%Y-%m-%dT%H%M%SZ)
: > "$bucket/dumps/daily/school-kit-$bs.dump"; : > "$bucket/dumps/daily/school-kit-$bs.dump.sha256"
touch -t "$(ago $(( 15*86400 + 300 )))" "$bucket/dumps/daily/school-kit-$bs.dump"
touch -t "$(ago $(( 15*86400 - 3600 )))" "$bucket/dumps/daily/school-kit-$bs.dump.sha256"

eval "$(sed -n '/^prune() {/,/^}/p' "$backup_sh")"
prune daily 15d; prune weekly 57d; prune never-created 15d
n() { find "$bucket/dumps/$1" -type f | wc -l; }
check "daily: nothing older than 15 days remains" '[ -z "$(find "$bucket/dumps/daily" -type f -mtime +15)" ]'
check "daily: files from the last 14 days all retained (14 pairs)" '[ "$(find "$bucket/dumps/daily" -type f -mtime -15 -name "*.dump" | wc -l)" -ge 14 ]'
check "daily: newest dump and its marker retained" 'ls "$bucket"/dumps/daily/school-kit-*.dump | tail -1 >/dev/null && [ -e "$(ls "$bucket"/dumps/daily/*.dump | sort | tail -1).sha256" ]'
check "weekly: 57-day cut (0..56 kept, 63 and 70 gone)" '[ "$(find "$bucket/dumps/weekly" -name "*.dump" | wc -l)" -eq 9 ]'
check "other prefixes (pre-batch3) are never pruned" '[ -e "$bucket/dumps/pre-batch3/old.dump" ]'
check "missing folder is not an error" 'true'
orph=0
for m in "$bucket"/dumps/daily/*.sha256; do [ -e "${m%.sha256}" ] || orph=$((orph+1)); done
echo "INFO orphan markers (marker kept, dump pruned) at the 15-day boundary: $orph (cosmetic; restore-test and verify-night select the NEWEST marker, which is never an orphan)"
for d in "$bucket"/dumps/daily/*.dump; do [ -e "$d.sha256" ] || { echo "FAIL dump without marker: $(basename "$d")"; fail=1; }; done

# ---- 2. heartbeat only after full success ---------------------------------
stub="$work/stub"; mkdir -p "$stub"
cat > "$stub/pg_dump" <<'S'
#!/bin/sh
[ "${STUB_TINY:-0}" = 1 ] && size=10 || size=4096
while [ $# -gt 0 ]; do [ "$1" = -f ] && out=$2; shift; done
head -c "$size" /dev/zero > "$out"
S
printf '#!/bin/sh\nexit 0\n' > "$stub/pg_restore"
cat > "$stub/rclone" <<'S'
#!/bin/sh
case "$1" in
  copyto) src=$2; dst=$3
    map() { case "$1" in backup:*) echo "$STUB_REMOTE/${1#backup:}";; *) echo "$1";; esac; }
    s=$(map "$src"); d=$(map "$dst"); mkdir -p "$(dirname "$d")"
    if [ "${STUB_CORRUPT:-0}" = 1 ] && [ "${src#backup:}" != "$src" ]; then echo corrupt > "$d"; else cp "$s" "$d"; fi ;;
  lsf) exit 0 ;;
  delete) exit 0 ;;
esac
S
printf '#!/bin/sh\n[ "${STUB_WALG_FAIL:-0}" = 1 ] && exit 1\nexit 0\n' > "$stub/wal-g"
printf '#!/bin/sh\necho "$@" >> "$STUB_PINGS"\n' > "$stub/curl"
chmod +x "$stub"/*
printf 'export BACKUP_BUCKET=fixture WALG_S3_PREFIX=s3://fixture/wal HEALTHCHECK_PING_URL=https://ping.invalid/FIXTURE PGDATA=/nonexistent\n' > "$work/env.sh"
sed "s#/ops/env.sh#$work/env.sh#" "$backup_sh" > "$work/backup.sh"
run() { # label expect-ping(0|1) env...
  local label=$1 expect=$2; shift 2
  : > "$work/pings"; rm -rf "$work/remote"
  local rc=0
  env PATH="$stub:$PATH" STUB_REMOTE="$work/remote" STUB_PINGS="$work/pings" "$@" bash "$work/backup.sh" >"$work/last.log" 2>&1 || rc=$?; [ -z "${FIXTURE_DEBUG:-}" ] || { echo "--- $label rc=$rc"; tail -5 "$work/last.log"; }
  local pings; pings=$(wc -l < "$work/pings")
  if [ "$expect" = 1 ]; then check "$label: exit 0 and exactly one heartbeat" '[ "$rc" = 0 ] && [ "$pings" = 1 ]'
  else check "$label: non-zero exit and NO heartbeat" '[ "$rc" != 0 ] && [ "$pings" = 0 ]'; fi
}
run "all steps succeed" 1
run "WAL-G base backup fails" 0 STUB_WALG_FAIL=1
run "off-site read-back checksum mismatch" 0 STUB_CORRUPT=1
run "dump implausibly small" 0 STUB_TINY=1

: > "$work/pings"; rm -rf "$work/remote"
env PATH="$stub:$PATH" STUB_REMOTE="$work/remote" STUB_PINGS="$work/pings" bash "$work/backup.sh" >/dev/null 2>&1
check "success run published dump + .sha256 pair" '[ "$(ls "$work"/remote/fixture/dumps/daily/*.dump | wc -l)" = 1 ] && [ "$(ls "$work"/remote/fixture/dumps/daily/*.sha256 | wc -l)" = 1 ]'

[ "$fail" = 0 ] && echo "ALL FIXTURE CHECKS PASSED (isolated; says nothing about production)" || { echo "FIXTURE FAILURES"; exit 1; }
