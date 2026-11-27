#!/usr/bin/env bash
# Tests infra/vps/ops-tools/{guard,lib}.sh against a STUB docker and fictional files. No Docker,
# no network, no production. Proves: inspection failures fail closed, failed checks exit non-zero,
# rotation/re-pin roll back and fall back, the original ops container is never started, and no
# secret value reaches the output.
set -u
root=$(cd "$(dirname "$0")/.." && pwd); tools=$root/infra/vps/ops-tools
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fail=0
chk() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
IMG=ghcr.io/voclain1/school-kit-postgres@sha256:$(printf 'a%.0s' {1..64})
NEW=ghcr.io/voclain1/school-kit-postgres@sha256:$(printf 'b%.0s' {1..64})
SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
mkdir -p "$T/bin"
cat > "$T/bin/docker" <<'S'
#!/usr/bin/env bash
echo "docker $*" >> "$STATE/calls"
args=("$@")
if [ "$1" = compose ]; then
  for a in "${args[@]}"; do case $a in ps|config|up) sub=$a;; esac; done
  case $sub in
    config) exit 0 ;;
    up) n=$(cat "$STATE/fail_up" 2>/dev/null || echo 0); if [ "$n" -gt 0 ]; then echo $((n-1)) > "$STATE/fail_up"; exit 1; fi; exit 0 ;;
    ps) last=${args[$((${#args[@]}-1))]}
        case $last in postgres) echo pgid;; ops-pinned) [ -f "$STATE/no_pinned" ] || echo pinid;; ops) echo oldid;; esac; exit 0 ;;
  esac
fi
case $1 in
  top) [ -f "$STATE/top_fail" ] && exit 1; cat "$STATE/top.$2" 2>/dev/null || cat "$STATE/top"; exit 0 ;;
  inspect) f=$3; c=$4
    case $f in
      *StartedAt*) echo "$c 2026-11-26T01:00:00Z" ;;
      *State.Running*) [ "$c" = oldid ] && { [ -f "$STATE/old_running" ] && echo true || echo false; } || echo true ;;
      *RestartPolicy*) [ "$c" = oldid ] && echo no || echo unless-stopped ;;
      *Config.Image*) sed -n 's/^[[:space:]]*image:[[:space:]]*//p' "$SK_DIR/backup-ops.override.yml" ;;
    esac; exit 0 ;;
  exec) [ -f "$STATE/exec_fail" ] && exit 1; [ -f "$STATE/exec_missing" ] && cat "$STATE/exec_missing"; exit 0 ;;
  image|pull|run|stop|rm) exit 0 ;;
  start) exit 0 ;;
esac
exit 0
S
chmod +x "$T/bin/docker"
fresh() { # build a fictional install dir
  export STATE="$T/state" SK_DIR="$T/sk" PATH="$T/bin:$PATH" GUARD_NOW_HHMM=0900
  rm -rf "$STATE" "$SK_DIR"; mkdir -p "$STATE" "$SK_DIR"; cd "$SK_DIR" || exit 1
  : > deploy.env; echo "PG_MAJOR=18" >> deploy.env; : > docker-compose.yml
  cat > backup.env <<EOF
BACKUP_BUCKET=fixture-bucket
WALG_S3_PREFIX=s3://fixture-bucket/wal
AWS_ACCESS_KEY_ID=0123456789abcdef0123456789abcdef
AWS_SECRET_ACCESS_KEY=$SECRET
AWS_ENDPOINT=https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com
AWS_REGION=auto
HEALTHCHECK_PING_URL=https://hc-ping.com/00000000-0000-4000-8000-000000000000
EOF
  chmod 600 backup.env; cp backup.env "$T/backup.env.orig"
  printf 'services:\n  ops-pinned:\n    extends:\n      file: docker-compose.yml\n      service: ops\n    image: %s\n' "$IMG" > backup-ops.override.yml
  cp backup-ops.override.yml "$T/override.orig"
  echo "pgid 2026-11-26T01:00:00Z" > .batch2-postgres-identity
  printf 'PID COMMAND\n1 cron -f\n' > "$STATE/top"
  echo "VPS_MODE=live" >> deploy.env; echo '# rehearsal-only' > deploy.sh
}
g() { bash "$tools/guard.sh" "$@" 2>&1; }

