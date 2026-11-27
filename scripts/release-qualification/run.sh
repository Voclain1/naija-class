#!/usr/bin/env bash
# Isolated release qualification: drives the REAL release tooling (infra/vps/release/*) against a real
# Docker Compose stack: PostgreSQL 18, Redis 7.4, Caddy 2.10 with the repository's real Caddyfile, a
# local registry (so images have real digests and the registry can really be made unavailable), a
# scheduler stand-in with real pg_dump, and a migration runner that records _prisma_migrations rows
# the way Prisma does. Only the application images are stand-ins. No real payment, message, school or
# credential is involved; every secret in here is a fictional literal.
#
#   scripts/release-qualification/run.sh                run every scenario
#   scripts/release-qualification/run.sh s01 s09        run these
#   QUAL_KEEP=1 ...                                     keep the stack and work dir afterwards
#
# Writes evidence to $QUAL_OUT (default ./qualification-evidence): one log per scenario and summary.md.
# Exit status is non-zero if any scenario fails.
set -uo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
Q=$ROOT/scripts/release-qualification
TOOLS=$ROOT/infra/vps/release
W=${QUAL_WORK:-$(mktemp -d /tmp/skq.XXXXXX)}
SK=$W/sk
OUT=${QUAL_OUT:-$PWD/qualification-evidence}
REG=localhost:5000
export P_API=14000 P_WEB=13001 P_PORTAL=13002 P_EDGE=18080
export RELEASE_REGISTRY_ALLOW=$REG/
mkdir -p "$W/m" "$OUT"
PASS=0; FAIL=0; RESULTS=()
CUR_LOG=""

# --------------------------------------------------------------------------- tiny test framework
say() { echo "$*" | tee -a "${CUR_LOG:-/dev/null}"; }
check() { # description condition-command...
  local d=$1; shift
  if "$@" >/dev/null 2>&1; then echo "    ok   $d" >> "${CUR_LOG:-/dev/null}"; else echo "    FAIL $d" >> "${CUR_LOG:-/dev/null}"; SC_FAILED=1; fi
}
eq() { [ "$1" = "$2" ]; }
neq() { [ "$1" != "$2" ]; }
contains() { grep -qF -- "$2" <<<"$1"; }
lacks() { ! grep -qF -- "$2" <<<"$1"; }
scenario() { # id title function
  local id=$1 title=$2 fn=$3
  if [ "${#ONLY[@]}" -gt 0 ] && [[ " ${ONLY[*]} " != *" $id "* ]]; then return 0; fi
  CUR_LOG=$OUT/$id.log; : > "$CUR_LOG"; SC_FAILED=0
  local t0=$SECONDS; echo "== $id  $title"; echo "== $id  $title" >> "$CUR_LOG"
  "$fn" >>"$CUR_LOG" 2>&1 || SC_FAILED=1
  grep -qE '^\s+FAIL ' "$CUR_LOG" && SC_FAILED=1
  grep -E '^\s+FAIL ' "$CUR_LOG" | sort -u | sed 's/^/   /'
  if [ "$SC_FAILED" != 0 ]; then { echo "---- release run.log (last 70 lines) ----"; tail -n 70 "$SK/deployments/run.log" 2>/dev/null; echo "---- state ----"; cat "$SK/deployments/state.json" 2>/dev/null; } >> "$CUR_LOG"; fi
  local secs=$((SECONDS - t0))
  if [ "$SC_FAILED" = 0 ]; then PASS=$((PASS + 1)); RESULTS+=("| $id | $title | PASS | ${secs}s |"); echo "   PASS (${secs}s)"
  else FAIL=$((FAIL + 1)); RESULTS+=("| $id | $title | **FAIL** | ${secs}s |"); echo "   FAILED (${secs}s): see $CUR_LOG"; fi
}

