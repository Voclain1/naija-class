#!/usr/bin/env bash
# shellcheck disable=SC2034
# Shared by guard.sh and cutover.sh (sourced; never executed). Operator tooling for the VPS.
# Rules every function here follows:
#   * fail closed: a failed or unparsable inspection is an error, never "nothing found";
#   * never print a secret, a secret's length, or a hash of one;
#   * never start the ORIGINAL ops container, never recreate PostgreSQL.
SK_DIR=${SK_DIR:-/opt/school-kit}
OVERRIDE=backup-ops.override.yml
FALLBACK_TAG=schoolkit-ops-fallback:batch2-verified
FAILED=0
ok()   { echo "PASS $*"; }
bad()  { echo "FAIL $*"; FAILED=1; }
info() { echo "INFO $*"; }
die()  { echo "BLOCK $*" >&2; exit 1; }

# Extra compose files exist ONLY for the isolated rehearsal (CUTOVER_MODE=rehearsal); production ignores them.
EXTRA_FILES=()
if [ "${CUTOVER_MODE:-production}" = rehearsal ]; then for f in ${COMPOSE_EXTRA:-}; do EXTRA_FILES+=(-f "$f"); done; fi
dc()  { docker compose --env-file deploy.env -f docker-compose.yml "${EXTRA_FILES[@]}" "$@"; }
# dco = the base project + the pinned scheduler + (once a cutover has started) the release override, so a
# later compose command can never fall back to the APP_TAG image (the pre-allocation 61b5c214 release).
dco() { local rel=(); if [ -f release.override.yml ]; then rel=(-f release.override.yml); fi
        docker compose --env-file deploy.env -f docker-compose.yml "${EXTRA_FILES[@]}" -f "$OVERRIDE" "${rel[@]}" "$@"; }

# Validated `docker top`: header must be PID/COMMAND, at least one process, every row numeric-pid first.
proc_listing() { # container
  local out
  out=$(docker top "$1" -eo pid,args) || { echo "BLOCK docker top failed for $1" >&2; return 2; }
  head -n 1 <<<"$out" | grep -Eq '^[[:space:]]*PID[[:space:]]+(COMMAND|ARGS|CMD)' || { echo "BLOCK unexpected docker top header for $1" >&2; return 2; }
  [ "$(wc -l <<<"$out")" -ge 2 ] || { echo "BLOCK docker top listed no processes for $1" >&2; return 2; }
  tail -n +2 <<<"$out" | awk '$1 !~ /^[0-9]+$/ { bad = 1 } END { exit bad }' || { echo "BLOCK unparsable docker top row for $1" >&2; return 2; }
  printf '%s\n' "$out"
}
count_cmd() { # container command-basename -> prints count (fail closed)
  local listing; listing=$(proc_listing "$1") || return 2
  awk -v want="$2" 'NR > 1 { c = $2; sub(/.*\//, "", c); if (c == want) n++ } END { print n + 0 }' <<<"$listing"
}
backup_busy() { # container -> 0 busy, 1 idle, 2 inspection failed
  local listing; listing=$(proc_listing "$1") || return 2
  awk 'NR > 1 { c = $2; sub(/.*\//, "", c); if (c ~ /^(pg_dump|pg_restore|wal-g|rclone)$/ || $0 ~ /\/ops\/backup\.sh/) f = 1 } END { exit f ? 0 : 1 }' <<<"$listing"
}
in_backup_window() { local h; h=${GUARD_NOW_HHMM:-$(date -u +%H%M)}; [ "$h" -ge 0100 ] && [ "$h" -le 0230 ]; }
identity() { docker inspect -f '{{.Id}} {{.State.StartedAt}}' "$1"; }
override_image() { sed -n 's/^[[:space:]]*image:[[:space:]]*//p' "$OVERRIDE" | head -n 1; }
write_override() { # image
  local tmp; tmp=$(mktemp ./.override.XXXXXX)
  cat > "$tmp" <<YAML
services:
  ops-pinned:
    extends:
      file: docker-compose.yml
      service: ops
    image: $1
YAML
  chmod 600 "$tmp"; mv -f "$tmp" "$OVERRIDE"
}
# The scheduler is healthy when: one container, running, exactly one cron, its settings loaded, it can reach
# PostgreSQL, PostgreSQL's identity is unchanged, and the original ops is still stopped.
verify_scheduler() { # postgres-identity-before
  local c pg old n
  c=$(dco ps -q ops-pinned) || return 1; [ -n "$c" ] || { echo "no ops-pinned container"; return 1; }
  [ "$(docker inspect -f '{{.State.Running}}' "$c")" = true ] || { echo "ops-pinned is not running"; return 1; }
  n=$(count_cmd "$c" cron) || return 1; [ "$n" = 1 ] || { echo "cron count in ops-pinned is $n"; return 1; }
  docker exec "$c" sh -ec '. /ops/env.sh; test -n "${BACKUP_BUCKET:-}" && test -n "${WALG_S3_PREFIX:-}" && test -n "${HEALTHCHECK_PING_URL:-}"; psql -XqAt -v ON_ERROR_STOP=1 -c "SELECT 1" >/dev/null' || return 1
  pg=$(dc ps -q postgres) || return 1
  [ "$(identity "$pg")" = "$1" ] || { echo "PostgreSQL identity changed"; return 1; }
  old=$(dc ps -aq ops) || return 1
  if [ -n "$old" ]; then [ "$(docker inspect -f '{{.State.Running}}' "$old")" = false ] || { echo "original ops is running"; return 1; }; fi
}
# Recreate ONLY ops-pinned from the current override and backup.env.
swap_scheduler() { # postgres-identity-before
  dco config --quiet || return 1
  dco up -d --force-recreate --no-deps --no-build --pull never ops-pinned || return 1
  verify_scheduler "$1"
}