fresh; out=$(g scheduler); rc=$?
chk "scheduler: healthy fixture exits 0" '[ $rc = 0 ]'
fresh; touch "$STATE/top_fail"; out=$(g scheduler); rc=$?
chk "scheduler: docker top failure FAILS CLOSED (non-zero, BLOCK reported)" '[ $rc != 0 ] && grep -q "docker top failed" <<<"$out"'
fresh; printf 'garbage\n' > "$STATE/top"; out=$(g scheduler); rc=$?
chk "scheduler: malformed docker top header fails closed" '[ $rc != 0 ]'
fresh; printf 'PID COMMAND\n' > "$STATE/top"; out=$(g scheduler); rc=$?
chk "scheduler: empty process listing fails closed" '[ $rc != 0 ]'
fresh; printf 'PID COMMAND\nabc cron -f\n' > "$STATE/top"; out=$(g scheduler); rc=$?
chk "scheduler: non-numeric pid row fails closed" '[ $rc != 0 ]'
fresh; printf 'PID COMMAND\n1 cron -f\n7 /usr/sbin/cron\n' > "$STATE/top"; out=$(g scheduler); rc=$?
chk "scheduler: two crons is a failure" '[ $rc != 0 ] && grep -q "cron count in ops-pinned is 2" <<<"$out"'
fresh; touch "$STATE/old_running"; out=$(g scheduler); rc=$?
chk "scheduler: running original ops is a failure" '[ $rc != 0 ] && grep -q "original ops is RUNNING" <<<"$out"'
fresh; echo "VPS_MODE=rehearsal" >> deploy.env; out=$(g scheduler); rc=$?
chk "scheduler: rehearsal mode on the production host is a failure" '[ $rc != 0 ]'
fresh; echo "pgid DIFFERENT" > .batch2-postgres-identity; out=$(g scheduler); rc=$?
chk "scheduler: changed PostgreSQL identity is a failure" '[ $rc != 0 ]'

fresh; out=$(g config); rc=$?
chk "config: valid file and complete container settings exit 0" '[ $rc = 0 ]'
fresh; sed -i '/^AWS_REGION=/d' backup.env; out=$(g config); rc=$?
chk "config: missing AWS_REGION fails" '[ $rc != 0 ] && grep -q "AWS_REGION" <<<"$out"'
fresh; echo "AWS_REGION=auto" >> backup.env; out=$(g config); rc=$?
chk "config: duplicate key fails" '[ $rc != 0 ]'
fresh; chmod 644 backup.env; out=$(g config); rc=$?
chk "config: wrong file mode fails" '[ $rc != 0 ]'
fresh; echo "AWS_ENDPOINT" > "$STATE/exec_missing"; out=$(g config); rc=$?
chk "config: a setting missing from a running container fails" '[ $rc != 0 ]'
chk "config: output never carries a secret, a length or a hash" '! grep -Eq "$SECRET|0000-4000|fixture-bucket|sha256|length=" <<<"$out"'

