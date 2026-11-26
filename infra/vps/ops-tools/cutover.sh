#!/usr/bin/env bash
# Controlled production cutover for PR #563 (Batch 3). SEPARATE from deploy.sh and deploy-vps.yml,
# which stay rehearsal-only. Runs on the VPS in /opt/school-kit (Termius, any terminal).
#
#   cutover.sh stage            validate release/manifest.env, pull every image BY DIGEST, check revision labels
#   cutover.sh authorize        owner types the authorisation phrase; binds head SHA + manifest hash, 4 h
#   cutover.sh verify           read-only gates (no authorisation needed)
#   cutover.sh execute [--resume]  the maintenance window: snapshot, 503, drain, migrate, candidate, reopen
#   cutover.sh resolve-migration   after fixing a failed migration's cause: mark it rolled back
#   cutover.sh recover          allocation-compatible recovery release (never the pre-allocation image)
#   cutover.sh reopen           give traffic back once a running release passes the financial gate
#   cutover.sh maintenance on|off
#
# Hard properties (each is asserted by the isolated rehearsal, .github/workflows/batch2-images.yml):
#   * every state-changing mode needs: a valid, unexpired AUTHORIZATION bound to this manifest AND the owner
#     exporting UNIFIED_MESSAGING_CUTOVER_APPROVED=true for that one command (this script never sets it);
#   * only `api` and `render-worker` are ever named; PostgreSQL, Redis, ops, ops-pinned, web and portal are
#     never recreated, rebuilt, removed or pruned; no --remove-orphans, no --build, no image prune;
#   * PostgreSQL's identity, ops-pinned and the stopped original ops are re-checked after every phase;
#   * the old application is stopped and its queues drained BEFORE the first migration;
#   * a failed migration or candidate leaves ingress CLOSED (HTTP 503), never reopens by itself, never
#     starts the pre-allocation image; the way out is resolve-migration + --resume, or recover.
set -Eeuo pipefail
umask 077
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"
mode=${1:?usage: cutover.sh stage|authorize|verify|execute|resolve-migration|recover|reopen|maintenance}
shift || true
cd "$SK_DIR"
mkdir -p release; chmod 700 release
MANIFEST=release/manifest.env
AUTH=release/AUTHORIZATION
STATE=release/state
REHEARSAL=0; [ "${CUTOVER_MODE:-production}" = rehearsal ] && REHEARSAL=1
IMG_RE='^ghcr\.io/voclain1/school-kit-(api|render|migrate|postgres)@sha256:[0-9a-f]{64}$'
PHASES=(NONE STAGED SNAPSHOT_DONE MAINT_ON DRAINED MIGRATED CANDIDATE_UP REOPENED)

dcr() { dco "$@"; }
dvar() { sed -n "s/^$1=//p" deploy.env | head -n 1; }
state_get() { if [ -s "$STATE" ]; then cat "$STATE"; else echo NONE; fi; }
state_set() { printf '%s\n' "$1" > "$STATE"; info "phase -> $1"; }
rank() { local i; for i in "${!PHASES[@]}"; do [ "${PHASES[$i]}" = "$1" ] && { echo "$i"; return; }; done; echo -1; }
done_phase() { [ "$(rank "$(state_get)")" -ge "$(rank "$1")" ]; }

