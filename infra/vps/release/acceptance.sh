#!/usr/bin/env bash
# Automated production acceptance. Read-only: it never writes to the database, never starts a
# payment, never sends a message, and prints no secret (all output is redacted).
#
#   acceptance.sh <manifest.json> internal|edge|all [--save-baseline FILE | --baseline FILE]
#
# Two kinds of failure, deliberately kept apart:
#   transient   an application is still starting (probes, worker, edge). Retried for
#               RELEASE_ACCEPT_WINDOW seconds; if it never comes up it is reported as
#               "STARTUP_NOT_READY", which is a genuine failure of THIS release.
#   integrity   identities, migrations, money and queue invariants. Never retried:
#               waiting does not make a duplicate payment reference go away.
# Money counters are compared with a baseline taken BEFORE the release, so a pre-existing
# anomaly in real data does not block a release, while any NEW one does. Two counters have no
# tolerance at all (the owner's gates from the cutover): duplicate Paystack references and a
# payment allocated above its amount.
set -Eeuo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"

ACCEPT_WINDOW=${RELEASE_ACCEPT_WINDOW:-90}
BASELINE_FILE=${BASELINE_FILE:-}
SAVE_BASELINE=${SAVE_BASELINE:-}

manifest_ref() { TOOL jget "$MANIFEST" "images.$1"; }

retry_transient() { # name fn
  local start=$SECONDS before
  while :; do
    before=$CHECK_FAILED; CHECK_FAILED=0
    if "$2" quiet; then CHECK_FAILED=$before; "$2" loud; return 0; fi
    if [ $((SECONDS - start)) -ge "$ACCEPT_WINDOW" ]; then
      CHECK_FAILED=$before; log "STARTUP_NOT_READY $1 did not become ready within ${ACCEPT_WINDOW}s"; "$2" loud || true
      CHECK_FAILED=1; return 1
    fi
    CHECK_FAILED=$before; sleep "${RELEASE_ACCEPT_SLEEP:-3}"
  done
}
say() { # mode kind msg: quiet runs print nothing
  [ "$1" = loud ] || return 0
  case $2 in ok) ok "$3" ;; bad) bad "$3" ;; esac
}

# --- identities -----------------------------------------------------------------------------
check_images() {
  local s ref c img id want pass=0 restarts
  for s in $(enabled_services); do
    ref=$(manifest_ref "$s" 2>/dev/null || true)
    [ -n "$ref" ] || { [ "$s" = cbt ] && continue; bad "image $s: the manifest has none"; pass=1; continue; }
    c=$(cid "$s" || true)
    if [ -z "$c" ]; then bad "$s is not running"; pass=1; continue; fi
    img=$(docker inspect -f '{{.Config.Image}}' "$c"); id=$(docker inspect -f '{{.Image}}' "$c")
    want=$(docker image inspect -f '{{.Id}}' "$ref" 2>/dev/null || true)
    if [ "$img" = "$ref" ] && [ -n "$want" ] && [ "$id" = "$want" ]; then ok "$s runs the manifest image (sha256:${ref##*@sha256:})"; else bad "$s does NOT run the manifest image"; pass=1; fi
    restarts=$(docker inspect -f '{{.RestartCount}}' "$c")
    if [ "$restarts" -gt "${RELEASE_MAX_RESTARTS:-2}" ] || [ "$(docker inspect -f '{{.State.Restarting}}' "$c")" = true ]; then bad "$s is crash-looping (restarts=$restarts)"; pass=1; fi
  done
  return $pass
}
check_protected() { protected_assert "$PHASE" && ok "protected infrastructure is unchanged (PostgreSQL, Redis, Caddy, the pinned scheduler, the stopped original ops, backup.env)"; }

