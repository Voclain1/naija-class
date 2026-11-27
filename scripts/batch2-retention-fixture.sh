#!/usr/bin/env bash
# Batch 2 acceptance: dump retention, marker/dump pairing, restore selection and
# heartbeat gating, on ISOLATED FIXTURES ONLY (local rclone backend, stub
# database tools, no network, no credentials).
#
#   bash scripts/batch2-retention-fixture.sh                 # repo scripts, local rclone
#   OPS_DIR=/ops bash scripts/batch2-retention-fixture.sh    # the scripts INSIDE an image
#
# Run by .github/workflows/batch2-retention.yml inside (a) the pinned PRODUCTION
# backup image (MODE=legacy: documents what production does today) and (b) the
# freshly built image (MODE=pairwise: the corrected behaviour).
set -Eeuo pipefail
here=$(cd "$(dirname "$0")/.." && pwd)
OPS_DIR=${OPS_DIR:-$here/infra/vps/postgres/ops}
MODE=${MODE:-auto}
backup_sh="$OPS_DIR/backup.sh"; restore_sh="$OPS_DIR/restore-test.sh"
command -v rclone >/dev/null || { echo "rclone is required"; exit 2; }
real_rclone=$(command -v rclone)
[ "$MODE" != auto ] || { grep -q '^KEEP_MIN=' "$backup_sh" && MODE=pairwise || MODE=legacy; }
echo "INFO scripts: $OPS_DIR  mode: $MODE  $(rclone version | head -1)"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
secs_ago() { date -u -d "@$(( $(date +%s) - $1 ))" "$2"; }
export RCLONE_CONFIG_BACKUP_TYPE=local

# $1 bucket $2 folder $3 age-seconds [$4 minutes: also write the marker]
mkpair() {
  local stamp; stamp=$(secs_ago "$3" +%Y-%m-%dT%H%M%SZ)
  mkdir -p "$1/dumps/$2"
  : > "$1/dumps/$2/school-kit-$stamp.dump"
  [ "${4:-marker}" = nomarker ] || echo "00  school-kit-$stamp.dump" > "$1/dumps/$2/school-kit-$stamp.dump.sha256"
  touch -d "@$(( $(date +%s) - $3 ))" "$1/dumps/$2/school-kit-$stamp".dump*   # age by mtime too (production's legacy prune reads it)
  echo "$stamp"
}
mkmarker_only() { local stamp; stamp=$(secs_ago "$2" +%Y-%m-%dT%H%M%SZ); mkdir -p "$1/dumps/daily"; echo "00" > "$1/dumps/daily/school-kit-$stamp.dump.sha256"; touch -d "@$(( $(date +%s) - $2 ))" "$1/dumps/daily/school-kit-$stamp.dump.sha256"; echo "$stamp"; }
DAY=86400

