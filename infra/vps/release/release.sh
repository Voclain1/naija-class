#!/usr/bin/env bash
# School Kit release orchestrator (server side). Replaces hand-run Termius sessions for routine
# releases; schema changes, destructive operations and exceptional financial changes keep an
# explicit approval gate. It is SEPARATE from ops-tools/cutover.sh (the one-off coordinated
# cutover) and refuses to run while that procedure is in progress.
#
#   release.sh adopt --manifest F [--extra-file F]...  record what is running as the baseline release
#   release.sh plan F                                  read-only: class, services, migrations, blockers
#   release.sh stage F                                 pull images BY DIGEST and check their labels (no runtime change)
#   release.sh approve F [--allow-destructive] --by WHO   owner approval bound to this exact manifest (RELEASE_APPROVED=true + phrase)
#   release.sh apply F [--trigger auto|manual] [--detach] [--fix-forward]
#   release.sh status [--json] | resume | abort | rollback [--to ID] | history [N]
#   release.sh resolve-migration NAME | maintenance on|off|status | diagnostics
#
# Exit status: 0 done · 1 failed and returned to the previous release (or aborted before any
# change) · 3 refused (blockers, approval, switch off) · 4 system busy, nothing changed, retry
# later · 5 another release command is running · 6 FIX-FORWARD REQUIRED (the database moved and
# the previous release cannot run on it) · 7 ROLLBACK FAILED (maintenance is ON; an operator
# must act) · 64 usage.
set -Eeuo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"
# shellcheck source=acceptance.sh
. "$here/acceptance.sh"
cd "$SK_DIR"
mkdir -p "$D"/{releases,approvals,baseline,diagnostics,alerts,staging}
chmod 700 "$D"