load_manifest() {
  [ -s "$MANIFEST" ] || die "$MANIFEST is missing; paste the release manifest from the batch2-images run summary"
  local k v seen=" "
  while IFS='=' read -r k v; do
    [ -n "$k" ] || continue
    case $k in
      HEAD_SHA|RECOVERY_SHA) [[ $v =~ ^[0-9a-f]{40}$ ]] || die "manifest: $k is not a 40-hex commit" ;;
      PG_MAJOR) [[ $v =~ ^[0-9]{2}$ ]] || die "manifest: PG_MAJOR is not a major version" ;;
      CANDIDATE_API|CANDIDATE_RENDER|RECOVERY_API|RECOVERY_RENDER|MIGRATE|BACKUP_OPS) [[ $v =~ $IMG_RE ]] || die "manifest: $k is not an immutable @sha256 reference" ;;
      *) die "manifest: unexpected key $k" ;;
    esac
    case $seen in *" $k "*) die "manifest: duplicate key $k" ;; esac
    seen+="$k "
    printf -v "M_$k" '%s' "$v"
  done < "$MANIFEST"
  local need; for need in HEAD_SHA RECOVERY_SHA PG_MAJOR CANDIDATE_API CANDIDATE_RENDER RECOVERY_API RECOVERY_RENDER MIGRATE BACKUP_OPS; do
    case $seen in *" $need "*) ;; *) die "manifest: $need is missing" ;; esac
  done
  M_HASH=$(sha256sum "$MANIFEST" | cut -d' ' -f1)
}
require_authorization() {
  load_manifest
  [ "${UNIFIED_MESSAGING_CUTOVER_APPROVED:-}" = true ] || die "the owner must export UNIFIED_MESSAGING_CUTOVER_APPROVED=true for this one command (it is never set permanently)"
  [ -s "$AUTH" ] || die "no authorisation: run 'cutover.sh authorize'"
  local word what head hash expires
  read -r word what head hash expires < "$AUTH"
  [ "$word" = AUTHORIZE ] && [ "$what" = batch3 ] || die "authorisation file is malformed"
  [ "$head" = "$M_HEAD_SHA" ] || die "authorisation is for a different head commit"
  [ "$hash" = "$M_HASH" ] || die "authorisation does not match this manifest (it changed after authorising)"
  [[ $expires =~ ^[0-9]+$ ]] && [ "$(date +%s)" -lt "$expires" ] || die "authorisation has expired"
}

pgmajor_running() { docker exec "$PG" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d school_kit -c "SELECT current_setting('server_version_num')::int / 10000"; }
sql() { docker exec "$PG" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d school_kit "$@"; }
PG=$(dc ps -q postgres); [ -n "$PG" ] || die "PostgreSQL container not found"
PG_ID=$(identity "$PG")

# Re-checked after every phase.
invariants() {
  [ "$(identity "$PG")" = "$PG_ID" ] || die "PostgreSQL was recreated or restarted during the cutover: STOP"
  local p; p=$(dco ps -q ops-pinned); [ -n "$p" ] || die "ops-pinned is gone"
  [ "$(docker inspect -f '{{.State.Running}}' "$p")" = true ] || die "ops-pinned stopped"
  local o; o=$(dc ps -aq ops); [ -z "$o" ] || [ "$(docker inspect -f '{{.State.Running}}' "$o")" = false ] || die "the original ops is running (two schedulers)"
  [ -f "$OVERRIDE" ] || die "$OVERRIDE vanished"
}