# ---- 1. retention ------------------------------------------------------------
extract_prune() {
  if [ "$MODE" = pairwise ]; then
    awk '/^KEEP_MIN=/{p=1} p{print} p&&/^}/{exit}' "$backup_sh"
  else
    sed -n '/^prune() {/,/^}/p' "$backup_sh"
  fi
}
run_prune() { # bucket
  ( export BACKUP_BUCKET="$1" scratch; scratch=$(mktemp -d)
    eval "$(extract_prune)"
    if [ "$MODE" = pairwise ]; then prune daily 15; prune weekly 57; prune never-created 15
    else prune daily 15d; prune weekly 57d; prune never-created 15d; fi
    rm -rf "$scratch" )
}
b="$work/b1"
for d in $(seq 0 20); do mkpair "$b" daily $((d*DAY+600)) >/dev/null; done
for d in 0 7 14 21 28 35 42 49 56 63 70; do mkpair "$b" weekly $((d*DAY+600)) >/dev/null; done
mkdir -p "$b/dumps/pre-batch3"; : > "$b/dumps/pre-batch3/old.dump"; touch -d '400 days ago' "$b/dumps/pre-batch3/old.dump"
: > "$b/dumps/daily/notes.txt"; : > "$b/dumps/daily/school-kit-latest.dump"
# Boundary pair: dump written minutes before the marker, straddling the cutoff.
bs=$(secs_ago $((15*DAY+300)) +%Y-%m-%dT%H%M%SZ)
: > "$b/dumps/daily/school-kit-$bs.dump"; echo 00 > "$b/dumps/daily/school-kit-$bs.dump.sha256"
touch -d '15 days ago 5 minutes ago' "$b/dumps/daily/school-kit-$bs.dump"
touch -d '14 days 23 hours ago' "$b/dumps/daily/school-kit-$bs.dump.sha256"
# Old orphans: a marker whose dump is gone, a dump that never got its marker.
mkmarker_only "$b" $((30*DAY)) >/dev/null; mkpair "$b" daily $((31*DAY)) nomarker >/dev/null
run_prune "$b" 2>&1 | grep -v 'NOTICE: Config file' || true
cnt() { find "$b/dumps/$1" -type f -name "$2" | wc -l; }
check "daily: 14-15 newest days retained (>=15 dumps)" '[ "$(cnt daily "*.dump")" -ge 15 ]'
check "weekly: 57-day cut leaves 9 pairs" '[ "$(cnt weekly "*.dump")" -eq 9 ]'
check "pre-batch3 prefix never pruned" '[ -e "$b/dumps/pre-batch3/old.dump" ]'
check "unrecognised names never pruned" '[ -e "$b/dumps/daily/notes.txt" ] && [ -e "$b/dumps/daily/school-kit-latest.dump" ]'
orph_m=0; orph_d=0
for m in "$b"/dumps/*/*.sha256; do [ -e "${m%.sha256}" ] || orph_m=$((orph_m+1)); done
for d in "$b"/dumps/daily/school-kit-2*.dump "$b"/dumps/weekly/*.dump; do [ -e "$d.sha256" ] || orph_d=$((orph_d+1)); done
if [ "$MODE" = pairwise ]; then
  check "pairwise: no marker without a dump remains" '[ "$orph_m" = 0 ]'
  check "pairwise: no stamped dump without a marker remains (old orphans removed)" '[ "$orph_d" = 0 ]'
  check "pairwise: nothing older than 15 days remains" '[ -z "$(find "$b/dumps/daily" -name "school-kit-2*.dump" -mtime +16)" ] && ! ls "$b"/dumps/daily/ | grep -q "$bs"'
else
  echo "INFO legacy (production) prune: orphan markers=$orph_m orphan dumps=$orph_d (age-based; known boundary artefact)"
fi
# An outage must never prune the last good backups.
o="$work/outage"; for d in 30 31 32 33 34 35; do mkpair "$o" daily $((d*DAY)) >/dev/null; done
run_prune "$o" 2>&1 | grep -v 'NOTICE: Config file' || true
if [ "$MODE" = pairwise ]; then check "outage: newest 3 complete pairs kept although all are >15 days old" '[ "$(find "$o/dumps/daily" -name "*.dump" | wc -l)" = 3 ] && [ "$(find "$o/dumps/daily" -name "*.sha256" | wc -l)" = 3 ]'
else echo "INFO legacy: outage leaves $(find "$o/dumps/daily" -type f | wc -l) files (age-based prune can delete every backup)"; fi
if [ "$MODE" = pairwise ]; then
  ( mkdir -p "$work/s"; printf '#!/bin/sh\n[ "$1" = lsf ] && exit 5\nexit 0\n' > "$work/s/rclone"; chmod +x "$work/s/rclone"
    export PATH="$work/s:$PATH" BACKUP_BUCKET=x scratch; scratch=$(mktemp -d); eval "$(extract_prune)"; prune daily 15 ) >/dev/null 2>&1 \
    && { echo "FAIL a listing error (exit 5) must fail the prune"; fail=1; } || echo "PASS a listing error fails the prune (not swallowed)"
fi

# ---- 2. restore selection ------------------------------------------------------
stub="$work/stub"; mkdir -p "$stub"
printf '#!/bin/sh\nexit 0\n' > "$stub/pg_restore"
printf '#!/bin/sh\nexit 0\n' > "$stub/dropdb"; cp "$stub/dropdb" "$stub/createdb"
printf '#!/bin/sh\necho 1\n' > "$stub/psql"
printf '#!/bin/sh\necho "{\\"backup_name\\":\\"base_x\\"}"\n' > "$stub/wal-g"
chmod +x "$stub"/*
printf 'export BACKUP_BUCKET=%s PGDATABASE=x\n' "$work/rb" > "$work/env.sh"
sed "s#/ops/env.sh#$work/env.sh#" "$restore_sh" > "$work/restore.sh"
restore() { PATH="$stub:$PATH" sh "$work/restore.sh" 2>&1 | grep -v 'NOTICE: Config'; return "${PIPESTATUS[0]}"; }
mkfull() { # bucket folder-age-seconds stamp-out : create pair with CORRECT checksum
  local stamp; stamp=$(mkpair "$1" daily "$2" nomarker); local f="$1/dumps/daily/school-kit-$stamp.dump"
  echo "payload $stamp" > "$f"; ( cd "$1/dumps/daily" && sha256sum "school-kit-$stamp.dump" > "school-kit-$stamp.dump.sha256" ); echo "$stamp"
}
if [ "$MODE" = pairwise ]; then
  rm -rf "$work/rb"; good=$(mkfull "$work/rb" $((2*DAY))); mkmarker_only "$work/rb" 60 >/dev/null; mkpair "$work/rb" daily 30 nomarker >/dev/null
  out=$(restore) && rc=0 || rc=$?
  check "restore: newest marker without dump and newest dump without marker are skipped; newest COMPLETE pair restored" '[ "$rc" = 0 ] && grep -q "restoring school-kit-$good.dump" <<<"$out" && grep -q "skipping incomplete" <<<"$out"'
  rm -rf "$work/rb"; mkfull "$work/rb" $((2*DAY)) >/dev/null; bad=$(mkfull "$work/rb" 100); echo corrupted > "$work/rb/dumps/daily/school-kit-$bad.dump"
  restore >/dev/null && rc=0 || rc=$?
  check "restore: checksum mismatch on the newest complete pair FAILS (no silent fallback)" '[ "$rc" != 0 ]'
  rm -rf "$work/rb"; mkmarker_only "$work/rb" 100 >/dev/null
  restore >/dev/null && rc=0 || rc=$?
  check "restore: only incomplete pairs present => failure" '[ "$rc" != 0 ]'
fi

# ---- 3. heartbeat only after complete success ----------------------------------
hb="$work/hb"; mkdir -p "$hb"
cat > "$hb/pg_dump" <<'S'
#!/bin/sh
[ "${STUB_TINY:-0}" = 1 ] && size=10 || size=4096
while [ $# -gt 0 ]; do [ "$1" = -f ] && out=$2; shift; done
head -c "$size" /dev/zero > "$out"
S
printf '#!/bin/sh\nexit 0\n' > "$hb/pg_restore"
printf '#!/bin/sh\n[ "${STUB_WALG_FAIL:-0}" = 1 ] && exit 1\nexit 0\n' > "$hb/wal-g"
printf '#!/bin/sh\necho "$@" >> "$STUB_PINGS"\n' > "$hb/curl"
cat > "$hb/rclone" <<S
#!/bin/sh
# real rclone; only the read-back of a published object can be corrupted
if [ "\${STUB_CORRUPT:-0}" = 1 ] && [ "\$1" = copyto ] && [ "\${2#backup:}" != "\$2" ] && [ "\${3#backup:}" = "\$3" ]; then echo corrupt > "\$3"; exit 0; fi
exec $real_rclone "\$@"
S
chmod +x "$hb"/*
printf 'export BACKUP_BUCKET=%s WALG_S3_PREFIX=s3://fixture/wal HEALTHCHECK_PING_URL=https://ping.invalid/FIXTURE PGDATA=/nonexistent\n' "$work/hbbucket" > "$work/hbenv.sh"
sed "s#/ops/env.sh#$work/hbenv.sh#" "$backup_sh" > "$work/backup.sh"
run() { # label expect-ping env...
  local label=$1 expect=$2 rc=0; shift 2
  : > "$work/pings"; rm -rf "$work/hbbucket"
  env PATH="$hb:$PATH" STUB_PINGS="$work/pings" "$@" sh "$work/backup.sh" >"$work/last.log" 2>&1 || rc=$?
  local pings; pings=$(wc -l < "$work/pings")
  if [ "$expect" = 1 ]; then check "$label: exit 0 and exactly one heartbeat" '[ "$rc" = 0 ] && [ "$pings" = 1 ]'
  else check "$label: non-zero exit and NO heartbeat" '[ "$rc" != 0 ] && [ "$pings" = 0 ]'; fi
  [ "$rc" = 0 ] || [ "$expect" = 0 ] || tail -5 "$work/last.log"
}
run "all steps succeed" 1
check "success run published dump + marker pair" '[ "$(ls "$work"/hbbucket/dumps/daily/*.dump | wc -l)" = 1 ] && [ "$(ls "$work"/hbbucket/dumps/daily/*.sha256 | wc -l)" = 1 ]'
run "WAL-G base backup fails" 0 STUB_WALG_FAIL=1
run "off-site read-back checksum mismatch" 0 STUB_CORRUPT=1
run "dump implausibly small" 0 STUB_TINY=1

[ "$fail" = 0 ] && echo "ALL FIXTURE CHECKS PASSED (isolated fixtures; says nothing about production data)" || { echo "FIXTURE FAILURES"; exit 1; }
