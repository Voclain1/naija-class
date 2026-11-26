#!/usr/bin/env bash
# Rehearses infra/vps/ops-tools/cutover.sh on ISOLATED infrastructure (a GitHub runner; fictional data,
# fictional credentials, MinIO as the object store, no provider can be reached): the real docker-compose.yml,
# the real Caddyfile, the pinned backup image as PostgreSQL 18 + ops-pinned, the real pre-allocation release
# (61b5c214) as the "old production" application on that release's own schema, then the cutover.
#
# Paths exercised: refusals (no/expired/mismatched authorisation, no explicit approval variable), a FAILED
# MIGRATION (ingress stays 503, nothing started) -> resolve -> resume, a FAILED CANDIDATE (stays 503, never
# starts the old image) -> allocation-compatible RECOVERY -> reopen, and a clean cutover back to the candidate.
# Throughout: PostgreSQL identity, ops-pinned and the stopped original ops are unchanged, nothing is pruned.
#
# Env: RELEASE_MANIFEST (file), OLD_API, OLD_RENDER (the 61b5c214 images), BASELINE_MIGRATIONS (dir)
set -Eeuo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
: "${RELEASE_MANIFEST:?}" "${OLD_API:?}" "${OLD_RENDER:?}" "${BASELINE_MIGRATIONS:?}"
R=${REHEARSAL_ROOT:-$(mktemp -d)/sk}
mkdir -p "$R"
fails=0
pass() { echo "PASS $*"; }
flunk() { echo "FAIL $*"; fails=1; }
assert() { if eval "$2"; then pass "$1"; else flunk "$1"; fi; }
get() { sed -n "s/^$1=//p" "$RELEASE_MANIFEST"; }
BACKUP=$(get BACKUP_OPS); MIGRATE=$(get MIGRATE); CAND_API=$(get CANDIDATE_API); REC_API=$(get RECOVERY_API); REC_RENDER=$(get RECOVERY_RENDER); CAND_RENDER=$(get CANDIDATE_RENDER)

