#!/usr/bin/env bash
# shellcheck disable=SC2034,SC2155
# Shared by release.sh, acceptance.sh, monitor.sh and cleanup.sh (sourced, never executed).
#
# Rules every function here follows (they are what the qualification suite proves):
#   * fail closed: a failed inspection is an error, never "nothing found";
#   * nothing printed or journaled can carry a secret (everything passes release_tool.py redact);
#   * only the named application services are ever created, recreated, stopped or removed:
#     never PostgreSQL, Redis, Caddy, the backup scheduler (ops-pinned) or the stopped original ops;
#     never `down`, never `--remove-orphans`, never `--build`, never a volume or an image prune;
#   * state lives in $D (default /opt/school-kit/deployments), written atomically, so a lost
#     SSH connection, a killed process or a reboot leaves a record `release.sh resume` can use.
SK_DIR=${SK_DIR:-/opt/school-kit}
RT_DIR=${RT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}
D=${RELEASE_DATA:-$SK_DIR/deployments}
TOOL() { python3 "$RT_DIR/release_tool.py" "$@"; }
SERVICES_ALL=(render-worker api web portal cbt)

# --------------------------------------------------------------------------- logging
umask 077
mkdir -p "$D" 2>/dev/null || true
log()  { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | TOOL redact | tee -a "$D/run.log" 2>/dev/null; }
ok()   { log "PASS $*"; }
bad()  { log "FAIL $*"; CHECK_FAILED=1; }
info() { log "INFO $*"; }
warn() { log "WARN $*"; }
event() { TOOL event --file "$D/history.jsonl" "$@" || true; }   # event KIND k=v ...
state_get() { TOOL state get --file "$D/state.json" 2>/dev/null | python3 -c 'import json,sys
v = json.load(sys.stdin).get(sys.argv[1], "")
print(str(v).lower() if isinstance(v, bool) else v)' "$1" 2>/dev/null || true; }
state_set() { TOOL state set --file "$D/state.json" "$@"; }
CHECK_FAILED=0

# --------------------------------------------------------------------------- compose (scoped)
# Same file order as the operators' tooling (ops-tools/lib.sh `dco`): base, adopted overlays,
# the pinned scheduler override, and the release override LAST, so a plain compose command can
# never fall back to the APP_TAG image.
rdc() {
  local files=(-f "${SK_COMPOSE_FILE:-docker-compose.yml}") x
  if [ -s "$D/compose-extra" ]; then
    while IFS= read -r x; do [ -z "$x" ] || files+=(-f "$x"); done < "$D/compose-extra"
  fi
  [ ! -f backup-ops.override.yml ] || files+=(-f backup-ops.override.yml)
  local rel=${RELEASE_OVERRIDE_FILE:-release.override.yml}
  [ ! -f "$rel" ] || files+=(-f "$rel")
  docker compose --env-file deploy.env "${files[@]}" "$@"
}
cid() { rdc ps -q "$1"; }                       # running container id (empty if none)
cid_any() { rdc ps -aq "$1"; }                  # including stopped
identity() { docker inspect -f '{{.Id}} {{.State.StartedAt}}' "$1"; }
dvar() { sed -n "s/^$1=//p" deploy.env | head -n 1; }
sql() { docker exec -i "$(cid postgres)" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d school_kit "$@"; }
dvar_bool() { [ "$(dvar "$1")" = true ]; }
service_enabled() { # cbt is a profile; the others always exist
  [ "$1" != cbt ] || dvar_bool CBT_ENABLED
}
enabled_services() { local s; for s in "${SERVICES_ALL[@]}"; do ! service_enabled "$s" || echo "$s"; done; }

# --------------------------------------------------------------------------- protected infrastructure
# These must come through every release with the same container id and start time: that is
# what "no unnecessary restart" means in a form a machine can check.
PROTECTED_SERVICES=(postgres redis ops-pinned)    # HARD: any change fails the release
protected_snapshot() {
  local s c
  for s in "${PROTECTED_SERVICES[@]}"; do
    c=$(cid_any "$s") || { echo "ERR $s"; return 1; }
    if [ -n "$c" ]; then echo "$s $(identity "$c")"; else echo "$s absent"; fi
  done
  c=$(cid_any ops) || return 1
  if [ -n "$c" ]; then echo "ops $(docker inspect -f '{{.Id}} running={{.State.Running}}' "$c")"; else echo "ops absent"; fi
  [ ! -f backup.env ] || echo "backup.env $(sha256sum backup.env | cut -c1-16)"
  [ ! -f backup-ops.override.yml ] || echo "override $(sha256sum backup-ops.override.yml | cut -c1-16)"
}
# SOFT: Caddy. This tool never restarts it (it only reloads), but an outside restart does not make
# a release unsafe, because maintenance is a file on disk. Drift is reported, and maintenance is
# re-asserted if it should be on.
caddy_identity() { local c; c=$(cid_any caddy); [ -z "$c" ] || identity "$c"; }
protected_save() { protected_snapshot > "$D/protected.snapshot"; caddy_identity > "$D/caddy.identity"; }
protected_assert() { # label
  local now; now=$(protected_snapshot) || { bad "protected infrastructure could not be inspected ($1)"; return 1; }
  if [ "$(caddy_identity)" != "$(cat "$D/caddy.identity" 2>/dev/null)" ]; then
    warn "Caddy was restarted by something other than this release ($1); its configuration is on disk, so the edge is unchanged"
    caddy_identity > "$D/caddy.identity"
    if [ -f "$D/MAINTENANCE" ]; then caddy_apply "$D/Caddyfile.maintenance" && ok "maintenance re-asserted after the Caddy restart" || { bad "maintenance could not be re-asserted after the Caddy restart"; return 1; }; fi
  fi
  if [ "$now" = "$(cat "$D/protected.snapshot")" ]; then return 0; fi
  bad "protected infrastructure changed ($1): $(diff <(cat "$D/protected.snapshot") <(printf '%s\n' "$now") | grep '^[<>]' | sed 's/ [0-9a-f]\{64\}/ <id>/' | tr '\n' ';')"
  return 1
}

# Test-only fault injection, honoured ONLY when RELEASE_QUALIFICATION=1 (the isolated qualification
# suite sets it; no production path does). `fault <name>` is true when RELEASE_FAULTS lists it.
fault() { [ "${RELEASE_QUALIFICATION:-}" = 1 ] && [[ ",${RELEASE_FAULTS:-}," == *",$1,"* ]]; }

# --------------------------------------------------------------------------- probes
# Host-side probes use the loopback ports compose publishes; the render worker publishes none, so
# it is probed from inside its own container (node where it exists, busybox wget otherwise).
probe_service() { # service -> 0 healthy
  local s=$1 url cid_
  case $s in
    api)    url=${RELEASE_PROBE_API:-http://127.0.0.1:4000/api/v1/health} ;;
    web)    url=${RELEASE_PROBE_WEB:-http://127.0.0.1:3001/staff/login} ;;
    portal) url=${RELEASE_PROBE_PORTAL:-http://127.0.0.1:3002/api/health} ;;
    cbt)    url=${RELEASE_PROBE_CBT:-http://127.0.0.1:3003/} ;;
    render-worker)
      cid_=$(cid render-worker); [ -n "$cid_" ] || return 1
      [ "$(docker inspect -f '{{.State.Running}}' "$cid_")" = true ] || return 1
      docker exec "$cid_" sh -c 'if command -v node >/dev/null 2>&1; then node -e "fetch(\"http://127.0.0.1:4001/health\").then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; else wget -q -O /dev/null http://127.0.0.1:4001/health; fi' 2>/dev/null
      return $? ;;
    *) return 1 ;;
  esac
  curl -fsS -m 5 -o /dev/null "$url" 2>/dev/null
}
wait_healthy() { # service [tries]
  local i n=${2:-${RELEASE_HEALTH_TRIES:-40}}
  for i in $(seq 1 "$n"); do
    # A container that has stopped for good will never become healthy: do not wait out the clock.
    local c; c=$(cid "$1" || true)
    if [ -n "$c" ] && [ "$(docker inspect -f '{{.State.Status}}' "$c")" = exited ]; then return 1; fi
    if probe_service "$1"; then return 0; fi
    sleep "${RELEASE_HEALTH_SLEEP:-3}"
  done
  return 1
}