# --- database ---------------------------------------------------------------------------------
applied_rows() {
  sql -c "SELECT migration_name||E'\t'||checksum||E'\t'||CASE WHEN finished_at IS NOT NULL THEN 't' ELSE 'f' END||E'\t'||CASE WHEN rolled_back_at IS NOT NULL THEN 't' ELSE 'f' END FROM _prisma_migrations ORDER BY migration_name"
}
check_migrations() {
  local f="$D/.applied.$$" plan
  applied_rows > "$f" || { rm -f "$f"; bad "_prisma_migrations could not be read"; return 1; }
  plan=$(TOOL plan --manifest "$MANIFEST" --applied "$f" --current "${ACCEPT_CLASS_SOURCE:-$MANIFEST}") || { rm -f "$f"; bad "migration plan failed"; return 1; }
  rm -f "$f"
  local pending blockers
  pending=$(python3 -c 'import json,sys; print(len(json.load(sys.stdin)["pending"]))' <<<"$plan")
  blockers=$(python3 -c 'import json,sys; print(",".join(json.load(sys.stdin)["blockers"]))' <<<"$plan")
  # After a ROLLBACK the failed migration that caused it is still recorded, unresolved. That is the expected
  # state (the next release is blocked until `resolve-migration`), not a reason to call the rollback failed.
  if [ "${ACCEPT_TOLERATE_UNRESOLVED:-}" = 1 ] && [[ $blockers == UNRESOLVED_MIGRATION:* ]] && [[ $blockers != *,* ]]; then
    warn "a failed migration is recorded as unresolved (${blockers#UNRESOLVED_MIGRATION:}): the next release is blocked until release.sh resolve-migration"
    blockers=""
  fi
  if [ "$pending" = 0 ] && [ -z "$blockers" ]; then ok "every manifest migration is applied with its recorded checksum; none unresolved"; return 0; fi
  bad "migration status: pending=$pending blockers=${blockers:-none}"; return 1
}
INTEGRITY_SQL=$(cat <<'SQL'
BEGIN READ ONLY;
SELECT 'missing_table|'||t FROM unnest(ARRAY['payments','invoices','payment_plans','payment_plan_installments','paystack_webhook_inbox']) t WHERE to_regclass('public.'||t) IS NULL;
SELECT 'dup_paystack_refs|'||count(*) FROM (SELECT school_id, paystack_reference FROM payments WHERE paystack_reference IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) d;
SELECT 'payment_over_allocated|'||count(*) FROM payments WHERE allocated_kobo IS NOT NULL AND allocated_kobo > amount;
SELECT 'invoice_over_collected|'||count(*) FROM (SELECT p.invoice_id FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.status = 'SUCCESS' AND i.status NOT IN ('CANCELLED', 'REFUNDED') GROUP BY p.invoice_id, i.total_due HAVING sum(COALESCE(p.allocated_kobo, p.amount)) > i.total_due) x;
SELECT 'invoice_total_mismatch|'||count(*) FROM invoices WHERE total_due <> total_amount - total_discount;
SELECT 'invoice_negative_paid|'||count(*) FROM invoices WHERE total_paid < 0;
SELECT 'invoice_paid_without_money|'||count(*) FROM invoices WHERE status = 'PAID' AND total_paid < total_due;
SELECT 'instalment_sum_mismatch|'||count(*) FROM (SELECT pl.id FROM payment_plans pl JOIN invoices i ON i.id = pl.invoice_id JOIN payment_plan_installments pi ON pi.plan_id = pl.id WHERE i.status <> 'CANCELLED' GROUP BY pl.id, i.total_due HAVING sum(pi.amount) <> i.total_due) y;
SELECT 'instalment_nonpositive|'||count(*) FROM payment_plan_installments WHERE amount <= 0;
SELECT 'payment_orphan_instalment|'||count(*) FROM payments p WHERE p.installment_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM payment_plan_installments pi WHERE pi.id = p.installment_id);
SELECT 'webhook_unprocessed|'||count(*) FROM paystack_webhook_inbox WHERE processed_at IS NULL AND dead_at IS NULL;
SELECT 'webhook_stale|'||count(*) FROM paystack_webhook_inbox WHERE processed_at IS NULL AND dead_at IS NULL AND received_at < now() - interval '10 minutes';
SELECT 'webhook_dead|'||count(*) FROM paystack_webhook_inbox WHERE dead_at IS NOT NULL AND processed_at IS NULL;
SELECT 'webhook_stuck_claim|'||count(*) FROM paystack_webhook_inbox WHERE processed_at IS NULL AND dead_at IS NULL AND claimed_until IS NOT NULL AND claimed_until < now() - interval '10 minutes';
SELECT 'runtime_role_privileged|'||count(*) FROM pg_roles WHERE rolname = 'app_user' AND (rolsuper OR rolbypassrls);
COMMIT;
SQL
)
integrity_counts() { sql -c "$INTEGRITY_SQL" | grep '|' ; }
ZERO_TOLERANCE=" dup_paystack_refs payment_over_allocated runtime_role_privileged "
check_integrity() {
  local rows k v b pass=0
  rows=$(integrity_counts) || { bad "the integrity queries could not run"; return 1; }
  if [ -n "$SAVE_BASELINE" ]; then printf '%s\n' "$rows" | tr '|' '=' > "$SAVE_BASELINE"; info "baseline saved ($(wc -l < "$SAVE_BASELINE") counters)"; fi
  while IFS='|' read -r k v; do
    [ -n "$k" ] || continue
    if [ "$k" = missing_table ]; then bad "table $v does not exist"; pass=1; continue; fi
    b=0; [ -z "$BASELINE_FILE" ] || b=$(sed -n "s/^$k=//p" "$BASELINE_FILE" | head -n 1); b=${b:-0}
    case $k in
      webhook_unprocessed) if [ "$v" -gt "${RELEASE_WEBHOOK_BACKLOG_MAX:-200}" ]; then bad "webhook backlog is abnormal: $v unprocessed events"; pass=1; else ok "webhook inbox backlog is normal ($v unprocessed)"; fi; continue ;;
      webhook_stale) if [ "$v" -gt "${RELEASE_WEBHOOK_STALE_MAX:-3}" ]; then bad "$v webhook events have waited over 10 minutes"; pass=1; else ok "no abnormal webhook waits ($v older than 10 minutes)"; fi; continue ;;
    esac
    if [[ $ZERO_TOLERANCE == *" $k "* ]]; then
      if [ "$v" = 0 ]; then ok "$k = 0"; else bad "$k = $v (no tolerance)"; pass=1; fi
    elif [ "$v" -gt "$b" ]; then bad "$k rose from $b to $v since before the release"; pass=1
    elif [ "$v" -gt 0 ]; then warn "$k = $v (unchanged from before the release; investigate, not caused by it)"
    else ok "$k = 0"; fi
  done <<<"$rows"
  return $pass
}