APPLY_ORDER=(render-worker api web portal cbt)
PHASES=(NONE PLANNED STAGED PREFLIGHT_OK QUIESCED SNAPSHOT_DONE MIGRATED SWITCHED VERIFIED COMPLETE)
rank() { local i; for i in "${!PHASES[@]}"; do [ "${PHASES[$i]}" = "$1" ] && { echo "$i"; return; }; done; echo -1; }
phase_ge() { [ "$(rank "$(state_get phase)")" -ge "$(rank "$1")" ]; }
terminal() { case "$(state_get phase)" in ''|COMPLETE|ROLLED_BACK|ABORTED) return 0 ;; *) return 1 ;; esac; }
pj() { python3 -c 'import json,sys
d=json.load(sys.stdin); v=d[sys.argv[1]]
print(json.dumps(v) if isinstance(v,(list,dict)) else (str(v).lower() if isinstance(v,bool) else v))' "$1"; }
cutover_busy() { [ -s release/state ] && ! grep -qxE 'NONE|REOPENED' release/state; }
current_id() { cat "$D/current" 2>/dev/null || true; }
current_manifest() { local c; c=$(current_id); [ -n "$c" ] && [ -f "$D/releases/$c/manifest.json" ] && echo "$D/releases/$c/manifest.json" || true; }
usage() { sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 64; }
fail_exit() { local code=$1; shift; log "BLOCK $*"; exit "$code"; }

# --------------------------------------------------------------------------- manifest handling
load_manifest() { # file -> sets M, M_ID, M_SHA (the staged copy is immutable: same hash or refuse)
  [ -f "$1" ] || fail_exit 3 "manifest $1 does not exist"
  TOOL validate "$1" >/dev/null || fail_exit 3 "the manifest failed validation"
  M_SHA=$(sha256sum "$1" | cut -d' ' -f1)
  M_ID=$(TOOL jget "$1" release_id)
  M=$D/staging/$M_ID.json
  if [ -f "$M" ]; then
    [ "$(sha256sum "$M" | cut -d' ' -f1)" = "$M_SHA" ] || fail_exit 3 "release $M_ID was staged with different content; a release id is never reused"
  else cp "$1" "$M"; chmod 600 "$M"; fi
}
mf() { TOOL jget "$M" "$1"; }
applied_to() { applied_rows > "$1"; }
make_plan() { # -> prints plan json
  local f="$D/.applied.$$" cur plan; cur=$(current_manifest)
  applied_to "$f" || { rm -f "$f"; return 1; }
  plan=$(TOOL plan --manifest "$M" --applied "$f" ${cur:+--current "$cur"}) || { rm -f "$f"; return 1; }
  rm -f "$f"; printf '%s\n' "$plan"
}
write_override() { # manifest outfile [only-services...]
  local m=$1 out=$2 s ref
  { echo "services:"
    for s in "${SERVICES_ALL[@]}"; do
      ref=$(TOOL jget "$m" "images.$s" 2>/dev/null) || continue
      service_enabled "$s" || continue
      printf '  %s:\n    image: %s\n' "$s" "$ref"
    done; } > "$out.tmp"
  mv -f "$out.tmp" "$out"
}

# --------------------------------------------------------------------------- adopt
cmd_adopt() {
  local mfile="" extras=()
  while [ $# -gt 0 ]; do case $1 in --manifest) mfile=$2; shift 2 ;; --extra-file) extras+=("$2"); shift 2 ;; *) usage ;; esac; done
  [ -n "$mfile" ] || usage
  exec 9>"$D/apply.lock"; flock -n 9 || fail_exit 5 "another release command is running"
  cutover_busy && fail_exit 3 "the coordinated cutover is in progress (release/state); not adopting"
  terminal || fail_exit 3 "a release is in state $(state_get phase); resolve it first"
  load_manifest "$mfile"
  local x; for x in "${extras[@]}"; do [ -r "$x" ] || fail_exit 3 "overlay $x is not readable"; done
  : > "$D/compose-extra"; for x in "${extras[@]}"; do echo "$x" >> "$D/compose-extra"; done
  MANIFEST=$M; PHASE=adopt; CHECK_FAILED=0
  rdc config --quiet || fail_exit 3 "compose does not validate with the given overlays"
  local pgmajor; pgmajor=$(sql -c "SELECT current_setting('server_version_num')::int / 10000")
  [ "$pgmajor" = "$(mf pg_major)" ] || fail_exit 3 "running PostgreSQL major ($pgmajor) differs from the manifest ($(mf pg_major))"
  check_images || fail_exit 3 "what is running is not what the manifest says: build a manifest for the deployed commit"
  check_migrations || fail_exit 3 "the database does not match the manifest's migrations"
  mkdir -p "$D/releases/$M_ID"; cp "$M" "$D/releases/$M_ID/manifest.json"
  echo "$M_ID" > "$D/current"; rm -f "$D/previous"
  protected_save
  state_set release_id="$M_ID" manifest_sha256="$M_SHA" phase=COMPLETE trigger=adopt mutated=false >/dev/null
  event adopted release_id="$M_ID" manifest_sha256="$M_SHA"
  ok "adopted $M_ID as the baseline release; the overlays recorded: ${#extras[@]}"
}

# --------------------------------------------------------------------------- plan / stage / approve
cmd_plan() {
  load_manifest "${1:?manifest}"
  local plan; plan=$(make_plan) || fail_exit 3 "the plan could not be computed (is the database reachable?)"
  printf '%s\n' "$plan"
  [ -z "$(pj blockers <<<"$plan" | tr -d '[]')" ] || { log "BLOCK the release has blockers"; return 3; }
}
image_present() { docker image inspect "$1" >/dev/null 2>&1; }
stage_core() { # -> 0 | 3 refused | 4 nothing changed, retry later
  local plan s ref label n=0; plan=$(make_plan) || { log "BLOCK the plan could not be computed"; return 3; }
  local want=(); mapfile -t want < <(python3 -c 'import json,sys; d=json.load(sys.stdin); print("\n".join(d["services_changed"] + (["migrate"] if d["pending"] else [])))' <<<"$plan")
  for s in "${want[@]}"; do
    [ -n "$s" ] || continue
    if [ "$s" = migrate ]; then ref=$(mf migrate_image); else ref=$(mf "images.$s"); fi
    if image_present "$ref"; then info "$s already on this server"; else
      disk_ok || { log "BLOCK not enough free disk to pull $s (needs ${RELEASE_MIN_FREE_KIB:-5242880} KiB free); nothing changed"; return 4; }
      log "pulling $s"
      if ! docker pull -q "$ref" >/dev/null 2>"$D/.pull.err"; then
        TOOL redact < "$D/.pull.err" >&2; rm -f "$D/.pull.err"
        log "BLOCK could not pull $s (registry unavailable or the digest is missing); nothing changed, the running release is untouched"; return 4
      fi
      rm -f "$D/.pull.err"
    fi
    label=$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref") || return 3
    # an unchanged unit keeps the image (and the commit label) of the release that built it
    want_rev=$(TOOL jget "$M" "provenance.$s" 2>/dev/null || mf git_sha)
    [ "$label" = "$want_rev" ] || { log "BLOCK $s: image revision label ($label) is not the commit it was built from ($want_rev)"; return 3; }
    n=$((n + 1))
  done
  ok "staged $n image(s) for $M_ID, all by digest, all labelled with the manifest commit"
  event staged release_id="$M_ID" images="$n"
}
cmd_stage() { load_manifest "${1:?manifest}"; local rc=0; stage_core || rc=$?; return "$rc"; }
cmd_approve() {
  local mfile="" by="" destructive=false
  while [ $# -gt 0 ]; do case $1 in --by) by=$2; shift 2 ;; --allow-destructive) destructive=true; shift ;; -*) usage ;; *) mfile=$1; shift ;; esac; done
  [ -n "$mfile" ] && [ -n "$by" ] || usage
  load_manifest "$mfile"
  [ "${RELEASE_APPROVED:-}" = true ] || fail_exit 3 "export RELEASE_APPROVED=true for this one command (it is never set permanently)"
  local phrase="APPROVE ${M_SHA:0:12}" given=${RELEASE_APPROVAL_PHRASE:-}
  if [ -z "$given" ]; then read -r -p "Type exactly '$phrase': " given; fi
  [ "$given" = "$phrase" ] || fail_exit 3 "the approval phrase does not match this manifest"
  local exp; exp=$(date -u -d '+4 hours' +%s)
  printf '{"manifest_sha256":"%s","release_id":"%s","approved_by":"%s","approved_at":"%s","expires_at":%s,"allow_destructive":%s}\n' \
    "$M_SHA" "$M_ID" "$(printf '%s' "$by" | tr -cd 'A-Za-z0-9 _:./@-')" "$(date -u +%FT%TZ)" "$exp" "$destructive" > "$D/approvals/$M_SHA.json"
  event approved release_id="$M_ID" by="$by" destructive="$destructive"
  ok "approved $M_ID for 4 hours (destructive allowed: $destructive)"
}
approval_ok() { # needs_destructive(true|false)
  local f="$D/approvals/$M_SHA.json"
  [ -f "$f" ] || return 1
  python3 - "$f" "$M_SHA" "$1" <<'PY'
import json, sys, time
d = json.load(open(sys.argv[1]))
ok = d["manifest_sha256"] == sys.argv[2] and d["expires_at"] > time.time() and (sys.argv[3] != "true" or d["allow_destructive"])
sys.exit(0 if ok else 1)
PY
}

# --------------------------------------------------------------------------- apply: the steps
net_name() { docker inspect -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$(cid postgres)" | tr ' ' '\n' | grep -v -e '^edge$' -e '^$' | head -n 1; }
active_jobs() { queue_active; }
claimed_webhooks() { sql -c "SELECT count(*) FROM paystack_webhook_inbox WHERE processed_at IS NULL AND dead_at IS NULL AND claimed_until IS NOT NULL AND claimed_until > now()"; }
drain_wait() { # bounded: never stop the API or worker under an active job or a claimed payment webhook
  local i n w
  for i in $(seq 1 "${RELEASE_DRAIN_TRIES:-10}"); do
    n=$(active_jobs) || return 1; w=$(claimed_webhooks) || return 1
    if [ "$n" = 0 ] && [ "$w" = 0 ]; then ok "no active background jobs and no claimed webhook deliveries"; return 0; fi
    info "waiting: $n active job(s), $w claimed webhook(s)"; sleep "${RELEASE_DRAIN_SLEEP:-6}"
  done
  log "BUSY still $n active job(s) / $w claimed webhook(s): not stopping anything mid-work"; return 1
}
step_stage() { stage_core; }
step_preflight() {
  CHECK_FAILED=0
  local fixfwd; fixfwd=$(state_get fix_forward)
  [ -z "$(pj blockers <<<"$PLAN" | tr -d '[]')" ] || { bad "plan blockers: $(pj blockers <<<"$PLAN")"; return 1; }
  # Ingress left closed by a FIX_FORWARD_REQUIRED stop is expected here (the corrected release reopens it); anywhere else it is a problem.
  if maintenance_active && [ "$fixfwd" != 1 ]; then bad "the edge is in maintenance from an earlier window: resolve that first"; return 1; fi
  disk_ok && ok "free disk is above the floor" || bad "free disk is below ${RELEASE_MIN_FREE_KIB:-5242880} KiB"
  local pg; pg=$(sql -c "SELECT current_setting('server_version_num')::int / 10000") || return 1
  [ "$pg" = "$(mf pg_major)" ] && [ "$(dvar PG_MAJOR)" = "$pg" ] && ok "PostgreSQL major $pg matches the manifest and deploy.env" || bad "PostgreSQL major mismatch (running $pg, deploy.env $(dvar PG_MAJOR), manifest $(mf pg_major))"
  local cur; cur=$(current_manifest); local s ref
  if [ "$fixfwd" = 1 ]; then
    # A fix-forward starts from a system a failed release left half-changed: what runs is NOT the recorded current release
    # and the API may be down. The checks that need that are skipped here and run in full in acceptance after the switch.
    warn "fix-forward: drift and API-gate checks are deferred to acceptance (the system is not the recorded release by definition)"
  else
    # What runs now must be what we recorded (no hand changes) and be restorable locally.
    MANIFEST=$cur; PHASE=preflight
    check_images && check_migrations || bad "drift: the running system is not the recorded current release ($(current_id))"
    for s in $(enabled_services); do
      ref=$(TOOL jget "$cur" "images.$s" 2>/dev/null) || continue
      if fault hide_rollback_image || ! image_present "$ref"; then bad "rollback image for $s is not on this server (local rollback would be impossible)"; fi
    done
    check_gates
  fi
  if in_backup_window && [ "$(pj class <<<"$PLAN")" = SCHEMA ]; then bad "inside the 01:00-02:30 UTC backup window: schema releases wait"; fi
  if [ "$RELEASE_TRIGGER" = auto ] || [ "${RELEASE_ALLOW_STALE_BACKUP:-}" != 1 ]; then check_backups; else warn "backup freshness check skipped by RELEASE_ALLOW_STALE_BACKUP=1 (manual only)"; fi
  SAVE_BASELINE="$D/baseline/$M_ID.env" check_integrity
  protected_save
  if maintenance_active && [ -e "$D/Caddyfile.pre-release" ]; then caddy_fingerprint_original > "$D/caddy.fingerprint"; else caddy_fingerprint > "$D/caddy.fingerprint"; fi
  [ "$CHECK_FAILED" = 0 ] || return 1
  ok "preflight passed for $M_ID"
}
step_quiesce() {
  NEEDS_MAINT=$(pj needs_maintenance <<<"$PLAN")
  drain_wait || return 4
  if [ "$NEEDS_MAINT" = true ]; then
    state_set mutated=true >/dev/null
    maintenance_on "$M_ID" || return 1
    info "ingress is closed; waiting ${RELEASE_DRAIN_SECONDS:-30}s for in-flight requests"; sleep "${RELEASE_DRAIN_SECONDS:-30}"
    drain_wait || return 1
    rdc stop -t "${RELEASE_STOP_GRACE:-60}" api render-worker >/dev/null || return 1
    local s id
    for s in api render-worker; do id=$(cid_any "$s"); [ -z "$id" ] || [ "$(docker inspect -f '{{.State.Running}}' "$id")" = false ] || { log "BLOCK $s did not stop"; return 1; }; done
    ok "ingress closed; the API and render worker are stopped; no queue job was interrupted"
  fi
  protected_assert quiesce
}
step_snapshot() {
  [ "$(pj class <<<"$PLAN")" = SCHEMA ] || { info "no schema change: no pre-migration snapshot needed"; return 0; }
  local rp="release_${M_ID//[^A-Za-z0-9]/_}"
  if [ "$NEEDS_MAINT" = true ]; then
    local c rc=0; c=$(cid ops-pinned)
    backup_busy "$c" || rc=$?; [ "$rc" -eq 1 ] || { log "BLOCK a backup is running or could not be inspected (status $rc)"; return 1; }
    docker exec -i -e TS="$(date -u +%Y%m%dT%H%M%SZ)" -e RP="$rp" "$c" sh -s <<'SNAP' | TOOL redact | tee -a "$D/snapshot.txt" || return 1
set -eu
. /ops/env.sh
umask 077
s=$(mktemp -d); trap 'rm -rf "$s"' EXIT
f="$s/school-kit-pre-release-$TS.dump"
pg_dump -Fc -f "$f"
[ "$(wc -c < "$f")" -gt 1024 ]
pg_restore --list "$f" >/dev/null
d=$(sha256sum "$f"); d=${d%% *}
printf '%s  %s\n' "$d" "$(basename "$f")" > "$f.sha256"
remote="backup:${BACKUP_BUCKET}/dumps/pre-release/$(basename "$f")"
rclone copyto "$f" "$remote"
rclone copyto "$remote" "$s/readback"
a=$(sha256sum "$s/readback"); [ "${a%% *}" = "$d" ]
rclone copyto "$f.sha256" "$remote.sha256"
echo "SNAPSHOT $(basename "$f") verified off-site"
SNAP
  fi
  # Point-in-time marker for both kinds (the WAL archive makes it a restore target).
  sql -c "SELECT pg_create_restore_point('$rp')" >/dev/null || return 1
  sql -c "SELECT pg_switch_wal()" >/dev/null || return 1
  [ "$(sql -c "SELECT coalesce(last_failed_time > last_archived_time, false) FROM pg_stat_archiver")" = f ] || { log "BLOCK the WAL archiver is failing; refusing to migrate"; return 1; }
  state_set restore_point="$rp" >/dev/null
  ok "restore point $rp recorded; WAL archiver healthy"
}
step_migrate() {
  if [ "$(pj class <<<"$PLAN")" != SCHEMA ]; then return 0; fi
  state_set mutated=true >/dev/null
  local envf rc=0; envf=$(mktemp ./.migrate-env.XXXXXX)
  printf 'DIRECT_URL=postgresql://school_kit:%s@postgres:5432/school_kit\nPGOPTIONS=-c lock_timeout=%s\n' "$(dvar SCHOOL_KIT_PASSWORD)" "${RELEASE_LOCK_TIMEOUT:-10s}" > "$envf"
  log "applying $(python3 -c 'import json,sys; print(len(json.load(sys.stdin)["pending"]))' <<<"$PLAN") pending migration(s)"
  docker run --rm --network "$(net_name)" --env-file "$envf" "$(mf migrate_image)" migrate deploy 2>&1 | TOOL redact | tee -a "$D/run.log" | tail -n 25 || rc=${PIPESTATUS[0]}
  rm -f "$envf"
  [ "$rc" = 0 ] || { event migration_failed release_id="$M_ID"; return 1; }
  MANIFEST=$M; check_migrations || return 1
  protected_assert migrate
}
step_switch() {
  write_override "$M" release.override.yml.new || return 1
  if fault corrupt_override; then printf 'services:\n  api:\n    image: [unterminated\n' > release.override.yml.new; fi
  RELEASE_OVERRIDE_FILE=release.override.yml.new rdc config --quiet || { log "BLOCK the new pins do not validate"; return 1; }
  [ ! -f release.override.yml ] || cp -p release.override.yml "$D/release.override.yml.before"
  state_set mutated=true >/dev/null
  mv -f release.override.yml.new release.override.yml || return 1
  local changed s c need up=()
  changed=$(python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["services_changed"]))' <<<"$PLAN")
  for s in "${APPLY_ORDER[@]}"; do
    service_enabled "$s" || continue
    need=0; [[ " $changed " == *" $s "* ]] && need=1
    c=$(cid "$s" || true)
    if [ -z "$c" ] || [ "$(docker inspect -f '{{.State.Running}}' "$c")" != true ]; then need=1; fi   # e.g. stopped by the quiesce step
    [ "$need" = 0 ] || up+=("$s")
  done
  for s in "${up[@]:-}"; do
    [ -n "$s" ] || continue
    log "switching $s"
    # graceful stop first (the API drains requests on SIGTERM), then create ONLY this service from the pinned image
    if [ -n "$(cid "$s" || true)" ]; then rdc stop -t "${RELEASE_STOP_GRACE:-60}" "$s" >/dev/null || true; fi
    rdc up -d --no-deps --no-build --pull never "$s" >/dev/null || { log "BLOCK compose could not start $s"; return 1; }
    wait_healthy "$s" || { log "BLOCK $s did not become healthy on the new image"; return 1; }
    protected_assert "switch $s" || return 1
  done
  ok "switched: ${up[*]:-nothing}"
}
step_verify() {
  MANIFEST=$M; PHASE=internal; BASELINE_FILE="$D/baseline/$M_ID.env"
  run_acceptance "$M" internal || return 1
  if maintenance_active; then maintenance_off || return 1; fi
  run_acceptance "$M" edge || return 1
}
promote() {
  local prev; prev=$(current_id)
  mkdir -p "$D/releases/$M_ID"; cp "$M" "$D/releases/$M_ID/manifest.json"; cp -p release.override.yml "$D/releases/$M_ID/override.yml"
  [ -z "$prev" ] || [ "$prev" = "$M_ID" ] || echo "$prev" > "$D/previous"
  echo "$M_ID" > "$D/current.new"; mv -f "$D/current.new" "$D/current"
}

# --------------------------------------------------------------------------- rollback (local images only)
rollback_core() { # target-manifest-file -> 0 done | 6 fix-forward required | 7 failed
  local target=$1 s ref rc=0
  # test-only: the old API image is removed by "someone" after the release replaced its container (an image
  # a running container uses cannot be deleted, so this is the only moment it can really go missing)
  if fault rmprev_before_rollback; then docker rmi -f "$(TOOL jget "$target" images.api)" >/dev/null 2>&1 || true; fi
  for s in $(enabled_services); do
    ref=$(TOOL jget "$target" "images.$s" 2>/dev/null) || continue
    image_present "$ref" || { log "BLOCK the rollback image for $s is not on this server; refusing to reach for the registry"; return 7; }
  done
  local f="$D/.applied.$$"; applied_rows > "$f" || { rm -f "$f"; return 7; }
  TOOL rollback-check --current "$M" --target "$target" --applied "$f" > "$D/.rbcheck.json" || rc=$?
  rm -f "$f"
  if [ "$rc" != 0 ]; then log "FIX-FORWARD the database holds a change the earlier release cannot run on: $(python3 -c 'import json; print("; ".join(json.load(open("'"$D"'/.rbcheck.json"))["reasons"]))')"; return 6; fi
  state_set phase=ROLLING_BACK >/dev/null; event rollback_started to="$(TOOL jget "$target" release_id)"
  write_override "$target" release.override.yml.new
  RELEASE_OVERRIDE_FILE=release.override.yml.new rdc config --quiet || return 7
  mv -f release.override.yml.new release.override.yml
  for s in "${APPLY_ORDER[@]}"; do
    service_enabled "$s" || continue
    TOOL jget "$target" "images.$s" >/dev/null 2>&1 || continue
    local c; c=$(cid "$s" || true)
    if [ -n "$c" ]; then
      [ "$(docker inspect -f '{{.Config.Image}}' "$c")" = "$(TOOL jget "$target" "images.$s")" ] && [ "$(docker inspect -f '{{.State.Running}}' "$c")" = true ] && continue
      rdc stop -t "${RELEASE_STOP_GRACE:-60}" "$s" >/dev/null || true
    fi
    rdc up -d --no-deps --no-build --pull never "$s" >/dev/null || return 7
    wait_healthy "$s" || { log "BLOCK $s is not healthy after the rollback"; return 7; }
  done
  # shellcheck disable=SC2034  # MANIFEST and PHASE are read by the sourced acceptance checks
  MANIFEST=$target
  # shellcheck disable=SC2034
  PHASE=rollback; CHECK_FAILED=0
  protected_assert rollback || { warn "protected infrastructure changed while the release ran: the rollback proceeds, and the alert says so"; protected_save; }
  BASELINE_FILE="$D/baseline/$M_ID.env"; [ -f "$BASELINE_FILE" ] || BASELINE_FILE=""
  # the database may legitimately hold migrations the old release does not know (rollback-check just proved them safe): classify them from the failed release's manifest
  ACCEPT_CLASS_SOURCE=$M ACCEPT_TOLERATE_UNRESOLVED=1 run_acceptance "$target" internal || { log "BLOCK the rolled-back release failed acceptance"; return 7; }
  # Whatever happened to the edge during the release, the rollback puts School Kit's Caddy blocks back and PROVES it:
  # the edge answers through Caddy and every Caddy file is byte-identical to before the release began.
  caddy_restore_original || { log "BLOCK the original Caddyfile could not be restored"; return 7; }
  run_acceptance "$target" edge || { log "BLOCK the edge is not serving after the rollback"; return 7; }
  return 0
}
handle_failure() { # step exit-code
  local step=$1 code=$2 mutated diag
  mutated=$(state_get mutated)
  diag=$(diagnose "$M_ID-$step")
  # `|| true`: no matching line is normal (a failed migration prints none), and under errexit+pipefail an empty grep would end the handler silently
  local why; why=$(grep -E ' (FAIL|BLOCK|BUSY) ' "$D/run.log" 2>/dev/null | tail -n 1 | cut -c1-300 || true)
  event failed release_id="$M_ID" step="$step" code="$code" mutated="${mutated:-false}"
  if [ "$mutated" != true ]; then
    state_set phase=ABORTED error="$step" >/dev/null
    notify release-aborted "release $M_ID stopped at $step before changing anything (exit $code). Last problem: $why. Diagnostics: $diag"
    log "ABORTED at $step: nothing was changed; the running release is untouched"; return $(( code == 4 ? 4 : 1 ))
  fi
  log "FAILED at $step after changes began: returning to the previous release from local images"
  local prev rc=0; prev=$(current_manifest)
  if [ -z "$prev" ]; then rc=7; else rollback_core "$prev" || rc=$?; fi
  case $rc in
    0) state_set phase=ROLLED_BACK error="$step" >/dev/null
       event rolled_back release_id="$M_ID" to="$(current_id)"
       notify release-rolled-back "release $M_ID failed at $step and the service was returned to $(current_id). Last problem: $why. Diagnostics: $diag"
       log "ROLLED BACK to $(current_id)"; return 1 ;;
    6) maintenance_active || maintenance_on "$M_ID" >/dev/null 2>&1 || true
       state_set phase=FIX_FORWARD_REQUIRED error="$step" >/dev/null
       event fix_forward_required release_id="$M_ID"
       notify fix-forward "release $M_ID failed at $step and cannot be rolled back (a breaking migration is applied). Ingress is in maintenance. Ship a corrected release. Last problem: $why. Diagnostics: $diag"
       return 6 ;;
    *) maintenance_active || maintenance_on "$M_ID" >/dev/null 2>&1 || true
       state_set phase=ROLLBACK_FAILED error="$step" >/dev/null
       event rollback_failed release_id="$M_ID"
       notify rollback-failed "ROLLBACK FAILED for $M_ID after $step. Maintenance is ON. An operator must act. Last problem: $why. Diagnostics: $diag"
       return 7 ;;
  esac
}

