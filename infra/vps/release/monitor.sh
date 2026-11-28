#!/usr/bin/env bash
# Continuous, read-only monitoring of the release system (run from cron/systemd or by hand; the
# release-monitor workflow calls it over SSH once that is switched on). It never changes anything.
#
#   monitor.sh        exit 0 when everything is healthy, 1 when something needs attention
#
# Checks: off-site backup freshness and WAL archiving, the running system against the recorded
# current release (drift), webhook backlog and dead letters, disk, a maintenance window left open,
# a release that stopped half way (INTERRUPTED), and the money invariants against the last
# baseline. Output is redacted; a non-zero exit also writes an alert file for the notify hook.
set -Eeuo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"
# shellcheck source=acceptance.sh
. "$here/acceptance.sh"
exec </dev/null
cd "$SK_DIR"
CHECK_FAILED=0
cur=$(cat "$D/current" 2>/dev/null || true)
[ -n "$cur" ] && [ -f "$D/releases/$cur/manifest.json" ] || { echo "BLOCK no adopted release; nothing to monitor"; exit 1; }
# shellcheck disable=SC2034  # MANIFEST and PHASE are read by the sourced acceptance checks
MANIFEST=$D/releases/$cur/manifest.json
# shellcheck disable=SC2034
PHASE=monitor
# shellcheck disable=SC2034
BASELINE_FILE=$(ls -t "$D"/baseline/*.env 2>/dev/null | head -n 1 || true)

phase=$(state_get phase)
exec 8>"$D/apply.lock"
if flock -n 8; then lock=free; else lock=held; fi
case $phase in
  ''|ROLLED_BACK|ABORTED) ok "no release is half way (state: ${phase:-none})" ;;
  COMPLETE) if acceptance_ok; then ok "the last release is COMPLETE with its acceptance record ($(acceptance_why))"; else bad "state is COMPLETE but its acceptance record does not verify: $(acceptance_why)"; fi ;;
  FIX_FORWARD_REQUIRED|ROLLBACK_FAILED) bad "release state is $phase: an operator must act (release.sh status)" ;;
  *) if [ "$lock" = free ]; then bad "release $(state_get release_id) is INTERRUPTED at $phase: release.sh resume"; else info "a release is running ($phase)"; fi ;;
esac
if [ -f "$D/MAINTENANCE" ]; then
  since=$(python3 -c 'import json,sys,datetime as d; print(int((d.datetime.now(d.timezone.utc)-d.datetime.strptime(json.load(open(sys.argv[1]))["since"],"%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=d.timezone.utc)).total_seconds()//60))' "$D/MAINTENANCE")
  if [ "$lock" = free ]; then bad "maintenance has been on for ${since} minutes with no release running"; else info "maintenance on for ${since} minutes (a release is running)"; fi
fi
free=$(free_gib); [ "${free:-0}" -ge "${RELEASE_MONITOR_MIN_FREE_GIB:-8}" ] && ok "free disk ${free} GiB" || bad "free disk ${free:-?} GiB is below ${RELEASE_MONITOR_MIN_FREE_GIB:-8} GiB"
caddy_classify
case $CADDY_VERDICT in
  INTERRUPTED) bad "Caddy's files hold an interrupted write ($CADDY_DETAIL): a release command completes it from the durable record" ;;
  UNRELATED_EDIT|RECORD_INVALID) bad "Caddy's files differ from the recorded versions and it is not an interrupted write ($CADDY_VERDICT: $CADDY_DETAIL): nothing will be overwritten automatically" ;;
esac
# Monitoring only: an unreadable Caddy admin endpoint is reported as DEGRADED verification, separately from a failure
# (release acceptance, by contrast, fails closed).
ACCEPT_ADMIN_DEGRADED_OK=1 check_caddy_routing_live_only || CHECK_FAILED=1
check_images || CHECK_FAILED=1
check_backups || CHECK_FAILED=1
[ "$(sql -c "SELECT coalesce(last_failed_time > last_archived_time, false) FROM pg_stat_archiver")" = f ] && ok "the WAL archiver is not failing" || bad "the WAL archiver is failing"
check_integrity || CHECK_FAILED=1
check_gates || CHECK_FAILED=1
if [ "$CHECK_FAILED" = 0 ]; then
  if [ -n "$DEGRADED_VERIFICATION" ]; then
    ok "monitor: healthy, with DEGRADED verification ($DEGRADED_VERIFICATION): not a failure, but not fully verified either"
    notify monitor-degraded "release monitor: healthy, but verification is degraded ($DEGRADED_VERIFICATION) on $(date -u +%FT%TZ)"
  else ok "monitor: healthy"; fi
  exit 0
fi
notify monitor "release monitor found problems on $(date -u +%FT%TZ); see $D/run.log"
exit 1
