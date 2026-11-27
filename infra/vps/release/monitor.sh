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
  ''|COMPLETE|ROLLED_BACK|ABORTED) ok "no release is half way (state: ${phase:-none})" ;;
  FIX_FORWARD_REQUIRED|ROLLBACK_FAILED) bad "release state is $phase: an operator must act (release.sh status)" ;;
  *) if [ "$lock" = free ]; then bad "release $(state_get release_id) is INTERRUPTED at $phase: release.sh resume"; else info "a release is running ($phase)"; fi ;;
esac
if [ -f "$D/MAINTENANCE" ]; then
  since=$(python3 -c 'import json,sys,datetime as d; print(int((d.datetime.now(d.timezone.utc)-d.datetime.strptime(json.load(open(sys.argv[1]))["since"],"%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=d.timezone.utc)).total_seconds()//60))' "$D/MAINTENANCE")
  if [ "$lock" = free ]; then bad "maintenance has been on for ${since} minutes with no release running"; else info "maintenance on for ${since} minutes (a release is running)"; fi
fi
free=$(free_gib); [ "${free:-0}" -ge "${RELEASE_MONITOR_MIN_FREE_GIB:-8}" ] && ok "free disk ${free} GiB" || bad "free disk ${free:-?} GiB is below ${RELEASE_MONITOR_MIN_FREE_GIB:-8} GiB"
check_images || CHECK_FAILED=1
check_backups || CHECK_FAILED=1
[ "$(sql -c "SELECT coalesce(last_failed_time > last_archived_time, false) FROM pg_stat_archiver")" = f ] && ok "the WAL archiver is not failing" || bad "the WAL archiver is failing"
check_integrity || CHECK_FAILED=1
check_gates || CHECK_FAILED=1
if [ "$CHECK_FAILED" = 0 ]; then ok "monitor: healthy"; exit 0; fi
notify monitor "release monitor found problems on $(date -u +%FT%TZ); see $D/run.log"
exit 1
