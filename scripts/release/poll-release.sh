#!/usr/bin/env bash
# Follows a DETACHED release on the server until it reaches a final state, then maps that state to
# an exit status for the workflow. The release does not depend on this script or on the SSH session
# it runs over: if polling fails for a while the release carries on and this only reports that it
# lost sight of it (the server's own state is the truth).
#
#   poll-release.sh <ssh-host-alias> [timeout-seconds]
#
# Exit: 0 COMPLETE with its durable acceptance record · 1 ROLLED_BACK/ABORTED (failed, but safe) · 4 ABORTED because the system was busy (retry later)
#       6 FIX_FORWARD_REQUIRED · 7 ROLLBACK_FAILED · 8 lost contact (the release may still be running)
#       9 INTERRUPTED on the server (run `release.sh resume`) · 10 timed out
#       COMPLETE counts ONLY when the server's own verification says the durable acceptance record is valid, and (when given)
#       it names the release id and manifest checksum this workflow started: EXPECT_RELEASE_ID, EXPECT_MANIFEST_SHA256.
# Environment: POLL_INTERVAL (10), POLL_MAX_LOST (30 consecutive failed polls), RELEASE_TOOLS (/opt/school-kit/release-tools),
#              RELEASE_SSH (ssh) so tests can substitute it.
set -uo pipefail
host=${1:?ssh host alias}
timeout=${2:-2700}
interval=${POLL_INTERVAL:-10}
max_lost=${POLL_MAX_LOST:-30}
tools=${RELEASE_TOOLS:-/opt/school-kit/release-tools}
ssh_=${RELEASE_SSH:-ssh}
lost=0; last=""; start=$(date +%s)
while :; do
  if out=$($ssh_ -n "$host" "$tools/release.sh status --json" 2>/dev/null) && [ -n "$out" ]; then
    lost=0
    phase=$(python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["state"].get("phase",""))' <<<"$out" 2>/dev/null || echo "")
    run=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["run"])' <<<"$out" 2>/dev/null || echo "")
    if [ "$phase:$run" != "$last" ]; then echo "$(date -u +%FT%TZ) phase=$phase run=$run"; last="$phase:$run"; fi
    # valid acceptance = state.accepted AND the server verified record, release id and manifest checksum all agree
    acc=$(python3 -c 'import json,sys
d = json.load(sys.stdin); st = d["state"]; a = d.get("acceptance") or {}
print("true" if st.get("accepted") is True and a.get("valid") is True and a.get("release_id") == st.get("release_id") and a.get("manifest_sha256") == st.get("manifest_sha256") else "false")' <<<"$out" 2>/dev/null || echo false)
    seen_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["state"].get("release_id",""))' <<<"$out" 2>/dev/null || echo "")
    seen_sha=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["state"].get("manifest_sha256",""))' <<<"$out" 2>/dev/null || echo "")
    case $phase:$run in
      COMPLETE:IDLE) if [ "$acc" != true ]; then echo "::error::the server says COMPLETE but its durable acceptance record is missing or does not verify: treating the release as FAILED"; exit 9; fi
                     if { [ -n "${EXPECT_RELEASE_ID:-}" ] && [ "$seen_id" != "$EXPECT_RELEASE_ID" ]; } || { [ -n "${EXPECT_MANIFEST_SHA256:-}" ] && [ "$seen_sha" != "$EXPECT_MANIFEST_SHA256" ]; }; then
                       echo "::error::the server is COMPLETE for a different release or manifest than this workflow started ($seen_id): treating as FAILED"; exit 9; fi
                     echo "release complete (acceptance recorded and verified)"; exit 0 ;;
      ROLLED_BACK:IDLE) echo "::error::the release failed and the previous release was restored"; exit 1 ;;
      ABORTED:IDLE) err=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["state"].get("error",""))' <<<"$out"); echo "::error::the release stopped before changing anything ($err)"; [ "$err" = quiesce ] && exit 4; exit 1 ;;
      FIX_FORWARD_REQUIRED:*) echo "::error::FIX-FORWARD REQUIRED: the database changed and the previous release cannot run on it; ingress is in maintenance"; exit 6 ;;
      ROLLBACK_FAILED:*) echo "::error::ROLLBACK FAILED: maintenance is on; an operator must act (release.sh status)"; exit 7 ;;
      *:INTERRUPTED) echo "::error::the release was interrupted on the server at $phase: run release.sh resume"; exit 9 ;;
    esac
  else
    lost=$((lost + 1))
    echo "$(date -u +%FT%TZ) could not read the release state ($lost/$max_lost); the release itself is not affected"
    if [ "$lost" -ge "$max_lost" ]; then echo "::error::lost contact with the server; the release may still be running: check release.sh status"; exit 8; fi
  fi
  [ $(( $(date +%s) - start )) -lt "$timeout" ] || { echo "::error::timed out waiting; the release may still be running"; exit 10; }
  sleep "$interval"
done