# --------------------------------------------------------------------------- images and registry
registry_up() {
  docker inspect skq-registry >/dev/null 2>&1 || docker run -d --name skq-registry -p 5000:5000 registry:2 >/dev/null
  docker start skq-registry >/dev/null 2>&1 || true
  for _ in $(seq 1 30); do curl -fsS -m 2 http://localhost:5000/v2/ >/dev/null 2>&1 && return 0; sleep 1; done
  echo "registry did not start" >&2; return 1
}
declare -A BUILT
build_push() { # key repo-name dockerfile context buildargs... -> prints name@sha256:...
  local key=$1 repo=$2 df=$3 ctx=$4; shift 4
  if [ -n "${BUILT[$key]:-}" ]; then echo "${BUILT[$key]}"; return; fi
  docker build -q -f "$df" "$@" -t "$REG/$repo:$key" "$ctx" >/dev/null || return 1
  docker push -q "$REG/$repo:$key" >/dev/null || return 1
  local d; d=$(docker inspect -f '{{index .RepoDigests 0}}' "$REG/$repo:$key") || return 1
  BUILT[$key]=$d; echo "$d"
}
hex40() { printf '%s' "$1" | sha1sum | cut -c1-40; }
unit_hash() { hex40 "inputs-$1-$2" | cut -c1-24; }   # a stand-in for scripts/release/service-inputs.sh
# mk_release NAME API_MODE WEB_MODE MIGRATION_FILES...   (migrations are names from $Q/migrations)
mk_release() {
  local name=$1 api_mode=$2 web_mode=$3; shift 3
  local sha; sha=$(hex40 "release-$name")
  local mdir; mdir=$(mktemp -d "$W/mig.XXXXXX")
  mkdir -p "$mdir/migrations"
  local f; for f in "$@"; do mkdir -p "$mdir/migrations/${f%%:*}"; cp "$Q/migrations/${f##*:}.sql" "$mdir/migrations/${f%%:*}/migration.sql"; done
  cp "$Q/stub/Dockerfile.migrate" "$Q/stub/migrate" "$mdir/"
  local api render web portal mig
  api=$(build_push "api-$api_mode-$sha" skq-api "$Q/stub/Dockerfile.app" "$Q/stub" --build-arg "MODE=$api_mode" --build-arg "REV=$sha") || return 1
  render=$(build_push "render-good-$sha" skq-render "$Q/stub/Dockerfile.app" "$Q/stub" --build-arg MODE=good --build-arg "REV=$sha") || return 1
  web=$(build_push "web-$web_mode-$sha" skq-web "$Q/stub/Dockerfile.app" "$Q/stub" --build-arg "MODE=$web_mode" --build-arg "REV=$sha") || return 1
  portal=$(build_push "portal-good-$sha" skq-portal "$Q/stub/Dockerfile.app" "$Q/stub" --build-arg MODE=good --build-arg "REV=$sha") || return 1
  mig=$(build_push "migrate-$name-$sha" skq-migrate "$mdir/Dockerfile.migrate" "$mdir" --build-arg "REV=$sha") || return 1
  python3 "$TOOLS/release_tool.py" build-manifest --git-sha "$sha" --pg-major 18 --migrations-dir "$mdir/migrations" --migrate-image "$mig" \
    --image "api=$api" --image "render-worker=$render" --image "web=$web" --image "portal=$portal" \
    --input "api=$(unit_hash "$name" api)" --input "render-worker=$(unit_hash "$name" render-worker)" --input "web=$(unit_hash "$name" web)" \
    --input "portal=$(unit_hash "$name" portal)" --input "migrate=$(unit_hash "$name" migrate)" \
    --built-at "2026-11-27T12:$(printf '%02d' $((++REL_N))):00Z" --out "$W/m/$name.json" >/dev/null || return 1
}
REL_N=0
rid() { python3 "$TOOLS/release_tool.py" jget "$W/m/$1.json" release_id; }
msha() { sha256sum "$W/m/$1.json" | cut -d' ' -f1; }
img() { python3 "$TOOLS/release_tool.py" jget "$W/m/$1.json" "images.$2"; }