fresh; out=$(printf 'https://hc-ping.com/11111111-2222-4333-8444-555555555555\n' | g rotate-ping); rc=$?
chk "rotate: success exits 0, one recreate, new URL stored, other lines unchanged" '[ $rc = 0 ] && [ "$(grep -c " up " "$STATE/calls")" = 1 ] && grep -q "11111111-2222" backup.env && diff <(grep -v HEALTHCHECK backup.env) <(grep -v HEALTHCHECK "$T/backup.env.orig") >/dev/null'
chk "rotate: output does not echo the URL" '! grep -q "11111111-2222" <<<"$out"'
chk "rotate: the recreate names only ops-pinned, with --no-deps and no build/pull" 'grep " up " "$STATE/calls" | grep -q -- "--no-deps --no-build --pull never ops-pinned"'
chk "rotate: original ops was never started or removed" '! grep -Eq "docker (start|rm) |docker stop oldid" "$STATE/calls"'
fresh; echo 1 > "$STATE/fail_up"; out=$(printf 'https://hc-ping.com/11111111-2222-4333-8444-555555555555\n' | g rotate-ping); rc=$?
chk "rotate: recreate failure ROLLS BACK (non-zero, previous settings restored byte-for-byte, second recreate)" '[ $rc != 0 ] && cmp -s backup.env "$T/backup.env.orig" && [ "$(grep -c " up " "$STATE/calls")" = 2 ]'
chk "rotate: rollback keeps the original pinned image and never touches the original ops" 'cmp -s backup-ops.override.yml "$T/override.orig" && ! grep -Eq "docker (start|rm) " "$STATE/calls"'
fresh; echo 2 > "$STATE/fail_up"; out=$(printf 'https://hc-ping.com/11111111-2222-4333-8444-555555555555\n' | g rotate-ping); rc=$?
chk "rotate: rollback failure falls back to the verified local image" '[ $rc != 0 ] && grep -q "schoolkit-ops-fallback:batch2-verified" backup-ops.override.yml && cmp -s backup.env "$T/backup.env.orig" && [ "$(grep -c " up " "$STATE/calls")" = 3 ]'
fresh; echo 9 > "$STATE/fail_up"; out=$(printf 'https://hc-ping.com/11111111-2222-4333-8444-555555555555\n' | g rotate-ping); rc=$?
chk "rotate: total failure is reported as MANUAL ACTION and never starts the original ops" '[ $rc != 0 ] && grep -q "MANUAL ACTION" <<<"$out" && ! grep -Eq "docker (start|rm) " "$STATE/calls"'
fresh; out=$(printf 'https://example.com/x\n' | g rotate-ping); rc=$?
chk "rotate: a non-Healthchecks URL is rejected, nothing changed, no recreate" '[ $rc != 0 ] && cmp -s backup.env "$T/backup.env.orig" && ! grep -q " up " "$STATE/calls"'
fresh; export GUARD_NOW_HHMM=0130; out=$(printf 'https://hc-ping.com/11111111-2222-4333-8444-555555555555\n' | g rotate-ping); rc=$?
chk "rotate: refused inside the 01:00-02:30 UTC backup window" '[ $rc != 0 ] && grep -q "backup window" <<<"$out" && cmp -s backup.env "$T/backup.env.orig"'
fresh; printf 'PID COMMAND\n1 cron -f\n50 pg_dump -Fc -f x\n' > "$STATE/top"; out=$(printf 'https://hc-ping.com/11111111-2222-4333-8444-555555555555\n' | g rotate-ping); rc=$?
chk "rotate: refused while pg_dump is running" '[ $rc != 0 ] && cmp -s backup.env "$T/backup.env.orig"'
fresh; touch "$STATE/top_fail"; out=$(printf 'https://hc-ping.com/11111111-2222-4333-8444-555555555555\n' | g rotate-ping); rc=$?
chk "rotate: refused when process inspection fails (fail closed)" '[ $rc != 0 ] && cmp -s backup.env "$T/backup.env.orig"'

fresh; out=$(g repin-ops "ghcr.io/voclain1/school-kit-postgres:latest"); rc=$?
chk "repin: a mutable tag is rejected" '[ $rc != 0 ] && cmp -s backup-ops.override.yml "$T/override.orig"'
fresh; out=$(g repin-ops "$NEW"); rc=$?
chk "repin: success writes the new digest and recreates only ops-pinned" '[ $rc = 0 ] && grep -q "$NEW" backup-ops.override.yml && [ "$(grep -c " up " "$STATE/calls")" = 1 ]'
fresh; echo 1 > "$STATE/fail_up"; out=$(g repin-ops "$NEW"); rc=$?
chk "repin: failure rolls back to the previous pinned image" '[ $rc != 0 ] && cmp -s backup-ops.override.yml "$T/override.orig" && ! grep -Eq "docker (start|rm) " "$STATE/calls"'
[ $fail = 0 ] && echo "ALL OPS-TOOLS TESTS PASSED" || { echo "OPS-TOOLS TEST FAILURES"; exit 1; }
