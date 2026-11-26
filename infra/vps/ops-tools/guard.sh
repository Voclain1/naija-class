#!/usr/bin/env bash
# Operator guard for the production VPS (Termius, from an Android tablet or any terminal).
# Run from anywhere:  bash /opt/school-kit/ops-tools/guard.sh <mode>
# Every mode is READ-ONLY except rotate-ping and repin-ops (both recoverable, both only ever
# recreate the ops-pinned scheduler). No mode prints a secret, a length or a hash of one, starts
# the original ops container, restarts PostgreSQL, or runs a backup. Exit status is non-zero if
# ANY check fails or ANY inspection cannot be completed.
#   retention        object-store pairs, newest checksum, prune dry run, WAL-G dry run and integrity
#   config           backup.env validation + the settings the running containers actually hold
#   release          the running api/worker are the pinned release (not APP_TAG)
#   scheduler        ops-pinned persistence, original ops retained and stopped, images present
#   deploy-preflight host preconditions for the controlled cutover
#   rotate-ping      replace the heartbeat URL (hidden prompt)
#   sync-secret      write backup.env into the GitHub secret BACKUP_ENV_FILE (hidden token prompt; nothing displayed)
#   owner-session    the whole owner procedure in ONE guided run (inspect, re-pin, rotate heartbeat, sync secret)
#   repin-ops REF    move ops-pinned to another immutable backup image (REF = ...@sha256:<64 hex>)
set -Eeuo pipefail
umask 077
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"
mode=${1:?usage: guard.sh retention|config|scheduler|deploy-preflight|rotate-ping|repin-ops}
cd "$SK_DIR"
PG=$(dc ps -q postgres) || die "cannot inspect PostgreSQL"
[ -n "$PG" ] || die "PostgreSQL container not found"
PG_ID=$(identity "$PG")

case $mode in
retention)
  [ -r "$OVERRIDE" ] || die "$OVERRIDE missing"
  c=$(dco ps -q ops-pinned); [ -n "$c" ] || die "ops-pinned is not running"
  if docker exec -i "$c" sh -s < "$here/retention-inspect.sh"; then ok "retention inspection completed"; else bad "retention inspection reported failures (see above)"; fi
  arch=$(docker exec "$PG" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d school_kit -c "SELECT archived_count, failed_count, coalesce(last_failed_time > last_archived_time, false) FROM pg_stat_archiver") || die "pg_stat_archiver unreadable"
  info "archiver (archived|failed total|currently failing): $arch"
  [ "${arch##*|}" = f ] && ok "WAL archiver is not currently failing" || bad "WAL archiver is currently failing" ;;

config)
  [ -r backup.env ] || die "backup.env unreadable"
  info "owner/mode/mtime: $(stat -c '%U:%G %a %y' backup.env)"
  [ "$(stat -c %a backup.env)" = 600 ] && ok "mode 0600" || bad "backup.env mode is not 0600"
  if python3 "$here/backup_env.py" validate backup.env; then ok "backup.env passes validation"; else bad "backup.env failed validation"; fi
  # What the RUNNING containers hold (names only). The scheduler reads env_file at creation; the
  # postgres container's archive_command uses ITS copy, so drift here means archiving uses old settings.
  keys="BACKUP_BUCKET WALG_S3_PREFIX AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_ENDPOINT AWS_REGION HEALTHCHECK_PING_URL"
  c=$(dco ps -q ops-pinned 2>/dev/null || true)
  if [ -n "$c" ]; then
    miss=$(docker exec "$c" sh -c ". /ops/env.sh; for k in $keys; do eval \"v=\\\${\$k:-}\"; [ -n \"\$v\" ] || echo \"\$k\"; done") || die "cannot read the scheduler's settings"
    [ -z "$miss" ] && ok "ops-pinned holds every required setting" || bad "ops-pinned is missing: $(echo $miss)"
  else bad "ops-pinned is not running"; fi
  miss=$(docker exec "$PG" sh -c "for k in BACKUP_BUCKET WALG_S3_PREFIX AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_ENDPOINT AWS_REGION; do eval \"v=\\\${\$k:-}\"; [ -n \"\$v\" ] || echo \"\$k\"; done") || die "cannot read PostgreSQL's settings"
  [ -z "$miss" ] && ok "the postgres container (archive_command) holds every storage setting" || bad "postgres container is missing: $(echo $miss) (changes need a planned PostgreSQL restart, not now)"
  info "to compare with the GitHub secret use the backup-config-reconcile check on PR #563" ;;