run_step() { # name fn
  if phase_ge "$1"; then info "step $1 already done (resume)"; return 0; fi
  log "step $1"
  local rc=0; "$2" || rc=$?
  [ "$rc" = 0 ] || { STEP_FAILED=$1; return "$rc"; }
  state_set phase="$1" >/dev/null; event phase name="$1" release_id="$M_ID"
  if fault "kill_after_$1"; then log "FAULT killing the release process after $1"; kill -9 $$; fi
  if fault "rmprev_after_$1"; then docker rmi -f "$(TOOL jget "$(current_manifest)" images.api)" >/dev/null 2>&1 || true; fi
  if fault "pause_after_$1"; then while [ ! -f "$D/.continue" ]; do sleep 1; done; rm -f "$D/.continue"; fi
}
pipeline() {
  run_step STAGED step_stage || return $?
  run_step PREFLIGHT_OK step_preflight || return $?
  run_step QUIESCED step_quiesce || return $?
  run_step SNAPSHOT_DONE step_snapshot || return $?
  run_step MIGRATED step_migrate || return $?
  run_step SWITCHED step_switch || return $?
  run_step VERIFIED step_verify || return $?
}

cmd_apply() {
  local mfile="" RELEASE_TRIGGER=manual detach=0 fixfwd=0 child=0 resume=0
  while [ $# -gt 0 ]; do case $1 in
    --trigger) RELEASE_TRIGGER=$2; shift 2 ;; --detach) detach=1; shift ;; --fix-forward) fixfwd=1; shift ;;
    --_child) child=1; shift ;; --_resume) resume=1; shift ;; -*) usage ;; *) mfile=$1; shift ;; esac; done
  [ -n "$mfile" ] || usage
  case $RELEASE_TRIGGER in auto|manual) ;; *) usage ;; esac
  if [ "$detach" = 1 ] && [ "$child" = 0 ]; then
    # The release runs on the server, detached from this SSH session: a lost connection cannot interrupt it.
    local rid; rid="run-$(date -u +%Y%m%dT%H%M%SZ)-$$"
    local args=("$mfile" --trigger "$RELEASE_TRIGGER" --_child); [ "$fixfwd" = 0 ] || args+=(--fix-forward)
    RELEASE_RUN_ID=$rid setsid nohup "$0" apply "${args[@]}" >> "$D/run.log" 2>&1 < /dev/null &
    local i; for i in $(seq 1 40); do
      [ "$(state_get run_id)" = "$rid" ] && { echo "started $rid (follow with: release.sh status)"; return 0; }
      kill -0 $! 2>/dev/null || { wait $! || true; echo "the detached release ended at once: see release.sh status and $D/run.log" >&2; return 5; }
      sleep 0.5
    done
    echo "started (state not yet written): $rid"; return 0
  fi
  exec 9>"$D/apply.lock"; flock -n 9 || fail_exit 5 "another release is running"
  cutover_busy && fail_exit 3 "the coordinated cutover is in progress (release/state); a routine release cannot start"
  [ -n "$(current_id)" ] || fail_exit 3 "no baseline release: run release.sh adopt --manifest <current manifest> first"
  if [ "$RELEASE_TRIGGER" = auto ] && [ ! -f "$D/AUTO_ENABLED" ]; then fail_exit 3 "automatic deployment is not switched on at this server (no $D/AUTO_ENABLED)"; fi
  load_manifest "$mfile"
  local prior; prior=$(state_get phase)
  if [ "$resume" = 1 ]; then
    [ "$M_ID" = "$(state_get release_id)" ] || fail_exit 3 "the state belongs to a different release"
    state_set run_id="${RELEASE_RUN_ID:-resume-$$}" >/dev/null
    event resumed release_id="$M_ID" from="$prior"
  else
    case $prior in
      ''|COMPLETE|ROLLED_BACK|ABORTED) ;;
      FIX_FORWARD_REQUIRED) [ "$fixfwd" = 1 ] || fail_exit 3 "state is FIX_FORWARD_REQUIRED: apply the corrected release with --fix-forward (it needs an approval)" ;;
      *) fail_exit 3 "state is $prior: run 'release.sh resume' or 'release.sh rollback', not a new release" ;;
    esac
    state_set phase=PLANNED release_id="$M_ID" manifest_sha256="$M_SHA" trigger="$RELEASE_TRIGGER" run_id="${RELEASE_RUN_ID:-run-$$}" \
      started_at="$(date -u +%FT%TZ)" mutated=false error= previous_release="$(current_id)" fix_forward="$fixfwd" >/dev/null
    event started release_id="$M_ID" trigger="$RELEASE_TRIGGER" manifest_sha256="$M_SHA"
  fi
  if [ "$resume" = 1 ] && [ -s "$D/plan.json" ]; then PLAN=$(cat "$D/plan.json")   # the plan the release started under, not one recomputed after a half-applied migration
  else
    PLAN=$(make_plan) || { state_set phase=ABORTED error=plan >/dev/null; fail_exit 1 "the plan could not be computed"; }
    printf '%s\n' "$PLAN" > "$D/plan.json"
  fi
  event planned release_id="$M_ID" class="$(pj class <<<"$PLAN")"
  info "plan: class=$(pj class <<<"$PLAN") services=$(pj services_changed <<<"$PLAN") maintenance=$(pj needs_maintenance <<<"$PLAN") rollback-after=$(pj rollback_allowed_after <<<"$PLAN")"
  if [ "$(pj class <<<"$PLAN")" = NOOP ]; then state_set phase=COMPLETE >/dev/null; ok "nothing to do: $M_ID is already running"; return 0; fi
  # Approval gates. Schema changes, destructive operations and --fix-forward never run on the strength of a green build alone.
  if [ "$(pj needs_approval <<<"$PLAN")" = true ] || [ "$fixfwd" = 1 ]; then
    approval_ok "$(pj destructive <<<"$PLAN")" || { state_set phase=ABORTED error=approval >/dev/null; fail_exit 3 "this release needs an owner approval bound to manifest ${M_SHA:0:12} (release.sh approve); destructive=$(pj destructive <<<"$PLAN")"; }
    ok "owner approval found for ${M_SHA:0:12}"
  fi
  [ -z "$(pj blockers <<<"$PLAN" | tr -d '[]')" ] || { state_set phase=ABORTED error=blockers >/dev/null; fail_exit 3 "blockers: $(pj blockers <<<"$PLAN")"; }
  NEEDS_MAINT=$(pj needs_maintenance <<<"$PLAN")
  STEP_FAILED=""
  local rc=0
  pipeline || rc=$?
  if [ "$rc" != 0 ]; then handle_failure "${STEP_FAILED:-pipeline}" "$rc"; return $?; fi
  promote
  state_set phase=COMPLETE error= >/dev/null
  event completed release_id="$M_ID" class="$(pj class <<<"$PLAN")"
  ok "release $M_ID is live (previous: $(cat "$D/previous" 2>/dev/null || echo none))"
}