# --- applications -------------------------------------------------------------------------------
check_health() { # mode
  local s fail=0 body
  for s in $(enabled_services); do
    if probe_service "$s"; then say "$1" ok "$s answers its health probe"; else say "$1" bad "$s does not answer its health probe"; fail=1; fi
  done
  body=$(curl -fsS -m 5 "${RELEASE_PROBE_API_DB:-http://127.0.0.1:4000/api/v1/health/db}" 2>/dev/null || true)
  if grep -Eq '"role" ?: ?"app_user"' <<<"$body"; then say "$1" ok "the API reaches the database as app_user"; else say "$1" bad "the API does not report the app_user database role"; fail=1; fi
  return $fail
}
check_workers() { # mode
  local fail=0 w r
  w=$(cid render-worker || true)
  if [ -n "$w" ] && [ "$(docker inspect -f '{{.State.Running}}' "$w")" = true ] && probe_service render-worker; then say "$1" ok "the render worker is running and ready"; else say "$1" bad "the render worker is not ready"; fail=1; fi
  r=$(docker exec "$(cid redis)" redis-cli ping 2>/dev/null | tr -d '\r' || true)
  if [ "$r" = PONG ]; then say "$1" ok "Redis answers (queues reachable)"; else say "$1" bad "Redis does not answer"; fail=1; fi
  return $fail
}
queue_active() { local n=0 k; for k in $(docker exec "$(cid redis)" redis-cli --scan --pattern 'bull:*:active' | tr -d '\r'); do n=$((n + $(docker exec "$(cid redis)" redis-cli llen "$k" | tr -d '\r'))); done; echo "$n"; }