scheduler)
  [ -r "$OVERRIDE" ] && ok "override file present" || bad "override file missing"
  [ -r .batch2-postgres-identity ] && ok "identity record present" || bad "identity record missing"
  [ "$PG_ID" = "$(cat .batch2-postgres-identity)" ] && ok "PostgreSQL identity and start time unchanged since activation" || bad "PostgreSQL was recreated or restarted since activation"
  img=$(override_image)
  [[ $img =~ ^ghcr\.io/voclain1/school-kit-postgres@sha256:[0-9a-f]{64}$ ]] && ok "override pins an immutable image" || bad "override image is not a pinned digest"
  [ -z "${EXPECTED_OPS_IMAGE:-}" ] || { [ "$img" = "$EXPECTED_OPS_IMAGE" ] && ok "override image is the expected one" || bad "override image differs from EXPECTED_OPS_IMAGE"; }
  c=$(dco ps -q ops-pinned) || die "cannot list ops-pinned"
  if [ -n "$c" ]; then
    [ "$(docker inspect -f '{{.Config.Image}}' "$c")" = "$img" ] && ok "ops-pinned runs the pinned image" || bad "ops-pinned runs a different image"
    [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$c")" = unless-stopped ] && ok "ops-pinned restart policy unless-stopped" || bad "ops-pinned restart policy"
    n=$(count_cmd "$c" cron) || die "process inspection failed"; [ "$n" = 1 ] && ok "exactly one cron in ops-pinned" || bad "cron count in ops-pinned is $n"
  else bad "ops-pinned is not running"; fi
  old=$(dc ps -aq ops) || die "cannot list the original ops"
  if [ -n "$old" ]; then
    [ "$(docker inspect -f '{{.State.Running}}' "$old")" = false ] && ok "original ops retained and stopped" || bad "original ops is RUNNING (two schedulers)"
    [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$old")" = no ] && ok "original ops restart policy 'no'" || bad "original ops would restart"
  else bad "original ops container is gone (the retained evidence/fallback was lost)"; fi
  docker image inspect "$FALLBACK_TAG" >/dev/null && ok "verified fallback image tag present" || bad "fallback tag $FALLBACK_TAG missing"
  docker image inspect "$img" >/dev/null && ok "pinned image present locally" || bad "pinned image absent locally"
  grep -qx 'VPS_MODE=rehearsal' deploy.env && bad "deploy.env says VPS_MODE=rehearsal on this host" || ok "deploy.env is not in rehearsal mode"
  if grep -q 'rehearsal-only' deploy.sh 2>/dev/null; then ok "deploy.sh carries the rehearsal-only guard"; else bad "deploy.sh lacks the rehearsal-only guard"; fi ;;

deploy-preflight)
  pgmajor_env=$(sed -n 's/^PG_MAJOR=//p' deploy.env | head -n 1)
  running=$(docker exec "$PG" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d school_kit -c "SELECT current_setting('server_version_num')::int / 10000") || die "cannot read the server version"
  info "deploy.env PG_MAJOR=$pgmajor_env running server major=$running"
  [ "$pgmajor_env" = "$running" ] && ok "deploy.env PG_MAJOR matches the running server" || bad "PG_MAJOR in deploy.env differs from the running server (a recreate would mismatch the data directory)"
  info "VPS_MODE=$(sed -n 's/^VPS_MODE=//p' deploy.env | head -n 1)  APP_TAG=$(sed -n 's/^APP_TAG=//p' deploy.env | head -n 1)"
  for s in api render-worker; do
    cid=$(dc ps -q "$s") || die "cannot list $s"; [ -n "$cid" ] || { bad "$s is not running"; continue; }
    info "$s image: $(docker inspect -f '{{.Config.Image}}' "$cid")"
  done
  free=$(df -Pk /var/lib/docker | awk 'NR == 2 { printf "%d", $4 / 1048576 }')
  [ "$free" -ge 5 ] && ok "free disk on /var/lib/docker is at least 5 GiB" || bad "less than 5 GiB free on /var/lib/docker"
  docker exec "$PG" psql -XqAt -v ON_ERROR_STOP=1 -U postgres -d school_kit -c "BEGIN READ ONLY;
    SELECT 'INFO migrations applied='||count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)||' rolled_back='||count(*) FILTER (WHERE rolled_back_at IS NOT NULL)||' unresolved='||count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) FROM _prisma_migrations;
    SELECT 'INFO runtime role superuser/bypassrls: '||rolsuper||'/'||rolbypassrls FROM pg_roles WHERE rolname='app_user';
    COMMIT;"
  "$0" scheduler || bad "scheduler checks failed"
  "$0" config || bad "configuration checks failed" ;;