# --------------------------------------------------------------------------- the other commands
cmd_status() {
  local phase run_state lock=free; phase=$(state_get phase)
  exec 8>"$D/apply.lock"; flock -n 8 || lock=held
  if ! terminal && [ "$lock" = free ]; then run_state=INTERRUPTED; elif [ "$lock" = held ]; then run_state=RUNNING; else run_state=IDLE; fi
  if [ "${1:-}" = --json ]; then
    python3 - "$D" "$run_state" "$(current_id)" "$(cat "$D/previous" 2>/dev/null || true)" "$([ -f "$D/MAINTENANCE" ] && echo true || echo false)" <<'PY'
import json, sys
d, run, cur, prev, maint = sys.argv[1:6]
try: st = json.load(open(d + "/state.json"))
except OSError: st = {}
print(json.dumps({"run": run, "current": cur, "previous": prev, "maintenance": maint == "true", "state": st}, indent=2, sort_keys=True))
PY
  else
    echo "run:         $run_state"; echo "phase:       ${phase:-none}"; echo "release:     $(state_get release_id)"
    echo "current:     $(current_id)"; echo "previous:    $(cat "$D/previous" 2>/dev/null || echo none)"
    echo "maintenance: $([ -f "$D/MAINTENANCE" ] && cat "$D/MAINTENANCE" || echo off)"; echo "error:       $(state_get error)"
    case $phase in FIX_FORWARD_REQUIRED) echo "next:        ship a corrected release: release.sh apply <manifest> --fix-forward (needs approval)";;
      ROLLBACK_FAILED) echo "next:        an operator must act: read $D/diagnostics, fix, then release.sh rollback or release.sh resume";; esac
  fi
}
cmd_resume() {
  local phase; phase=$(state_get phase)
  terminal && { echo "nothing to resume (state: ${phase:-none})"; return 0; }
  case $phase in FIX_FORWARD_REQUIRED|ROLLBACK_FAILED) fail_exit 3 "$phase cannot be resumed: see 'release.sh status'" ;; esac
  exec 9>"$D/apply.lock"; flock -n 9 || fail_exit 5 "a release is still running"
  exec 9>&-
  log "resuming $(state_get release_id) from $phase"
  if [ "$phase" = ROLLING_BACK ]; then
    exec 9>"$D/apply.lock"; flock -n 9 || exit 5
    load_manifest "$D/staging/$(state_get release_id).json"
    local rc=0; rollback_core "$(current_manifest)" || rc=$?
    [ "$rc" = 0 ] && { state_set phase=ROLLED_BACK >/dev/null; ok "rollback completed"; return 0; }
    return "$rc"
  fi
  cmd_apply "$D/staging/$(state_get release_id).json" --trigger "$(state_get trigger)" --_resume
}
cmd_abort() {
  terminal && { echo "nothing to abort"; return 0; }
  exec 9>"$D/apply.lock"; flock -n 9 || fail_exit 5 "a release is still running"
  [ "$(state_get mutated)" != true ] || fail_exit 3 "changes have begun: use 'release.sh rollback'"
  state_set phase=ABORTED error=operator >/dev/null; event aborted release_id="$(state_get release_id)"; ok "aborted before any change"
}
cmd_rollback() {
  local to=""; [ "${1:-}" != --to ] || to=$2
  exec 9>"$D/apply.lock"; flock -n 9 || fail_exit 5 "a release is running"
  cutover_busy && fail_exit 3 "the coordinated cutover is in progress"
  local phase cur rc=0; phase=$(state_get phase); cur=$(current_id)
  if [ "$phase" = ROLLBACK_FAILED ] || [ "$phase" = ROLLING_BACK ]; then
    # A release failed and its automatic rollback did not finish: the aim is to put the CURRENT release (the one
    # that was running before it) back, judged against the database the failed release left behind.
    M=$D/staging/$(state_get release_id).json; M_ID=$(state_get release_id)
    [ -f "$M" ] && [ -n "$cur" ] && [ -f "$D/releases/$cur/manifest.json" ] || fail_exit 3 "the failed release's manifest or the current release's manifest is missing"
    rollback_core "$D/releases/$cur/manifest.json" || rc=$?
    case $rc in
      0) state_set phase=ROLLED_BACK error= >/dev/null; event rollback release_id="$cur" from="$M_ID" by=operator; ok "the current release $cur is serving again (local images)"; return 0 ;;
      6) fail_exit 6 "the database holds a breaking change: fix-forward, do not roll back" ;;
      *) fail_exit 7 "rollback failed again: see $D/diagnostics" ;;
    esac
  fi
  [ -n "$to" ] || to=$(cat "$D/previous" 2>/dev/null || true)
  [ -n "$to" ] && [ -f "$D/releases/$to/manifest.json" ] || fail_exit 3 "no rollback target (${to:-none}) is recorded"
  M=$D/releases/$cur/manifest.json; M_ID=$cur
  [ -f "$M" ] || fail_exit 3 "the current release's manifest is missing"
  rollback_core "$D/releases/$to/manifest.json" || rc=$?
  case $rc in
    0) echo "$cur" > "$D/previous"; echo "$to" > "$D/current.new"; mv -f "$D/current.new" "$D/current"
       state_set phase=ROLLED_BACK release_id="$to" error= >/dev/null; event rollback release_id="$to" from="$cur" by=operator; ok "rolled back from $cur to $to (local images)"; return 0 ;;
    6) fail_exit 6 "the database holds a breaking change: fix-forward, do not roll back" ;;
    *) fail_exit 7 "rollback failed: see $D/diagnostics" ;;
  esac
}
cmd_resolve_migration() {
  local name=${1:?migration name}
  [ "${RELEASE_APPROVED:-}" = true ] || fail_exit 3 "export RELEASE_APPROVED=true for this one command"
  terminal || fail_exit 3 "a release is in progress"
  exec 9>"$D/apply.lock"; flock -n 9 || fail_exit 5 "a release is running"
  [ "$(sql -c "SELECT count(*) FROM _prisma_migrations WHERE migration_name='$(printf '%s' "$name" | tr -cd 'a-z0-9_')' AND finished_at IS NULL AND rolled_back_at IS NULL")" = 1 ] || fail_exit 3 "$name is not an unresolved (failed) migration"
  M=$(current_manifest); local envf rc=0; envf=$(mktemp ./.migrate-env.XXXXXX)
  printf 'DIRECT_URL=postgresql://school_kit:%s@postgres:5432/school_kit\n' "$(dvar SCHOOL_KIT_PASSWORD)" > "$envf"
  docker run --rm --network "$(net_name)" --env-file "$envf" "$(mf migrate_image)" migrate resolve --rolled-back "$name" || rc=$?
  rm -f "$envf"; [ "$rc" = 0 ] || fail_exit 1 "resolve failed"
  event migration_resolved name="$name"; ok "$name marked rolled back; a corrected release can now be applied"
}
cmd_maintenance() {
  case ${1:-} in
    on) exec 9>"$D/apply.lock"; flock -n 9 || fail_exit 5 "a release is running"; maintenance_on manual ;;
    off) exec 9>"$D/apply.lock"; flock -n 9 || fail_exit 5 "a release is running"; maintenance_off ;;
    status) if [ -f "$D/MAINTENANCE" ]; then cat "$D/MAINTENANCE"; else echo off; fi ;;
    *) usage ;;
  esac
}

cmd=${1:-}; shift || true
case $cmd in
  adopt) cmd_adopt "$@" ;;
  plan) cmd_plan "$@" ;;
  stage) cmd_stage "$@" ;;
  approve) cmd_approve "$@" ;;
  apply) cmd_apply "$@" ;;
  status) cmd_status "$@" ;;
  resume) cmd_resume ;;
  abort) cmd_abort ;;
  rollback) cmd_rollback "$@" ;;
  resolve-migration) cmd_resolve_migration "$@" ;;
  maintenance) cmd_maintenance "$@" ;;
  history) tail -n "${1:-20}" "$D/history.jsonl" 2>/dev/null || true ;;
  show-current) f=$(current_manifest); [ -n "$f" ] && cat "$f" || { echo "no baseline release" >&2; exit 3; } ;;
  diagnostics) diagnose manual ;;
  *) usage ;;
esac