# --------------------------------------------------------------------------- the stack
rel() { # release.sh with the isolated environment
  (cd "$SK" && SK_DIR="$SK" RELEASE_QUALIFICATION=1 RELEASE_PROBE_API="http://127.0.0.1:$P_API/api/v1/health" \
    RELEASE_PROBE_API_DB="http://127.0.0.1:$P_API/api/v1/health/db" RELEASE_PROBE_WEB="http://127.0.0.1:$P_WEB/staff/login" \
    RELEASE_PROBE_PORTAL="http://127.0.0.1:$P_PORTAL/api/health" RELEASE_EDGE_SCHEME=http RELEASE_EDGE_PORT=$P_EDGE \
    RELEASE_NOW_HHMM=${RELEASE_NOW_HHMM:-1200} RELEASE_HEALTH_SLEEP=1 RELEASE_HEALTH_TRIES=${RELEASE_HEALTH_TRIES:-30} RELEASE_DRAIN_TRIES=${RELEASE_DRAIN_TRIES:-2} RELEASE_DRAIN_SLEEP=1 \
    RELEASE_DRAIN_SECONDS=1 RELEASE_STOP_GRACE=3 RELEASE_ACCEPT_WINDOW=${RELEASE_ACCEPT_WINDOW:-20} RELEASE_ACCEPT_SLEEP=1 RELEASE_DISK_PATH="$W" \
    RELEASE_MIN_FREE_KIB=${RELEASE_MIN_FREE_KIB:-1000} RELEASE_REGISTRY_ALLOW="$REG/" "$@")
}
R() { rel bash "$TOOLS/release.sh" "$@"; }                 # run release.sh, keep its exit status
ACC() { rel bash "$TOOLS/acceptance.sh" "$@"; }
dc() { (cd "$SK" && docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml "$@"); }
cid_of() { dc ps -q "$1" 2>/dev/null; }
cid_all() { dc ps -aq "$1" 2>/dev/null; }
started() { docker inspect -f '{{.Id}} {{.State.StartedAt}}' "$(cid_of "$1")"; }
running_image() { docker inspect -f '{{.Config.Image}}' "$(cid_of "$1")"; }
# shellcheck disable=SC2120
psql_q() { docker exec -i "$(cid_of postgres)" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d school_kit "$@"; }
state() { python3 "$TOOLS/release_tool.py" state get --file "$SK/deployments/state.json" | python3 -c 'import json,sys; v=json.load(sys.stdin).get(sys.argv[1],""); print(str(v).lower() if isinstance(v,bool) else v)' "$1"; }
current() { cat "$SK/deployments/current" 2>/dev/null; }
edge() { # host path [curl args] -> status code
  local host=$1 path=$2; shift 2
  curl -sS -o /dev/null -m 5 -w '%{http_code}' --resolve "$host:$P_EDGE:127.0.0.1" "$@" "http://$host:$P_EDGE$path" 2>/dev/null || echo 000
}
APIH=api.skq.test; WEBH=app.skq.test; PORTALH=portal.skq.test; BGH=betgenius.test; SCHOOLH=custom.school.test
run_log() { cat "$SK/deployments/run.log" 2>/dev/null; }
hist() { cat "$SK/deployments/history.jsonl" 2>/dev/null; }