release)
  # The running application must be the pinned release, not whatever APP_TAG names (the pre-allocation image).
  [ -r release.override.yml ] || die "no release.override.yml: no controlled cutover has been run"
  for s in api render-worker; do
    want=$(awk -v s="$s" '$1 == s":" { f = 1; next } f && $1 == "image:" { print $2; exit }' release.override.yml)
    cid=$(dco ps -q "$s") || die "cannot list $s"
    [ -n "$cid" ] || { bad "$s is not running"; continue; }
    [ "$(docker inspect -f '{{.Config.Image}}' "$cid")" = "$want" ] && ok "$s runs the pinned release image" || bad "$s does NOT run the pinned release image"
  done
  tag=$(sed -n 's/^APP_TAG=//p' deploy.env | head -n 1)
  info "deploy.env APP_TAG=$tag (a compose command WITHOUT release.override.yml would run that image: never run one)" ;;

rotate-ping)
  [ -r "$OVERRIDE" ] || die "$OVERRIDE missing"
  in_backup_window && die "inside the 01:00-02:30 UTC backup window"
  c=$(dco ps -q ops-pinned); [ -n "$c" ] || die "ops-pinned is not running"
  rc=0; backup_busy "$c" || rc=$?
  [ "$rc" -eq 1 ] || die "a backup process is running, or process inspection failed (status $rc)"
  read -rsp "New heartbeat URL (input hidden, paste then Enter): " url; echo
  [[ $url =~ ^https://hc-ping\.com/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || die "that is not an https://hc-ping.com/<uuid> URL (value withheld)"
  mkdir -p config-backups; chmod 700 config-backups; snap="config-backups/rotate-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -m 700 "$snap"
  cp -p backup.env "$snap/backup.env"; cp -p "$OVERRIDE" "$snap/$OVERRIDE"
  restore() { cp -p "$snap/backup.env" backup.env; cp -p "$snap/$OVERRIDE" "$OVERRIDE"; }
  tmp=$(mktemp ./backup.env.new.XXXXXX)
  awk -v u="$url" 'BEGIN { d = 0 } /^HEALTHCHECK_PING_URL=/ { print "HEALTHCHECK_PING_URL=" u; d = 1; next } { print } END { if (!d) print "HEALTHCHECK_PING_URL=" u }' backup.env > "$tmp"
  unset url
  chmod 600 "$tmp"; chown --reference=backup.env "$tmp"
  [ "$(diff <(grep -v '^HEALTHCHECK_PING_URL=' backup.env) <(grep -v '^HEALTHCHECK_PING_URL=' "$tmp") | wc -l)" = 0 ] || { rm -f "$tmp"; die "unrelated lines differ; nothing changed"; }
  python3 "$here/backup_env.py" validate "$tmp" >/dev/null || { rm -f "$tmp"; die "the new file fails validation; nothing changed"; }
  mv -f "$tmp" backup.env
  if swap_scheduler "$PG_ID"; then
    ok "new heartbeat loaded by a recreated ops-pinned; PostgreSQL and the original ops untouched"
    info "protected copy of the previous settings: $snap (delete it once the new check is confirmed green)"
  else
    bad "the scheduler did not come up healthy with the new settings; ROLLING BACK"
    restore
    if swap_scheduler "$PG_ID"; then ok "rolled back: previous settings and image restored and healthy"
    else
      bad "rollback with the previous image failed; trying the verified local fallback image"
      write_override "$FALLBACK_TAG"
      if swap_scheduler "$PG_ID"; then ok "fallback image running under ops-pinned (previous settings)"; info "re-pin the proper digest with: guard.sh repin-ops <image@sha256:...>"
      else bad "MANUAL ACTION: no healthy scheduler. The original ops container is untouched and STOPPED; do not start it while any scheduler runs. Settings were restored from $snap."; fi
    fi
  fi ;;

repin-ops)
  new=${2:?usage: guard.sh repin-ops ghcr.io/voclain1/school-kit-postgres@sha256:<64 hex>}
  [[ $new =~ ^ghcr\.io/voclain1/school-kit-postgres@sha256:[0-9a-f]{64}$ ]] || die "not an immutable backup image reference"
  [ -r "$OVERRIDE" ] || die "$OVERRIDE missing"
  in_backup_window && die "inside the 01:00-02:30 UTC backup window"
  c=$(dco ps -q ops-pinned); [ -n "$c" ] || die "ops-pinned is not running"
  rc=0; backup_busy "$c" || rc=$?
  [ "$rc" -eq 1 ] || die "a backup process is running, or process inspection failed (status $rc)"
  docker pull "$new"
  docker run --rm --network none --entrypoint sh "$new" -ec 'rclone version | head -n 1 | grep -Fq "v1.76.0"; wal-g --version >/dev/null; test -x /ops/entrypoint.sh && test -x /ops/backup.sh && test -x /ops/restore-test.sh' || die "the candidate image fails the tool checks"
  mkdir -p config-backups; chmod 700 config-backups; snap="config-backups/repin-$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -m 700 "$snap"
  cp -p backup.env "$snap/backup.env"; cp -p "$OVERRIDE" "$snap/$OVERRIDE"
  write_override "$new"
  if swap_scheduler "$PG_ID"; then ok "ops-pinned now runs the new immutable image; the previous image is kept locally"
  else
    bad "the new image did not come up healthy; ROLLING BACK to the previous override"
    cp -p "$snap/$OVERRIDE" "$OVERRIDE"
    if swap_scheduler "$PG_ID"; then ok "rolled back to the previous pinned image"
    else
      write_override "$FALLBACK_TAG"
      if swap_scheduler "$PG_ID"; then ok "fallback image running"; else bad "MANUAL ACTION: no healthy scheduler; the original ops is untouched and stopped"; fi
    fi
  fi ;;
sync-secret)
  [ -t 0 ] || die "interactive only (it asks for a token with a hidden prompt)"
  python3 "$here/backup_env.py" validate backup.env >/dev/null || die "backup.env fails validation; the secret was NOT changed (run: guard.sh config)"
  python3 -c 'import nacl' 2>/dev/null || die "python3-nacl is missing. Run once: sudo apt-get install -y python3-nacl   then repeat"
  echo "Create a FINE-GRAINED token at github.com/settings/personal-access-tokens: only this repository, permission 'Secrets: Read and write', 1-day expiry."
  read -rsp "Paste the token (hidden), then Enter: " tok; echo
  rc=0; GH_TOKEN=$tok python3 "$here/gh_secret.py" "${GH_REPO:-Voclain1/naija-class}" BACKUP_ENV_FILE backup.env || rc=$?
  unset tok
  if [ "$rc" = 0 ]; then ok "BACKUP_ENV_FILE now equals the running backup.env. Revoke the token. Then re-run the 'backup-config-reconcile' check on PR #563 (Checks tab > Re-run all jobs): it must say 'identical'."
  else bad "the secret was NOT updated; revoke the token anyway"; fi ;;