# --- gates --------------------------------------------------------------------------------------------------
gates() {
  load_manifest
  local fails=0
  [ "$(dvar PG_MAJOR)" = "$M_PG_MAJOR" ] && ok "deploy.env PG_MAJOR matches the manifest ($M_PG_MAJOR)" || { bad "deploy.env PG_MAJOR differs from the manifest"; fails=1; }
  [ "$(pgmajor_running)" = "$M_PG_MAJOR" ] && ok "running PostgreSQL major matches the manifest" || { bad "running PostgreSQL major differs from the manifest"; fails=1; }
  if [ "$REHEARSAL" = 0 ]; then
    grep -qx 'VPS_MODE=rehearsal' deploy.env && { bad "deploy.env is in rehearsal mode on a production host"; fails=1; } || ok "deploy.env is not in rehearsal mode"
  fi
  local img; img=$(override_image)
  [ "$img" = "$M_BACKUP_OPS" ] && ok "ops-pinned override pins the manifest's backup image" || { bad "ops-pinned override ($([ -n "$img" ] && echo present || echo missing)) differs from the manifest's backup image: run guard.sh repin-ops first"; fails=1; }
  if [ "$REHEARSAL" = 1 ]; then python3 "$here/backup_env.py" validate-generic backup.env --rehearsal-only >/dev/null && ok "backup.env complete (rehearsal provider)" || { bad "backup.env incomplete"; fails=1; }
  else python3 "$here/backup_env.py" validate backup.env >/dev/null && ok "backup.env valid (R2 rules, no empty or duplicate values)" || { bad "backup.env fails validation: run guard.sh config"; fails=1; }; fi
  bash "$here/guard.sh" scheduler >/dev/null && ok "scheduler guard passes (ops-pinned healthy, original ops stopped, fallback present)" || { bad "scheduler guard failed: run guard.sh scheduler"; fails=1; }
  local ref
  for ref in "$M_CANDIDATE_API" "$M_CANDIDATE_RENDER" "$M_RECOVERY_API" "$M_RECOVERY_RENDER" "$M_MIGRATE" "$M_BACKUP_OPS"; do
    if docker image inspect "$ref" >/dev/null 2>&1; then ok "image present by digest: ${ref%%@*}"; else bad "image not staged: ${ref%%@*}"; fails=1; fi
  done
  local label
  for ref in "$M_CANDIDATE_API" "$M_CANDIDATE_RENDER" "$M_MIGRATE"; do
    label=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref" 2>/dev/null || true)
    [ "$label" = "$M_HEAD_SHA" ] || { bad "revision label of ${ref%%@*} is not the manifest head"; fails=1; }
  done
  for ref in "$M_RECOVERY_API" "$M_RECOVERY_RENDER"; do
    label=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref" 2>/dev/null || true)
    [ "$label" = "$M_RECOVERY_SHA" ] || { bad "revision label of ${ref%%@*} is not the recovery commit"; fails=1; }
  done
  # Paid messaging and unauthorised SMS must be OFF in the configuration the candidate will read.
  local k v
  for k in MESSAGING_PAID_ENABLED MESSAGING_LEGACY_SMS_ENABLED MESSAGING_LEGACY_SMS_MIGRATION_MODE MESSAGING_TERMII_REPORTS_ENABLED; do
    v=$(sed -n "s/^$k=//p" api.env | tail -n 1)
    [ "$v" = off ] && ok "api.env $k=off" || { bad "api.env $k is not 'off'"; fails=1; }
  done
  if [ "$REHEARSAL" = 0 ]; then
    [ "$(sed -n 's/^PAYSTACK_WEBHOOK_MODE=//p' api.env | tail -n 1)" = live ] && ok "api.env PAYSTACK_WEBHOOK_MODE=live" || { bad "api.env PAYSTACK_WEBHOOK_MODE is not live"; fails=1; }
    local by; by=$(sed -n 's/^PAYSTACK_WEBHOOK_LEGACY_REVIEW_BY=//p' api.env | tail -n 1)
    [[ $by =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] && [ "$(date -u +%F)" \< "$by" ] && ok "legacy-signature review date is in the future" || { bad "PAYSTACK_WEBHOOK_LEGACY_REVIEW_BY missing or past: the owner must re-authorise it"; fails=1; }
  fi
  [ "$(df -Pk /var/lib/docker | awk 'NR == 2 { printf "%d", $4 / 1048576 }')" -ge 5 ] && ok "at least 5 GiB free" || { bad "less than 5 GiB free"; fails=1; }
  grep -c '^{\$API_HOST} {$' Caddyfile | grep -qx 1 && ok "Caddyfile has exactly one API host block" || { bad "Caddyfile API host block not found exactly once"; fails=1; }
  return "$fails"
}

# --- maintenance (HTTP 503 with Retry-After on the API host, which carries webhook ingress) -----------------
edge_code() { # path
  local args=(); [ -n "${EDGE_RESOLVE:-}" ] && args=(--resolve "$EDGE_RESOLVE")
  curl -sS -o /dev/null -m 10 -w '%{http_code}' "${args[@]}" "${EDGE_BASE:-https://$(dvar API_HOST)}$1"
}
edge_retry_after() { local args=(); [ -n "${EDGE_RESOLVE:-}" ] && args=(--resolve "$EDGE_RESOLVE"); curl -sS -o /dev/null -D - -m 10 "${args[@]}" "${EDGE_BASE:-https://$(dvar API_HOST)}$1" | tr -d '\r' | sed -n 's/^[Rr]etry-[Aa]fter: //p'; }
caddy_apply() { # file: validate inside the caddy container, overwrite IN PLACE (a bind-mounted single file keeps its inode), reload
  dc exec -T caddy sh -c 'cat > /tmp/Caddyfile.candidate' < "$1"
  dc exec -T caddy caddy validate --config /tmp/Caddyfile.candidate --adapter caddyfile >/dev/null 2>&1 || return 1
  cat "$1" > Caddyfile
  dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || return 1
}
maintenance_on() {
  if grep -q '^# BATCH3-MAINTENANCE$' Caddyfile; then info "maintenance already on"; return 0; fi
  [ -e Caddyfile.pre-batch3 ] || cp -p Caddyfile Caddyfile.pre-batch3
  awk 'BEGIN { skip = 0 }
       /^\{\$API_HOST\} \{$/ { print "# BATCH3-MAINTENANCE"; print; print "\theader Retry-After \"120\""; print "\trespond \"Maintenance in progress. Please retry shortly.\" 503"; skip = 1; next }
       skip && /^\}$/ { skip = 0 }
       skip { next }
       { print }' Caddyfile.pre-batch3 > Caddyfile.maintenance
  grep -q 'respond "Maintenance' Caddyfile.maintenance || die "could not build the maintenance Caddyfile"
  caddy_apply Caddyfile.maintenance || { cat Caddyfile.pre-batch3 > Caddyfile; dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true; die "caddy refused the maintenance configuration; original restored"; }
  [ "$(edge_code /api/v1/health)" = 503 ] || die "the edge does not answer 503 on /api/v1/health"
  [ "$(edge_code /api/v1/payments/paystack/webhook)" = 503 ] || die "the edge does not answer 503 on the webhook path"
  [ -n "$(edge_retry_after /api/v1/payments/paystack/webhook)" ] || die "503 carries no Retry-After header"
  ok "maintenance on: HTTP 503 with Retry-After on the API host and the webhook path"
}
maintenance_off() {
  [ -e Caddyfile.pre-batch3 ] || die "Caddyfile.pre-batch3 is missing; refusing to guess the original"
  caddy_apply Caddyfile.pre-batch3 || die "could not restore the original Caddyfile (still in maintenance)"
  rm -f Caddyfile.maintenance
  ok "maintenance off: original Caddyfile restored and reloaded"
}

# --- phases --------------------------------------------------------------------------------------------------
snapshot() {
  local c rc=0; c=$(dco ps -q ops-pinned)
  backup_busy "$c" || rc=$?; [ "$rc" -eq 1 ] || die "a backup is running, or process inspection failed (status $rc)"
  if [ "$REHEARSAL" = 0 ] && in_backup_window; then die "inside the 01:00-02:30 UTC backup window"; fi
  local out; out=$(docker exec -i -e TS="$(date -u +%Y%m%dT%H%M%SZ)" "$c" sh -s <<'SNAP'
set -eu
. /ops/env.sh
umask 077
s=$(mktemp -d); trap 'rm -rf "$s"' EXIT
f="$s/school-kit-pre-batch3-$TS.dump"
pg_dump -Fc -f "$f"
[ "$(wc -c < "$f")" -gt 1024 ]
pg_restore --list "$f" >/dev/null
d=$(sha256sum "$f"); d=${d%% *}
printf '%s  %s\n' "$d" "$(basename "$f")" > "$f.sha256"
remote="backup:${BACKUP_BUCKET}/dumps/pre-batch3/$(basename "$f")"
rclone copyto "$f" "$remote"
rclone copyto "$remote" "$s/readback"
a=$(sha256sum "$s/readback"); [ "${a%% *}" = "$d" ]
rclone copyto "$f.sha256" "$remote.sha256"
lsn=$(psql -XqAt -c "SELECT pg_create_restore_point('batch3_pre_migration_$TS')")
psql -XqAt -c "SELECT pg_switch_wal()" >/dev/null
echo "SNAPSHOT $(basename "$f") restore_point=batch3_pre_migration_$TS lsn=$lsn"
SNAP
  ) || die "the pre-migration snapshot failed; nothing has been changed"
  echo "$out" | tee release/snapshot.txt
}
drain() {
  info "ingress is closed; waiting ${DRAIN_WAIT:-30}s for in-flight requests"; sleep "${DRAIN_WAIT:-30}"
  local n=0 tries=0 k
  while :; do
    n=0
    for k in $(dc exec -T redis redis-cli --scan --pattern 'bull:*:active'); do n=$((n + $(dc exec -T redis redis-cli llen "$k" | tr -d '\r'))); done
    [ "$n" = 0 ] && break
    tries=$((tries + 1)); [ "$tries" -lt "${DRAIN_TRIES:-10}" ] || die "$n queue job(s) are still active; the old application is still running: not stopping it mid-job"
    sleep 6
  done
  dc stop api render-worker >/dev/null
  local s id
  for s in api render-worker; do id=$(dc ps -aq "$s"); [ -z "$id" ] || [ "$(docker inspect -f '{{.State.Running}}' "$id")" = false ] || die "$s did not stop"; done
  ok "old API and render worker stopped; no active queue jobs"
  sql -c "SELECT 'JOURNAL payments not yet final: '||count(*) FROM payments WHERE status = 'PENDING'" | tee -a release/snapshot.txt
}
net_name() { docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$PG" | tr ' ' '\n' | grep -v -e '^edge$' -e '^$' | head -n 1; }
migrate_run() { # status|deploy|resolve NAME
  local envf rc=0; envf=$(mktemp ./.migrate-env.XXXXXX)
  printf 'DIRECT_URL=postgresql://school_kit:%s@postgres:5432/school_kit\n' "$(dvar SCHOOL_KIT_PASSWORD)" > "$envf"
  if [ "$1" = resolve ]; then docker run --rm --network "$(net_name)" --env-file "$envf" "$M_MIGRATE" migrate resolve --rolled-back "$2" || rc=$?
  else docker run --rm --network "$(net_name)" --env-file "$envf" "$M_MIGRATE" migrate "$1" || rc=$?; fi
  rm -f "$envf"; return "$rc"
}
migrations_ok() {
  [ "$(sql -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")" = 0 ] || return 1
  [ "$(sql -c "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payments' AND column_name='allocated_kobo')")" = t ] || return 1
  [ "$(sql -c "SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='paystack_webhook_inbox'::regclass")" = t ] || return 1
  [ "$(sql -c "SELECT NOT (rolsuper OR rolbypassrls) FROM pg_roles WHERE rolname='app_user'")" = t ]
}
release_override() { # candidate|recovery
  local api render brk=0
  if [ "$1" = candidate ]; then api=$M_CANDIDATE_API; render=$M_CANDIDATE_RENDER; else api=$M_RECOVERY_API; render=$M_RECOVERY_RENDER; fi
  [ "$REHEARSAL" = 1 ] && [ "$1" = candidate ] && [ "${REHEARSAL_BREAK_CANDIDATE:-}" = 1 ] && brk=1
  {
    printf 'services:\n  api:\n    image: %s\n' "$api"
    if [ "$brk" = 1 ]; then printf '    command: ["node", "-e", "process.exit(3)"]\n    restart: "no"\n'; fi
    printf '  render-worker:\n    image: %s\n' "$render"
  } > release.override.yml.new
  mv -f release.override.yml.new release.override.yml
}
healthy() {
  local i a w
  for i in $(seq 1 "${HEALTH_TRIES:-60}"); do
    a=$(dcr ps -q api); w=$(dcr ps -q render-worker)
    if [ -n "$a" ] && [ -n "$w" ] \
       && docker exec "$a" node -e 'fetch("http://127.0.0.1:4000/api/v1/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))' 2>/dev/null \
       && docker exec "$w" node -e 'fetch("http://127.0.0.1:4001/health").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))' 2>/dev/null; then return 0; fi
    sleep 3
  done
  return 1
}
start_release() { # candidate|recovery
  release_override "$1"
  dcr config --quiet || return 1
  dcr up -d --no-deps --no-build --pull never api render-worker || return 1
  healthy
}
stop_release() { dcr stop api render-worker >/dev/null 2>&1 || true; }
finance_gate() {
  local dup over
  dup=$(sql -c "SELECT count(*) FROM (SELECT school_id, paystack_reference FROM payments WHERE paystack_reference IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) d")
  over=$(sql -c "SELECT count(*) FROM payments WHERE allocated_kobo IS NOT NULL AND allocated_kobo > amount")
  info "duplicate Paystack reference groups: $dup; payments allocated above their amount: $over"
  info "$(sql -c "SELECT 'inbox rows unprocessed: '||count(*) FROM paystack_webhook_inbox WHERE processed_at IS NULL")"
  [ "$dup" = 0 ] && [ "$over" = 0 ] && migrations_ok
}

case $mode in
stage)
  load_manifest
  [ "$(df -Pk /var/lib/docker | awk 'NR == 2 { printf "%d", $4 / 1048576 }')" -ge 5 ] || die "less than 5 GiB free for image extraction"
  for ref in "$M_CANDIDATE_API" "$M_CANDIDATE_RENDER" "$M_RECOVERY_API" "$M_RECOVERY_RENDER" "$M_MIGRATE" "$M_BACKUP_OPS"; do
    if [ "$REHEARSAL" = 0 ]; then docker pull "$ref" >/dev/null; fi
    docker image inspect "$ref" >/dev/null || die "cannot stage ${ref%%@*}"
  done
  [ "$(state_get)" != NONE ] || state_set STAGED
  ok "manifest valid; every image is present by digest"; gates && ok "all gates pass" || bad "gates failed (see above)" ;;
authorize)
  load_manifest
  [ -t 0 ] || die "authorisation is interactive"
  echo "You are authorising the Batch 3 cutover for head ${M_HEAD_SHA:0:12} with manifest ${M_HASH:0:12}, valid 4 hours."
  echo "Type exactly:  I AUTHORISE THE BATCH 3 CUTOVER"
  read -r phrase; [ "$phrase" = "I AUTHORISE THE BATCH 3 CUTOVER" ] || die "phrase did not match; nothing written"
  printf 'AUTHORIZE batch3 %s %s %s\n' "$M_HEAD_SHA" "$M_HASH" "$(( $(date +%s) + 14400 ))" > "$AUTH"
  ok "authorisation recorded (expires in 4 hours). The window command also needs UNIFIED_MESSAGING_CUTOVER_APPROVED=true, exported by you at that moment." ;;
verify)
  if gates; then ok "ALL GATES PASS (read-only; nothing was changed)"; else bad "gates failed"; fi ;;