stack_down() { [ -d "$SK" ] && (cd "$SK" && docker compose --env-file deploy.env -f docker-compose.yml down -v --remove-orphans -t 2 >/dev/null 2>&1); true; }
stack_reset() { # fresh stack running release R0 (m1), adopted
  stack_down
  rm -rf "$SK"; mkdir -p "$SK/sites" "$SK/deployments"
  cp "$Q/stack/docker-compose.yml" "$Q/stack/init.sql" "$SK/"; cp "$ROOT/infra/vps/Caddyfile" "$SK/Caddyfile"
  printf 'http://%s:8080 {\n\trespond "betgenius" 200\n}\n' "$BGH" > "$SK/sites/betgenius.caddy"
  printf 'http://%s:8080 {\n\trespond "custom school domain" 200\n}\n' "$SCHOOLH" > "$SK/sites/custom-school.caddy"
  local ops; ops=$(build_push "ops-fixture" skq-ops "$Q/stub/Dockerfile.ops" "$Q/stub" --build-arg "REV=$(hex40 ops)") || return 1
  cat > "$SK/deploy.env" <<EOF
IMAGE_PREFIX=$REG
PG_MAJOR=18
POSTGRES_PASSWORD=qual-superuser-fictional
SCHOOL_KIT_PASSWORD=qual-migration-role
APP_USER_PASSWORD=qual-runtime-role
API_HOST=http://$APIH:8080
WEB_HOST=http://$WEBH:8080
PORTAL_HOST=http://$PORTALH:8080
CBT_ENABLED=false
P_API=$P_API
P_WEB=$P_WEB
P_PORTAL=$P_PORTAL
P_EDGE=$P_EDGE
OPS_IMAGE=$ops
VPS_MODE=qualification
EOF
  printf 'services:\n  ops-pinned:\n    extends:\n      file: docker-compose.yml\n      service: ops\n    image: %s\n' "$ops" > "$SK/backup-ops.override.yml"
  printf 'BACKUP_BUCKET=skq-bucket\n' > "$SK/backup.env"
  # R0 is what "production" runs at the start of every scenario.
  printf 'services:\n  api:\n    image: %s\n  render-worker:\n    image: %s\n  web:\n    image: %s\n  portal:\n    image: %s\n' \
    "$(img r0 api)" "$(img r0 render-worker)" "$(img r0 web)" "$(img r0 portal)" > "$SK/release.override.yml"
  (cd "$SK" && docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml -f release.override.yml up -d postgres redis >/dev/null 2>&1) || return 1
  for _ in $(seq 1 60); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$(cid_of postgres)" 2>/dev/null)" = healthy ] && break; sleep 1; done
  # schema for R0, applied by R0's own migration image, as a real release does
  docker run --rm --network skq_default -e "DIRECT_URL=postgresql://school_kit:qual-migration-role@postgres:5432/school_kit" "$(python3 "$TOOLS/release_tool.py" jget "$W/m/r0.json" migrate_image)" migrate deploy >/dev/null 2>&1 || { echo "R0 schema failed"; return 1; }
  (cd "$SK" && docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml -f release.override.yml up -d caddy api render-worker web portal ops-pinned >/dev/null 2>&1) || return 1
  (cd "$SK" && docker compose --env-file deploy.env -f docker-compose.yml create ops >/dev/null 2>&1) || true
  docker exec "$(cid_of ops-pinned)" sh -c 'mkdir -p /store/skq-bucket/dumps/daily && d=$(date -u +%Y-%m-%dT%H%M%SZ) && touch /store/skq-bucket/dumps/daily/school-kit-$d.dump /store/skq-bucket/dumps/daily/school-kit-$d.dump.sha256'
  local _; for _ in $(seq 1 60); do
    curl -fsS -m 2 "http://127.0.0.1:$P_API/api/v1/health" >/dev/null 2>&1 && curl -fsS -m 2 "http://127.0.0.1:$P_WEB/staff/login" >/dev/null 2>&1 && break; sleep 1; done
  seed_money
  R adopt --manifest "$W/m/r0.json" >/dev/null || { echo "adopt failed"; return 1; }
}
seed_money() { # fictional invoices, a payment and a plan, so the integrity queries have something to read
  psql_q >/dev/null <<'SQL'
INSERT INTO invoices (id, school_id, status, total_amount, total_discount, total_due, total_paid) VALUES
  ('inv1','school-a','PARTIALLY_PAID', 500000, 0, 500000, 200000), ('inv2','school-a','ISSUED', 300000, 50000, 250000, 0);
INSERT INTO payments (id, school_id, invoice_id, amount, status, paystack_reference, allocated_kobo) VALUES
  ('pay1','school-a','inv1',200000,'SUCCESS','ref-001',200000);
INSERT INTO payment_plans (id, school_id, invoice_id) VALUES ('plan1','school-a','inv1');
INSERT INTO payment_plan_installments (id, school_id, plan_id, amount) VALUES ('i1','school-a','plan1',250000),('i2','school-a','plan1',250000);
INSERT INTO paystack_webhook_inbox (mode, event_key, event_type, received_at, processed_at) VALUES ('live','evt-1','charge.success', now() - interval '1 hour', now() - interval '59 minutes');
SQL
}
snapshot_protected() { { for s in postgres redis ops-pinned; do echo "$s $(started $s)"; done; echo "caddy $(started caddy)"; } ; }
protected_same() { # file-with-before ; compares postgres redis ops-pinned (+ caddy unless told)
  local before=$1 keep=${2:-all}
  if [ "$keep" = hard ]; then diff <(grep -v '^caddy' "$before") <(snapshot_protected | grep -v '^caddy') >/dev/null
  else diff "$before" <(snapshot_protected) >/dev/null; fi
}
approve() { # name [--allow-destructive]
  local n=$1; shift
  RELEASE_APPROVED=true RELEASE_APPROVAL_PHRASE="APPROVE $(msha "$n" | cut -c1-12)" R approve "$W/m/$n.json" --by "qualification" "$@"
}
wait_state() { # phase seconds
  local _; for _ in $(seq 1 "$2"); do [ "$(state phase)" = "$1" ] && return 0; sleep 1; done; return 1
}
wait_run_done() { local _; for _ in $(seq 1 "${1:-90}"); do case "$(state phase)" in COMPLETE|ROLLED_BACK|ABORTED|FIX_FORWARD_REQUIRED|ROLLBACK_FAILED) return 0 ;; esac; sleep 1; done; return 1; }
continue_run() { touch "$SK/deployments/.continue"; }

