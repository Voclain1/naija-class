#!/usr/bin/env bash
# Fictional-data tests for infra/vps/backup_env.py. Asserts verdicts AND that no value leaks.
set -u
py=$(dirname "$0")/../infra/vps/ops-tools/backup_env.py; t=$(mktemp -d); trap 'rm -rf "$t"' EXIT; fail=0
SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
good() { cat <<EOF
BACKUP_BUCKET=fixture-bucket
WALG_S3_PREFIX=s3://fixture-bucket/wal
AWS_ACCESS_KEY_ID=0123456789abcdef0123456789abcdef
AWS_SECRET_ACCESS_KEY=$SECRET
AWS_ENDPOINT=https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com
AWS_REGION=auto
HEALTHCHECK_PING_URL=https://hc-ping.com/00000000-0000-4000-8000-000000000000
EOF
}
expect() { # label want-exit file... (cmd)
  local label=$1 want=$2; shift 2
  out=$(python3 "$py" "$@" 2>&1); rc=$?
  if { [ "$want" = 0 ] && [ $rc = 0 ]; } || { [ "$want" != 0 ] && [ $rc != 0 ]; }; then echo "PASS $label"; else echo "FAIL $label (rc=$rc)"; echo "$out"; fail=1; fi
  if grep -q "$SECRET\|0000-4000\|fixture-bucket" <<<"$out"; then echo "FAIL $label: output leaks a value"; fail=1; fi
  if grep -Eq 'length|sha256|[0-9a-f]{12}' <<<"$out"; then echo "FAIL $label: output carries a length or hash-like string"; fail=1; fi
}
good > $t/ok; expect "complete valid file passes" 0 validate $t/ok
grep -v '^AWS_REGION=' $t/ok > $t/x; expect "missing AWS_REGION is blocked" 1 validate $t/x
sed 's/^AWS_REGION=.*/AWS_REGION=/' $t/ok > $t/x; expect "empty AWS_REGION is blocked" 1 validate $t/x
sed 's/^AWS_REGION=.*/AWS_REGION=us-east-1/' $t/ok > $t/x; expect "wrong R2 region is blocked" 1 validate $t/x
(cat $t/ok; echo "AWS_REGION=auto") > $t/x; expect "duplicate key is blocked" 1 validate $t/x
sed 's/^HEALTHCHECK_PING_URL=.*/HEALTHCHECK_PING_URL=/' $t/ok > $t/x; expect "empty heartbeat URL is blocked" 1 validate $t/x
sed 's#^AWS_ENDPOINT=.*#AWS_ENDPOINT=http://example.com#' $t/ok > $t/x; expect "non-R2 endpoint is blocked" 1 validate $t/x
sed 's#^WALG_S3_PREFIX=.*#WALG_S3_PREFIX=s3://other/wal#' $t/ok > $t/x; expect "prefix naming another bucket is blocked" 1 validate $t/x
sed 's/^BACKUP_BUCKET=.*/BACKUP_BUCKET="fixture-bucket"/' $t/ok > $t/x; expect "quoted value is blocked" 1 validate $t/x
printf '' > $t/x; expect "empty file is blocked" 1 validate $t/x
cp $t/ok $t/same; expect "identical files pass compare" 0 compare $t/ok $t/same
sed 's/^AWS_ACCESS_KEY_ID=.*/AWS_ACCESS_KEY_ID=ffffffffffffffffffffffffffffffff/' $t/ok > $t/diff; expect "different value blocks compare" 1 compare $t/ok $t/diff
(cat $t/ok; echo "EXTRA=1") > $t/extra; expect "key only on the VPS blocks compare" 1 compare $t/extra $t/ok
(cat $t/ok; echo "EXTRA=1") > $t/extra; expect "key only in GitHub blocks compare" 1 compare $t/ok $t/extra
grep -v '^AWS_REGION=' $t/ok > $t/noreg; expect "GitHub secret missing a required key blocks compare" 1 compare $t/ok $t/noreg
expect "GitHub secret that is empty blocks compare" 1 compare $t/ok /dev/null
[ $fail = 0 ] && echo "ALL BACKUP-ENV TESTS PASSED" || { echo "BACKUP-ENV TEST FAILURES"; exit 1; }