cleanup() {
  local s=$?
  if [ "$s" != 0 ]; then
    echo "=== failure diagnostics ==="; (cd "$R" && docker compose --env-file deploy.env -f docker-compose.yml -f rehearsal.override.yml ps -a 2>&1 | tail -20)
    for c in api render-worker postgres; do docker logs --tail 25 "school-kit-$c-1" 2>&1 | sed "s/^/[$c] /" || true; done
  fi
  (cd "$R" && docker compose --env-file deploy.env -f docker-compose.yml -f rehearsal.override.yml down -v --remove-orphans >/dev/null 2>&1) || true
  docker rm -fv rh-minio >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ---- the install directory, as on the VPS ------------------------------------------------------------------
rsync -a --exclude 'Dockerfile.next*' "$repo/infra/vps/" "$R/"
mkdir -p "$R/sites" "$R/release"
cd "$R"
OLD_TAG=${OLD_API##*:}
cat > deploy.env <<EOF
IMAGE_PREFIX=ghcr.io/voclain1
APP_TAG=$OLD_TAG
PG_MAJOR=18
POSTGRES_PASSWORD=fx-postgres
SCHOOL_KIT_PASSWORD=fx-migrations
APP_USER_PASSWORD=fx-runtime
API_HOST=http://api.rehearsal.test
WEB_HOST=http://app.rehearsal.test
PORTAL_HOST=http://portal.rehearsal.test
EOF
cat > backup.env <<EOF
BACKUP_BUCKET=rehearsal
WALG_S3_PREFIX=s3://rehearsal/wal
AWS_ACCESS_KEY_ID=fxaccess
AWS_SECRET_ACCESS_KEY=fxsecretfxsecret
AWS_ENDPOINT=http://minio:9000
AWS_REGION=auto
AWS_S3_FORCE_PATH_STYLE=true
HEALTHCHECK_PING_URL=http://heartbeat.invalid/fixture
EOF
cat > api.env <<EOF
NODE_ENV=test
API_PORT=4000
DATABASE_URL=postgresql://app_user:fx-runtime@postgres:5432/school_kit
DIRECT_URL=postgresql://school_kit:fx-migrations@postgres:5432/school_kit
REDIS_URL=redis://redis:6379
RENDER_WORKER_URL=http://render-worker:4001
RENDER_WORKER_PORT=4001
STORAGE_FILESYSTEM_ROOT=/tmp/receipts
SCHEDULED_JOBS=off
BETTER_AUTH_SECRET=rehearsal-fixture-secret-not-for-real-authentication
BETTER_AUTH_URL=http://localhost:3001
WEB_BASE_URL=http://localhost:3001
PORTAL_BASE_URL=http://localhost:3002
PAYSTACK_SECRET_KEY=sk_test_rehearsal_fictional
PAYSTACK_WEBHOOK_MODE=test
PAYSTACK_WEBHOOK_REQUIRE_MODERN=off
MESSAGING_PAID_ENABLED=off
MESSAGING_LEGACY_SMS_ENABLED=off
MESSAGING_LEGACY_SMS_MIGRATION_MODE=off
MESSAGING_TERMII_REPORTS_ENABLED=off
EOF
chmod 600 deploy.env backup.env api.env
touch web.env portal.env cbt.env
cat > rehearsal.override.yml <<'EOF'
services:
  postgres:
    ports: !override
      - "127.0.0.1:55432:5432"
  caddy:
    ports: !override
      - "127.0.0.1:18080:80"
EOF
cp Caddyfile "$R/Caddyfile.original"

# Local image names the compose file expects (`--no-build`: nothing is ever built here).
docker pull "$BACKUP" >/dev/null; docker pull "$MIGRATE" >/dev/null
for i in "$CAND_API" "$CAND_RENDER" "$REC_API" "$REC_RENDER" "$OLD_API" "$OLD_RENDER"; do docker pull "$i" >/dev/null; done
docker pull caddy:2.10-alpine >/dev/null; docker pull redis:7.4-alpine >/dev/null
docker pull minio/minio >/dev/null; docker pull minio/mc >/dev/null
docker tag "$BACKUP" school-kit-postgres:pg18
docker tag caddy:2.10-alpine school-kit-caddy:2.10
docker tag "$OLD_RENDER" "ghcr.io/voclain1/school-kit-render:$OLD_TAG" 2>/dev/null || true
docker tag "$BACKUP" schoolkit-ops-fallback:batch2-verified

export CUTOVER_MODE=rehearsal COMPOSE_EXTRA=rehearsal.override.yml SK_DIR="$R"
export EDGE_BASE=http://api.rehearsal.test:18080 EDGE_RESOLVE=api.rehearsal.test:18080:127.0.0.1 DRAIN_WAIT=2 HEALTH_TRIES=40
dcb() { docker compose --env-file deploy.env -f docker-compose.yml -f rehearsal.override.yml "$@"; }
sqlpg() { docker exec "$(dcb ps -q postgres)" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d school_kit "$@"; }

# ---- PostgreSQL 18 (pinned image), Redis, object storage ---------------------------------------------------
dcb up -d --no-deps --no-build --pull never postgres redis
for _ in $(seq 1 90); do [ "$(docker inspect -f '{{.State.Health.Status}}' "$(dcb ps -q postgres)")" = healthy ] && break; sleep 2; done
net=school-kit_default
docker run -d --name rh-minio --network "$net" --network-alias minio -e MINIO_ROOT_USER=fxaccess -e MINIO_ROOT_PASSWORD=fxsecretfxsecret minio/minio server /data >/dev/null
for _ in $(seq 1 30); do docker run --rm --network "$net" --entrypoint sh minio/mc -c 'mc alias set l http://minio:9000 fxaccess fxsecretfxsecret >/dev/null && mc ls l >/dev/null' 2>/dev/null && break; sleep 2; done
docker run --rm --network "$net" --entrypoint sh minio/mc -c 'mc alias set l http://minio:9000 fxaccess fxsecretfxsecret >/dev/null && mc mb -p l/rehearsal >/dev/null'

# ---- the OLD production state: the real pre-allocation schema and release ------------------------------------
docker run --rm --network "$net" -e DIRECT_URL=postgresql://school_kit:fx-migrations@postgres:5432/school_kit \
  -v "$BASELINE_MIGRATIONS:/app/packages/db/prisma/migrations:ro" "$MIGRATE" migrate deploy >/dev/null
base_count=$(sqlpg -c "SELECT count(*) FROM _prisma_migrations")
echo "baseline schema (61b5c214): $base_count migrations applied"
sqlpg -c "INSERT INTO schools (id,name,slug,updated_at) VALUES ('ab000000-0000-4000-a000-0000000000f1','Rehearsal School','rehearsal-school',now())"

# ops-pinned exactly as the owner's activation leaves it: original ops created, stopped, restart=no; override pins the image.
dcb up -d --no-deps --no-build --pull never ops
docker update --restart=no "$(dcb ps -aq ops)" >/dev/null; docker stop "$(dcb ps -aq ops)" >/dev/null
printf 'services:\n  ops-pinned:\n    extends:\n      file: docker-compose.yml\n      service: ops\n    image: %s\n' "$BACKUP" > backup-ops.override.yml
dcb -f backup-ops.override.yml up -d --no-deps --no-build --pull never ops-pinned
pg0=$(docker inspect -f '{{.Id}} {{.State.StartedAt}}' "$(dcb ps -q postgres)"); echo "$pg0" > .batch2-postgres-identity
OPS_PINNED_ID=$(dcb -f backup-ops.override.yml ps -q ops-pinned); OPS_OLD_ID=$(dcb ps -aq ops)
for _ in $(seq 1 30); do docker exec "$OPS_PINNED_ID" test -f /etc/cron.d/school-kit && break; sleep 1; done
dcb up -d --no-deps --no-build --pull never caddy
# The old application, started the way production started it: compose + APP_TAG.
dcb up -d --no-deps --no-build --pull never api render-worker
for _ in $(seq 1 90); do [ "$(curl -s -o /dev/null -w '%{http_code}' --resolve "$EDGE_RESOLVE" "$EDGE_BASE/api/v1/health")" = 200 ] && break; sleep 2; done
code() { curl -s -o /dev/null -m 10 -w '%{http_code}' --resolve "$EDGE_RESOLVE" "$EDGE_BASE$1"; }
assert "old release (61b5c214) serves 200 through Caddy before the cutover" '[ "$(code /api/v1/health)" = 200 ]'
assert "old API runs the pre-allocation image" '[ "$(docker inspect -f "{{.Config.Image}}" "$(dcb ps -q api)")" = "$OLD_API" ] || docker inspect -f "{{.Config.Image}}" "$(dcb ps -q api)" | grep -q "$OLD_TAG"'

# The owner pastes the manifest, exactly as the runbook says.
cp "$RELEASE_MANIFEST" release/manifest.env

snapshot_ids() { { dcb ps -q postgres; dcb -f backup-ops.override.yml ps -q ops-pinned; dcb ps -q caddy; dcb ps -q redis; } | sort | tr '\n' ' '; }
ids0=$(snapshot_ids)
tools=$R/ops-tools
ct() { bash "$tools/cutover.sh" "$@"; }
approved() { UNIFIED_MESSAGING_CUTOVER_APPROVED=true bash "$tools/cutover.sh" "$@"; }
authorize_with() { # a real pty, because `authorize` refuses to run without a terminal
  python3 - "$tools/cutover.sh" "$1" <<'PY' >/dev/null 2>&1 || true
import os, pty, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.execvp("bash", ["bash", sys.argv[1], "authorize"])
time.sleep(1)
os.write(fd, (sys.argv[2] + "\n").encode())
try:
    while os.read(fd, 1024):
        pass
except OSError:
    pass
os.waitpid(pid, 0)
PY
}
unchanged_app() { [ "$(code /api/v1/health)" = 200 ] && docker inspect -f '{{.State.Running}}' "$(dcb ps -q api)" | grep -q true; }
invariants_hold() { [ "$(snapshot_ids)" = "$ids0" ] && [ "$(docker inspect -f '{{.Id}} {{.State.StartedAt}}' "$(dcb ps -q postgres)")" = "$pg0" ] && [ "$(docker inspect -f '{{.State.Running}}' "$OPS_OLD_ID")" = false ] && docker image inspect schoolkit-ops-fallback:batch2-verified >/dev/null; }

echo "=== S0: read-only gates, then refusals that change nothing ==="
set +e
ct verify > "$R/verify.out" 2>&1; rc=$?
set -e
sed 's/^/  /' "$R/verify.out" | tail -25
assert "verify passes all gates on the rehearsal install (read-only)" '[ "$rc" = 0 ]'
assert "verify changed nothing" 'unchanged_app && invariants_hold'
set +e
approved execute >/dev/null 2>&1; r1=$?
rm -f release/AUTHORIZATION; echo "AUTHORIZE batch3 $(get HEAD_SHA) $(sha256sum release/manifest.env | cut -d' ' -f1) $(( $(date +%s) - 60 ))" > release/AUTHORIZATION
approved execute >/dev/null 2>&1; r2=$?
echo "AUTHORIZE batch3 $(get HEAD_SHA) $(sha256sum release/manifest.env | cut -d' ' -f1) $(( $(date +%s) + 3600 ))" > release/AUTHORIZATION
ct execute >/dev/null 2>&1; r3=$?
echo "AUTHORIZE batch3 ffffffffffffffffffffffffffffffffffffffff $(sha256sum release/manifest.env | cut -d' ' -f1) $(( $(date +%s) + 3600 ))" > release/AUTHORIZATION
approved execute >/dev/null 2>&1; r5=$?
echo "AUTHORIZE batch3 $(get HEAD_SHA) $(sha256sum release/manifest.env | cut -d' ' -f1) $(( $(date +%s) + 3600 ))" > release/AUTHORIZATION
cp release/manifest.env release/manifest.good; echo "# tamper" >> release/manifest.env
approved execute >/dev/null 2>&1; r6=$?
cp release/manifest.good release/manifest.env
set -e
assert "refused: no authorisation file" '[ "$r1" != 0 ]'
assert "refused: expired authorisation" '[ "$r2" != 0 ]'
assert "refused: valid authorisation but the owner has not exported UNIFIED_MESSAGING_CUTOVER_APPROVED" '[ "$r3" != 0 ]'
assert "refused: authorisation for a different head commit" '[ "$r5" != 0 ]'
assert "refused: manifest changed after authorising" '[ "$r6" != 0 ]'
assert "all refusals changed nothing (old release still serving, same containers, PostgreSQL untouched)" 'unchanged_app && invariants_hold && [ "$(cat release/state 2>/dev/null || echo NONE)" != MAINT_ON ]'
set +e; bash "$R/deploy.sh" deadbeef >/dev/null 2>&1; rd=$?; set -e
assert "the generic deploy.sh still refuses to run here (rehearsal-only guard)" '[ "$rd" != 0 ] && unchanged_app'
# wrong phrase through a real pty writes nothing
rm -f release/AUTHORIZATION; authorize_with "yes please"
assert "authorize with a wrong phrase writes nothing" '[ ! -s release/AUTHORIZATION ]'
authorize_with "I AUTHORISE THE BATCH 3 CUTOVER"
assert "authorize with the exact phrase records a head- and manifest-bound authorisation" 'grep -q "^AUTHORIZE batch3 $(get HEAD_SHA) $(sha256sum release/manifest.env | cut -d" " -f1) " release/AUTHORIZATION'

echo "=== S1: a FAILED MIGRATION leaves ingress closed and starts nothing ==="
sqlpg -c "CREATE TABLE paystack_webhook_inbox (x int)"   # a pending migration will collide with this
set +e; approved execute > "$R/s1.out" 2>&1; rc=$?; set -e
tail -12 "$R/s1.out" | sed 's/^/  /'
assert "S1: execute exits 20 (migration failure)" '[ "$rc" = 20 ]'
assert "S1: ingress is CLOSED: HTTP 503 on health and on the webhook path" '[ "$(code /api/v1/health)" = 503 ] && [ "$(code /api/v1/payments/paystack/webhook)" = 503 ]'
assert "S1: 503 carries Retry-After" 'curl -s -o /dev/null -D - --resolve "$EDGE_RESOLVE" "$EDGE_BASE/api/v1/payments/paystack/webhook" | grep -qi "^retry-after:"'
assert "S1: the old application is stopped (drained BEFORE the migration) and no release was started" '[ -z "$(docker ps --format "{{.Image}}" | grep -E "school-kit-(api|render)" || true)" ]'
assert "S1: the pre-migration snapshot exists in object storage and the restore point was recorded" 'docker run --rm --network "$net" --entrypoint sh minio/mc -c "mc alias set l http://minio:9000 fxaccess fxsecretfxsecret >/dev/null && mc ls l/rehearsal/dumps/pre-batch3/" | grep -q "pre-batch3.*dump" && grep -q "restore_point=batch3_pre_migration_" release/snapshot.txt'
assert "S1: the failed migration is recorded as unresolved" '[ "$(sqlpg -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")" = 1 ]'
assert "S1: PostgreSQL, ops-pinned, original ops untouched" 'invariants_hold'
set +e; approved execute >/dev/null 2>&1; rr=$?; set -e
assert "S1: running execute again WITHOUT --resume is refused" '[ "$rr" != 0 ]'
sqlpg -c "DROP TABLE paystack_webhook_inbox"
approved resolve-migration >/dev/null
assert "S1: resolve-migration marks the failed migration rolled back (nothing unresolved)" '[ "$(sqlpg -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")" = 0 ]'

echo "=== S2: a FAILED CANDIDATE stays closed and NEVER starts the pre-allocation image ==="
set +e; REHEARSAL_BREAK_CANDIDATE=1 HEALTH_TRIES=8 approved execute --resume > "$R/s2.out" 2>&1; rc=$?; set -e
tail -8 "$R/s2.out" | sed 's/^/  /'
assert "S2: execute exits 30 (candidate unhealthy)" '[ "$rc" = 30 ]'
assert "S2: migrations were applied before the candidate started" '[ "$(sqlpg -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='"'"'payments'"'"' AND column_name='"'"'allocated_kobo'"'"')")" = t ]'
assert "S2: ingress still CLOSED (503)" '[ "$(code /api/v1/health)" = 503 ]'
assert "S2: no application container is running, and the 61b5c214 image was never restarted" '[ -z "$(docker ps --format "{{.Image}}" | grep -E "school-kit-(api|render)" || true)" ]'
assert "S2: PostgreSQL, ops-pinned, original ops untouched" 'invariants_hold'

echo "=== S3: allocation-compatible RECOVERY, then reopen ==="
approved recover > "$R/s3.out" 2>&1 || { tail -20 "$R/s3.out"; flunk "S3: recover failed"; }
assert "S3: recovery API and worker run the pinned recovery digests" '[ "$(docker inspect -f "{{.Config.Image}}" "$(dcb -f backup-ops.override.yml -f release.override.yml ps -q api)")" = "$REC_API" ] && [ "$(docker inspect -f "{{.Config.Image}}" "$(dcb -f backup-ops.override.yml -f release.override.yml ps -q render-worker)")" = "$REC_RENDER" ]'
assert "S3: ingress is still CLOSED while the recovery release is checked" '[ "$(code /api/v1/health)" = 503 ]'
assert "S3: guard.sh release confirms the pinned release is what runs" 'bash "$tools/guard.sh" release >/dev/null'
approved reopen >/dev/null
assert "S3: reopen gives traffic back (200) on the recovery release" '[ "$(code /api/v1/health)" = 200 ]'
assert "S3: Caddyfile restored byte-for-byte" 'cmp -s Caddyfile Caddyfile.original'
assert "S3: PostgreSQL, ops-pinned, original ops untouched" 'invariants_hold'

echo "=== S4: a clean cutover back to the candidate ==="
approved execute --resume > "$R/s4.out" 2>&1 || { tail -25 "$R/s4.out"; flunk "S4: execute failed"; }
tail -4 "$R/s4.out" | sed 's/^/  /'
assert "S4: candidate API and worker run the pinned candidate digests" '[ "$(docker inspect -f "{{.Config.Image}}" "$(dcb -f backup-ops.override.yml -f release.override.yml ps -q api)")" = "$CAND_API" ] && [ "$(docker inspect -f "{{.Config.Image}}" "$(dcb -f backup-ops.override.yml -f release.override.yml ps -q render-worker)")" = "$CAND_RENDER" ]'
assert "S4: traffic is back (200) and maintenance is off" '[ "$(code /api/v1/health)" = 200 ] && ! grep -q BATCH3-MAINTENANCE Caddyfile && cmp -s Caddyfile Caddyfile.original'
assert "S4: guard.sh release and scheduler both pass" 'bash "$tools/guard.sh" release >/dev/null && bash "$tools/guard.sh" scheduler >/dev/null'
assert "S4: PostgreSQL identity and start time unchanged through the whole rehearsal" 'invariants_hold'
assert "S4: the recovery images and the fallback tag were not pruned" 'docker image inspect "$REC_API" "$REC_RENDER" "$OLD_API" schoolkit-ops-fallback:batch2-verified >/dev/null'
assert "S4: a plain compose config (no release override) would fall back to APP_TAG, which the tooling never runs" '[ "$(dcb config | grep -c "school-kit-api:$OLD_TAG")" -ge 1 ] && [ "$(dcb -f backup-ops.override.yml -f release.override.yml config | grep -c "school-kit-api@")" -ge 1 ]'
assert "S4: the tooling contains no orphan removal, build, image prune, compose down or PostgreSQL restart" '! grep -Eq "remove-orphans|--build|image prune|system prune|compose[^|]* down|up -d[^|]* postgres|restart postgres" "$tools/cutover.sh" "$tools/guard.sh" "$tools/lib.sh"'

[ "$fails" = 0 ] && echo "CUTOVER REHEARSAL PASSED (isolated infrastructure; no production system was touched)" || { echo "CUTOVER REHEARSAL FAILED"; exit 1; }