# --------------------------------------------------------------------------- the releases used
make_all_releases() {
  say "building release fixtures (images are pushed to the local registry; digests are real)"
  mk_release r0 good good 20270101000000_baseline:m1_baseline || return 1
  mk_release app good good 20270101000000_baseline:m1_baseline || return 1         # same schema, new images
  mk_release app2 good good 20270101000000_baseline:m1_baseline || return 1
  mk_release add good good 20270101000000_baseline:m1_baseline 20270201000000_receipt_note:m2_additive || return 1
  mk_release data good good 20270101000000_baseline:m1_baseline 20270301000000_backfill_legacy_ref:m3_data_backfill || return 1
  mk_release brk good good 20270101000000_baseline:m1_baseline 20270401000000_drop_legacy_ref:m4_drop_column || return 1
  mk_release crash crash good 20270101000000_baseline:m1_baseline || return 1
  mk_release webbad good unhealthy 20270101000000_baseline:m1_baseline || return 1
  mk_release slow slow good 20270101000000_baseline:m1_baseline || return 1
  mk_release badmig good good 20270101000000_baseline:m1_baseline 20270501000000_bad_column:m5_bad || return 1
  mk_release badmigfix good good 20270101000000_baseline:m1_baseline 20270501000000_bad_column:m5_fixed || return 1
  mk_release brkcrash crash good 20270101000000_baseline:m1_baseline 20270401000000_drop_legacy_ref:m4_drop_column || return 1
  mk_release brkfix good good 20270101000000_baseline:m1_baseline 20270401000000_drop_legacy_ref:m4_drop_column || return 1
  mk_release data2 good good 20270101000000_baseline:m1_baseline 20270301000000_backfill_legacy_ref:m3_data_backfill || return 1
  mk_release data3 good good 20270101000000_baseline:m1_baseline 20270301000000_backfill_legacy_ref:m3_data_backfill || return 1
}

ONLY=("$@")
# shellcheck source=scenarios.sh
. "$Q/scenarios.sh"

main() {
  command -v docker >/dev/null || { echo "docker is required"; exit 2; }
  registry_up || exit 2
  make_all_releases || { echo "could not build the release fixtures"; exit 2; }
  stack_reset || { echo "could not build the baseline stack"; exit 2; }
  run_scenarios
  {
    echo "# Release qualification: $(date -u +%FT%TZ)"
    echo; echo "PostgreSQL: $(docker run --rm postgres:18-alpine postgres --version 2>/dev/null)"; echo "Caddy: $(docker run --rm caddy:2.10 caddy version 2>/dev/null | head -n 1)"
    echo; echo "| Scenario | What | Result | Time |"; echo "|---|---|---|---|"; printf '%s\n' "${RESULTS[@]}"
    echo; echo "passed: $PASS  failed: $FAIL"
  } > "$OUT/summary.md"
  cat "$OUT/summary.md"
  if [ "${QUAL_KEEP:-0}" != 1 ]; then stack_down; docker rm -f skq-registry >/dev/null 2>&1; rm -rf "$W"; fi
  [ "$FAIL" = 0 ]
}
main