# --- backups -------------------------------------------------------------------------------------
backup_age_hours() { # prints age in hours of the newest complete daily dump (empty on failure)
  local c list newest ts epoch
  c=$(cid ops-pinned || true); [ -n "$c" ] || return 1
  list=$(docker exec "$c" sh -c '. /ops/env.sh; rclone lsf --files-only "backup:${BACKUP_BUCKET}/dumps/daily"' 2>/dev/null) || return 1
  newest=$(printf '%s\n' "$list" | grep -E '^school-kit-[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z[.]dump[.]sha256$' | sort -r | head -n 1) || true
  [ -n "$newest" ] || return 1
  printf '%s\n' "$list" | grep -qxF "${newest%.sha256}" || return 1       # a marker without its dump is not a backup
  ts=${newest#school-kit-}; ts=${ts%%.dump*}
  epoch=$(date -u -d "${ts:0:10} ${ts:11:2}:${ts:13:2}:${ts:15:2}" +%s) || return 1
  echo $(( ($(date -u +%s) - epoch) / 3600 ))
}
check_backups() {
  local c n age max=${RELEASE_BACKUP_MAX_AGE_HOURS:-26}
  c=$(cid ops-pinned || true)
  if [ -z "$c" ] || [ "$(docker inspect -f '{{.State.Running}}' "$c")" != true ]; then bad "the pinned backup scheduler is not running"; return 1; fi
  n=$(docker top "$c" -eo pid,args | awk 'NR > 1 { c = $2; sub(/.*\//, "", c); if (c == "cron" || c == "crond") n++ } END { print n + 0 }')
  [ "$n" = 1 ] && ok "exactly one cron in the pinned scheduler" || { bad "the scheduler has $n cron processes (expected 1)"; return 1; }
  if age=$(backup_age_hours); then
    if [ "$age" -le "$max" ]; then ok "newest complete off-site dump is ${age}h old (limit ${max}h)"; else bad "newest complete off-site dump is ${age}h old (limit ${max}h)"; return 1; fi
  else bad "the off-site backup listing could not be read or holds no complete dump"; return 1; fi
  local o; o=$(cid_any ops || true)
  if [ -n "$o" ] && [ "$(docker inspect -f '{{.State.Running}}' "$o")" = true ]; then bad "the original ops container is running (two schedulers)"; return 1; fi
}

# --- runtime gates (names and on/off values only; these are not secrets) -------------------------
check_gates() {
  local f="${RELEASE_GATES_FILE:-$here/gates.conf}" k v have a fail=0
  a=$(cid api || true); [ -n "$a" ] || { bad "gates: the API is not running"; return 1; }
  while IFS='=' read -r k v; do
    case $k in ''|'#'*) continue ;; esac
    have=$(docker exec "$a" printenv "$k" 2>/dev/null || true)
    if [ "$have" = "$v" ]; then ok "gate $k=$v"; else bad "gate $k is not '$v' in the running API"; fail=1; fi
  done < "$f"
  return $fail
}