# --------------------------------------------------------------------------- Caddy maintenance
# Restart-safe: the maintenance Caddyfile IS the file on disk, so a Caddy restart, a host reboot
# or a lost SSH session all come back in maintenance. Only School Kit's own host blocks (API,
# web, portal) and its school-address wildcard are touched: BetGenius, the marketing site and
# every other site keep their blocks byte for byte, and the original is restored from a backup
# that is kept until the window closes. A block is replaced by `respond 503` + Retry-After
# (Paystack and other senders retry 5xx; nothing is silently dropped at the edge).
MAINT_MARK='# RELEASE-MAINTENANCE'
caddy_exec() { rdc exec -T caddy "$@"; }
caddy_apply() { # file: validate inside the container, overwrite IN PLACE (a bind-mounted file keeps its inode), CHECK the write, reload
  caddy_exec sh -c 'cat > /tmp/Caddyfile.candidate' < "$1" || return 1
  caddy_exec caddy validate --config /tmp/Caddyfile.candidate --adapter caddyfile >/dev/null 2>&1 || return 1
  # test-only: the process dies half way through the write (a prefix of the file on disk)
  if fault kill_in_caddy_write; then head -c 40 "$1" > Caddyfile; kill -9 $$; fi
  cat "$1" > Caddyfile
  sync Caddyfile 2>/dev/null || true
  cmp -s "$1" Caddyfile || return 1          # the bytes on disk are the bytes intended, not a prefix of them
  caddy_exec caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || return 1
}
# --- durable recovery record. Written BEFORE the first byte of Caddy's configuration changes: the sha256 of the
# original and of the maintenance version of the Caddyfile and of the school-address site, whose full copies live
# beside it. The in-place write is not atomic (a rename would break the single-file bind mount), so a crash can leave
# a PREFIX of a file on disk, and a Caddy restart then loads it (a comment-only Caddyfile is a valid, empty config:
# the edge goes dark). `caddy_recover` compares what is on disk with the record and puts back a whole version.
sha_of() { [ -f "$1" ] && sha256sum "$1" | cut -d' ' -f1 || echo -; }
caddy_record_write() {
  sync "$D/Caddyfile.pre-release" "$D/Caddyfile.maintenance" 2>/dev/null || true
  printf '{"original_sha":"%s","maintenance_sha":"%s","site_original_sha":"%s","site_maintenance_sha":"%s"}\n' \
    "$(sha_of "$D/Caddyfile.pre-release")" "$(sha_of "$D/Caddyfile.maintenance")" \
    "$(sha_of "$D/sites.pre-release/school-addresses.caddy")" "$(sha_of "$D/school-addresses.maintenance")" > "$D/caddy.record.json.new"
  sync "$D/caddy.record.json.new" 2>/dev/null || true
  mv -f "$D/caddy.record.json.new" "$D/caddy.record.json"
}
caddy_partial() { # 0 when a record exists and Caddyfile (or the site file) is neither of its two recorded versions
  [ -f "$D/caddy.record.json" ] || return 1
  local cur o m so sm
  cur=$(sha_of Caddyfile); o=$(TOOL jget "$D/caddy.record.json" original_sha); m=$(TOOL jget "$D/caddy.record.json" maintenance_sha)
  [ "$cur" = "$o" ] || [ "$cur" = "$m" ] || return 0
  so=$(TOOL jget "$D/caddy.record.json" site_original_sha); sm=$(TOOL jget "$D/caddy.record.json" site_maintenance_sha)
  if [ "$so" != - ]; then cur=$(sha_of sites/school-addresses.caddy); [ "$cur" = "$so" ] || [ "$cur" = "$sm" ] || return 0; fi
  return 1
}
caddy_recover() {
  caddy_partial || return 0
  local want_maint=0 src sha so sm
  [ ! -f "$D/MAINTENANCE" ] || want_maint=1
  warn "Caddy's files are neither the original nor the maintenance version (a write was interrupted): repairing from the durable record"
  if [ "$want_maint" = 1 ]; then src="$D/Caddyfile.maintenance"; sha=$(TOOL jget "$D/caddy.record.json" maintenance_sha)
  else src="$D/Caddyfile.pre-release"; sha=$(TOOL jget "$D/caddy.record.json" original_sha); fi
  [ "$(sha_of "$src")" = "$sha" ] || { log "BLOCK the recovery copy $src does not match the record: cannot repair automatically; the original is in $D"; return 1; }
  so=$(TOOL jget "$D/caddy.record.json" site_original_sha); sm=$(TOOL jget "$D/caddy.record.json" site_maintenance_sha)
  if [ "$so" != - ]; then
    if [ "$want_maint" = 1 ]; then cp "$D/school-addresses.maintenance" sites/school-addresses.caddy; else cp -p "$D/sites.pre-release/school-addresses.caddy" sites/school-addresses.caddy; fi
  fi
  caddy_apply "$src" || { log "BLOCK the repaired Caddyfile was refused by Caddy"; return 1; }
  ok "Caddy's files repaired from the durable record ($([ "$want_maint" = 1 ] && echo maintenance || echo original) version)"
}
# Put School Kit's Caddyfile and school-address site back exactly as they were before the window.
# Idempotent; safe to call when there is nothing to restore. Never leaves the edge half-changed.
caddy_restore_original() {
  [ -e "$D/Caddyfile.pre-release" ] || return 0
  if [ -f "$D/sites.pre-release/school-addresses.caddy" ]; then cp -p "$D/sites.pre-release/school-addresses.caddy" sites/school-addresses.caddy; fi
  caddy_apply "$D/Caddyfile.pre-release" || return 1
  rm -f "$D/Caddyfile.maintenance" "$D/school-addresses.maintenance" "$D/MAINTENANCE" "$D/caddy.record.json"
  rm -rf "$D/sites.pre-release"
  mv -f "$D/Caddyfile.pre-release" "$D/Caddyfile.pre-release.restored" 2>/dev/null || true
}
edge_curl() { # path [extra curl args] -> prints status code
  local host path=$1; shift
  host=$(dvar API_HOST); host=${host#http://}; host=${host#https://}
  local scheme=${RELEASE_EDGE_SCHEME:-https} port=${RELEASE_EDGE_PORT:-443}
  curl -sS -o /dev/null -m 10 -w '%{http_code}' --resolve "${host%%:*}:${port}:127.0.0.1" "$@" "$scheme://${host%%:*}:${port}$path"
}
edge_code() { edge_curl "$1" 2>/dev/null || echo 000; }
maintenance_active() { grep -q "^$MAINT_MARK\$" Caddyfile 2>/dev/null; }
maintenance_on() { # release-id
  grep -q '^# BATCH3-MAINTENANCE$' Caddyfile && { log "BLOCK coordinated cutover maintenance is active; refusing"; return 1; }
  if ! maintenance_active; then
    [ -e "$D/Caddyfile.pre-release" ] || cp -p Caddyfile "$D/Caddyfile.pre-release"
    mkdir -p "$D/sites.pre-release"
    TOOL maintenance-caddyfile "$D/Caddyfile.pre-release" "$D/Caddyfile.maintenance" --mark "$MAINT_MARK" || { log "BLOCK could not build a maintenance Caddyfile covering API, web and portal"; rm -f "$D/Caddyfile.pre-release"; return 1; }
    if fault truncate_caddy; then head -c 40 "$D/Caddyfile.maintenance" > "$D/Caddyfile.maintenance.t"; mv -f "$D/Caddyfile.maintenance.t" "$D/Caddyfile.maintenance"; fi
    # validity is not enough (a truncated file can be a valid, empty configuration): it must be exactly what was intended
    TOOL maintenance-verify "$D/Caddyfile.pre-release" "$D/Caddyfile.maintenance" --mark "$MAINT_MARK" || { log "BLOCK the maintenance Caddyfile is incomplete; nothing was applied"; rm -rf "$D/Caddyfile.maintenance" "$D/Caddyfile.pre-release" "$D/sites.pre-release"; return 1; }
    if [ -f sites/school-addresses.caddy ]; then
      cp -p sites/school-addresses.caddy "$D/sites.pre-release/school-addresses.caddy"
      TOOL maintenance-site sites/school-addresses.caddy "$D/school-addresses.maintenance" || { log "BLOCK could not build the school-address maintenance site"; return 1; }
      TOOL maintenance-verify "$D/sites.pre-release/school-addresses.caddy" "$D/school-addresses.maintenance" --site || { log "BLOCK the school-address maintenance site is incomplete"; return 1; }
    fi
    caddy_record_write                       # durable record FIRST; only then does any byte of Caddy's configuration change
    [ ! -f "$D/school-addresses.maintenance" ] || cp "$D/school-addresses.maintenance" sites/school-addresses.caddy
    # From here on the edge has changed. Any failure puts the original back before returning.
    if ! caddy_apply "$D/Caddyfile.maintenance"; then
      log "BLOCK caddy refused the maintenance configuration; restoring the original"
      caddy_restore_original || log "BLOCK THE ORIGINAL CADDYFILE COULD NOT BE RESTORED AUTOMATICALLY: $D/Caddyfile.pre-release holds it"
      return 1
    fi
  else
    caddy_apply "$D/Caddyfile.maintenance" || { log "BLOCK could not reassert maintenance"; return 1; }
  fi
  printf '{"since":"%s","release_id":"%s"}\n' "$(date -u +%FT%TZ)" "$1" > "$D/MAINTENANCE"
  if [ "$(edge_code /api/v1/health)" != 503 ] || [ "$(edge_code /api/v1/payments/paystack/webhook -X POST)" != 503 ]; then
    log "BLOCK the edge does not answer 503 (health and the webhook path); restoring the original"
    caddy_restore_original || log "BLOCK THE ORIGINAL CADDYFILE COULD NOT BE RESTORED AUTOMATICALLY: $D/Caddyfile.pre-release holds it"
    return 1
  fi
  ok "maintenance on: 503 with Retry-After at the API host and the webhook path"
}
maintenance_off() {
  maintenance_active || [ -f "$D/MAINTENANCE" ] || [ -e "$D/Caddyfile.pre-release" ] || return 0
  [ -e "$D/Caddyfile.pre-release" ] || { log "BLOCK $D/Caddyfile.pre-release is missing; refusing to guess the original Caddyfile"; return 1; }
  caddy_restore_original || { log "BLOCK could not restore the original Caddyfile (still in maintenance)"; return 1; }
  ok "maintenance off: the original Caddyfile and sites are restored and reloaded"
}

# --------------------------------------------------------------------------- backup window / busy (read-only inspection)
proc_listing() { # container -> validated `docker top` (fail closed on anything unexpected)
  local out
  out=$(docker top "$1" -eo pid,args) || { echo "BLOCK docker top failed for $1" >&2; return 2; }
  head -n 1 <<<"$out" | grep -Eq '^[[:space:]]*PID[[:space:]]+(COMMAND|ARGS|CMD)' || { echo "BLOCK unexpected docker top header for $1" >&2; return 2; }
  [ "$(wc -l <<<"$out")" -ge 2 ] || { echo "BLOCK docker top listed no processes for $1" >&2; return 2; }
  printf '%s\n' "$out"
}
backup_busy() { # container -> 0 busy, 1 idle, 2 inspection failed
  local listing; listing=$(proc_listing "$1") || return 2
  awk 'NR > 1 { c = $2; sub(/.*\//, "", c); if (c ~ /^(pg_dump|pg_restore|wal-g|rclone)$/ || $0 ~ /\/ops\/backup\.sh/) f = 1 } END { exit f ? 0 : 1 }' <<<"$listing"
}
in_backup_window() { local h; h=${RELEASE_NOW_HHMM:-$(date -u +%H%M)}; [ "$h" -ge 0100 ] && [ "$h" -le 0230 ]; }

# --------------------------------------------------------------------------- disk
free_gib() { df -Pk "${RELEASE_DISK_PATH:-/var/lib/docker}" 2>/dev/null | awk 'NR == 2 { printf "%d", $4 / 1048576 }'; }
free_kib() { df -Pk "${RELEASE_DISK_PATH:-/var/lib/docker}" 2>/dev/null | awk 'NR == 2 { print $4 }'; }
disk_ok() { local need=${RELEASE_MIN_FREE_KIB:-5242880} have; have=$(free_kib); [ -n "$have" ] && [ "$have" -ge "$need" ]; }

# --------------------------------------------------------------------------- diagnostics (never a secret)
diagnose() { # label
  local f="$D/diagnostics/$(date -u +%Y%m%dT%H%M%SZ)-${1:-event}.txt" s c
  mkdir -p "$D/diagnostics"
  {
    echo "== state"; TOOL state get --file "$D/state.json" 2>&1
    echo "== containers"; rdc ps -a --format '{{.Service}} {{.State}} {{.Status}} {{.Image}}' 2>&1 | sed 's/^/  /'
    echo "== disk"; df -h "${RELEASE_DISK_PATH:-/var/lib/docker}" 2>&1 | tail -n 2
    echo "== maintenance"; if [ -f "$D/MAINTENANCE" ]; then cat "$D/MAINTENANCE"; else echo "off"; fi
    echo "== recent events"; tail -n 15 "$D/history.jsonl" 2>/dev/null
    for s in "${SERVICES_ALL[@]}"; do
      c=$(cid_any "$s" 2>/dev/null || true); [ -n "$c" ] || continue
      echo "== logs: $s (last 25 lines)"; docker logs --tail 25 "$c" 2>&1
    done
  } 2>&1 | TOOL redact > "$f"
  chmod 600 "$f"
  echo "$f"
}
notify() { # kind summary — the operator's hook (if any) gets the kind and the path of a redacted summary only
  mkdir -p "$D/alerts"
  local f="$D/alerts/$(date -u +%Y%m%dT%H%M%SZ)-$1.txt"
  printf '%s\n' "$2" | TOOL redact > "$f"
  if [ -x "$D/hooks/notify" ]; then "$D/hooks/notify" "$1" "$f" >/dev/null 2>&1 || warn "the notify hook failed (the alert file was still written)"; fi
}