owner-session)
  [ -t 0 ] || die "interactive only"
  step() { printf '\n=== %s\n' "$1"; }
  confirm() { local a; read -r -p "$1 Type $2 to continue (anything else stops): " a; [ "$a" = "$2" ] || die "stopped by you; nothing further was changed"; }
  step "1/5 read-only inspections (config, scheduler, retention)"
  "$0" config || die "fix the configuration first"
  "$0" scheduler || die "the scheduler is not in the expected state"
  "$0" retention || die "the retention inspection reported failures"
  step "2/5 move ops-pinned to the corrected backup image (only if the release manifest names a different one)"
  if [ -s release/manifest.env ]; then
    want=$(sed -n 's/^BACKUP_OPS=//p' release/manifest.env | head -n 1); have=$(override_image)
    if [ -n "$want" ] && [ "$want" != "$have" ]; then confirm "ops-pinned will be recreated on the new image (rolls back by itself on failure)." REPIN; "$0" repin-ops "$want" || die "re-pin failed (it rolled back; see above)"
    else ok "ops-pinned already runs the manifest's backup image"; fi
  else info "no release/manifest.env yet: skipping (run 'cutover.sh stage' first when you have the manifest)"; fi
  step "3/5 rotate the heartbeat URL"
  echo "In Healthchecks: create the NEW check (same schedule, same email channel) and copy its ping URL. Leave the old check running."
  confirm "Have you created the new check?" YES
  "$0" rotate-ping || die "heartbeat rotation failed (it rolled back; see above)"
  step "4/5 validate the result"
  "$0" config || die "configuration invalid after rotation"
  step "5/5 make the GitHub secret match"
  "$0" sync-secret || die "the secret was not updated"
  echo; ok "owner session complete. Remaining: after the next 01:30 UTC run confirm the NEW Healthchecks check is green, then pause the old one."
  ;;
*) die "unknown mode: $mode" ;;
esac
exit "$FAILED"