# --- edge ---------------------------------------------------------------------------------------
caddy_fingerprint() { { sha256sum Caddyfile; ls sites/*.caddy 2>/dev/null | sort | xargs -r sha256sum; } | sha256sum | cut -c1-16; }
# The fingerprint Caddy's files WILL have once an open maintenance window is closed (a fix-forward starts inside one):
# the original Caddyfile and original school-address site, with every other site file as it is.
caddy_fingerprint_original() {
  local t f; t=$(mktemp -d); mkdir -p "$t/sites"
  cp "$D/Caddyfile.pre-release" "$t/Caddyfile"
  for f in sites/*.caddy; do [ -f "$f" ] && cp "$f" "$t/$f"; done
  if [ -f "$D/sites.pre-release/school-addresses.caddy" ]; then cp "$D/sites.pre-release/school-addresses.caddy" "$t/sites/school-addresses.caddy"; fi
  (cd "$t" && caddy_fingerprint); rm -rf "$t"
}
check_edge() { # mode
  local fail=0 h code
  if maintenance_active; then say "$1" bad "the edge is still in maintenance"; return 1; fi
  if caddy_exec caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then say "$1" ok "the live Caddy configuration validates"; else say "$1" bad "the live Caddy configuration does not validate"; fail=1; fi
  for h in API WEB PORTAL; do
    [ "$(grep -Fxc "{\$${h}_HOST} {" Caddyfile)" = 1 ] || { say "$1" bad "Caddyfile needs exactly one $h host block"; fail=1; }
  done
  code=$(edge_code /api/v1/health)
  if [ "$code" = 200 ]; then say "$1" ok "the public API address answers 200 through Caddy"; else say "$1" bad "the public API address answers $code through Caddy"; fail=1; fi
  local wh ph web portal
  wh=$(dvar WEB_HOST); wh=${wh#http://}; wh=${wh#https://}; wh=${wh%%:*}
  ph=$(dvar PORTAL_HOST); ph=${ph#http://}; ph=${ph#https://}; ph=${ph%%:*}
  web=$(curl -sS -o /dev/null -m 10 -w '%{http_code}' --resolve "$wh:${RELEASE_EDGE_PORT:-443}:127.0.0.1" "${RELEASE_EDGE_SCHEME:-https}://$wh:${RELEASE_EDGE_PORT:-443}/staff/login" 2>/dev/null || echo 000)
  portal=$(curl -sS -o /dev/null -m 10 -w '%{http_code}' --resolve "$ph:${RELEASE_EDGE_PORT:-443}:127.0.0.1" "${RELEASE_EDGE_SCHEME:-https}://$ph:${RELEASE_EDGE_PORT:-443}/api/health" 2>/dev/null || echo 000)
  if [ "$web" = 200 ]; then say "$1" ok "the staff app answers 200 through Caddy"; else say "$1" bad "the staff app answers $web through Caddy"; fail=1; fi
  if [ "$portal" = 200 ]; then say "$1" ok "the parent portal answers 200 through Caddy"; else say "$1" bad "the parent portal answers $portal through Caddy"; fail=1; fi
  return $fail
}
check_caddy_untouched() {
  [ -f "$D/caddy.fingerprint" ] || { warn "no Caddy fingerprint was recorded for this release"; return 0; }
  if [ "$(caddy_fingerprint)" = "$(cat "$D/caddy.fingerprint")" ]; then ok "Caddyfile and every site file (BetGenius, school domains, the rest) are byte-for-byte as before the release"; else bad "Caddyfile or a site file differs from before the release"; return 1; fi
}

run_acceptance() { # manifest scope
  MANIFEST=$1; local scope=$2
  PHASE=$scope; CHECK_FAILED=0
  if [ "$scope" = internal ] || [ "$scope" = all ]; then
    check_images || CHECK_FAILED=1
    check_protected || CHECK_FAILED=1
    check_migrations || CHECK_FAILED=1
    check_integrity || CHECK_FAILED=1
    check_backups || CHECK_FAILED=1
    check_gates || CHECK_FAILED=1
    retry_transient "application health" check_health || CHECK_FAILED=1
    retry_transient "background worker readiness" check_workers || CHECK_FAILED=1
    info "active background jobs: $(queue_active)"
  fi
  if [ "$scope" = edge ] || [ "$scope" = all ]; then
    retry_transient "edge routing" check_edge || CHECK_FAILED=1
    check_caddy_untouched || CHECK_FAILED=1
  fi
  if [ "$CHECK_FAILED" = 0 ]; then ok "acceptance ($scope) passed"; else bad "acceptance ($scope) FAILED"; fi
  return "$CHECK_FAILED"
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
  cd "$SK_DIR"
  MANIFEST=${1:?usage: acceptance.sh <manifest.json> internal|edge|all [--save-baseline F|--baseline F]}
  scope=${2:?scope}; shift 2
  SAVE_BASELINE=""
  while [ $# -gt 0 ]; do
    case $1 in --save-baseline) SAVE_BASELINE=$2; shift 2 ;; --baseline) BASELINE_FILE=$2; shift 2 ;; *) echo "unknown option $1" >&2; exit 64 ;; esac
  done
  [ -f "$D/protected.snapshot" ] || protected_save
  run_acceptance "$MANIFEST" "$scope"
fi