maintenance)
  require_authorization
  case ${1:-} in on) maintenance_on ;; off) maintenance_off ;; *) die "maintenance on|off" ;; esac
  invariants ;;
resolve-migration)
  require_authorization
  rows=$(sql -c "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")
  [ -n "$rows" ] || die "no failed migration to resolve"
  [ "$(wc -l <<<"$rows")" = 1 ] || die "more than one unresolved migration; resolve by hand with the owner's engineer"
  info "marking as rolled back (its transaction already rolled back): $rows"
  migrate_run resolve "$rows"; invariants; ok "resolved; now run: cutover.sh execute --resume" ;;
execute)
  require_authorization
  resume=0; [ "${1:-}" = --resume ] && resume=1
  cur=$(state_get)
  if [ "$cur" != NONE ] && [ "$cur" != STAGED ] && [ "$cur" != REOPENED ] && [ "$resume" = 0 ]; then die "an earlier run stopped at $cur; use --resume (after fixing the cause) or recover"; fi
  if [ "$cur" = REOPENED ]; then state_set STAGED; fi
  gates || { echo "GATES FAILED: nothing was changed" >&2; exit 10; }
  if ! done_phase SNAPSHOT_DONE; then snapshot; state_set SNAPSHOT_DONE; invariants; fi
  if ! done_phase MAINT_ON; then maintenance_on; state_set MAINT_ON; invariants; fi
  if ! done_phase DRAINED; then drain; state_set DRAINED; invariants; fi
  if ! done_phase MIGRATED; then
    info "pending migrations (names only):"; migrate_run status 2>&1 | grep -E '^[0-9]{14}_' || info "(none listed)"
    if ! migrate_run deploy; then
      echo "MIGRATION FAILED. Ingress stays CLOSED (503); the old application stays stopped; nothing was started." >&2
      echo "Ingress was closed and both services stopped after the snapshot, so nothing has been written since restore point in release/snapshot.txt." >&2
      echo "Next: fix the cause, then 'cutover.sh resolve-migration' and 'cutover.sh execute --resume'; or restore from the snapshot with the owner's engineer." >&2
      invariants; exit 20
    fi
    migrations_ok || { echo "post-migration verification FAILED; staying in maintenance" >&2; exit 20; }
    state_set MIGRATED; invariants
  fi
  if ! done_phase CANDIDATE_UP; then
    if ! start_release candidate; then
      stop_release
      echo "CANDIDATE DID NOT BECOME HEALTHY. Ingress stays CLOSED (503); the candidate is stopped; the pre-allocation image is NOT started." >&2
      echo "Next: 'cutover.sh recover' (allocation-compatible recovery release) or fix forward." >&2
      invariants; exit 30
    fi
    state_set CANDIDATE_UP; invariants
  fi
  finance_gate || { echo "financial gate FAILED; staying in maintenance" >&2; exit 30; }
  maintenance_off
  [ "$(edge_code /api/v1/health)" = 200 ] || { echo "the edge does not answer 200 after reopening; closing again" >&2; maintenance_on; exit 30; }
  state_set REOPENED; invariants
  ok "CUTOVER COMPLETE: candidate serving traffic by digest; PostgreSQL, ops-pinned and the stopped original ops unchanged"
  echo "Now run the post-deployment acceptance checks (docs/runbooks/batch2-acceptance-and-batch3.md)." ;;
recover)
  require_authorization
  maintenance_on
  stop_release
  if ! start_release recovery; then stop_release; echo "RECOVERY RELEASE DID NOT BECOME HEALTHY. Stay in maintenance and fix forward." >&2; invariants; exit 40; fi
  finance_gate || { echo "financial gate FAILED on the recovery release; stay in maintenance" >&2; exit 40; }
  state_set RECOVERY_UP; invariants
  ok "allocation-compatible recovery release is running with ingress still CLOSED"
  echo "Review inbox/dead-letter state and replay through the audited endpoint, then: cutover.sh reopen" ;;
reopen)
  require_authorization
  case $(state_get) in CANDIDATE_UP|RECOVERY_UP) ;; *) die "reopen needs a release that passed its checks (state is $(state_get))" ;; esac
  healthy || die "the running release is not healthy"
  finance_gate || die "financial gate failed"
  maintenance_off
  [ "$(edge_code /api/v1/health)" = 200 ] || { maintenance_on; die "edge did not answer 200; closed again"; }
  state_set REOPENED; invariants; ok "ingress reopened" ;;
*) die "unknown mode: $mode" ;;
esac
exit "$FAILED"
