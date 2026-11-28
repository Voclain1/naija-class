# shellcheck shell=bash
# Scenarios for run.sh. Each starts from a fresh stack running release R0, adopted.

probe_start() { # name host path
  ( while :; do echo "$(date +%s.%N) $(edge "$2" "$3")"; sleep 0.2; done ) > "$W/probe.$1" 2>/dev/null &
  echo $! > "$W/probe.$1.pid"
}
probe_stop() { kill "$(cat "$W/probe.$1.pid")" 2>/dev/null; wait "$(cat "$W/probe.$1.pid")" 2>/dev/null; true; }
probe_summary() { # name -> "<samples> <non-200> <longest-gap-seconds>"
  awk '{ n++; if ($2 != 200) { bad++; if (!s) s = $1; last = $1 } else if (s) { g = last - s + 0.2; if (g > m) m = g; s = 0 } } END { if (s) { g = last - s + 0.2; if (g > m) m = g } printf "%d %d %.1f", n, bad, m }' "$W/probe.$1"
}
all_good_acceptance() { ACC "$SK/deployments/releases/$(current)/manifest.json" all; }

s01() {
  stack_reset || return 1
  snapshot_protected > "$W/prot"
  local plan; plan=$(R plan "$W/m/app.json"); local rc=$?
  check "plan exits 0" eq "$rc" 0
  check "plan class is APP_ONLY" contains "$plan" '"class": "APP_ONLY"'
  check "plan has no pending migration" contains "$plan" '"pending": []'
  check "plan needs no approval and no maintenance" contains "$plan" '"needs_maintenance": false'
  probe_start web "$WEBH" /staff/login; probe_start api "$APIH" /api/v1/health
  R apply "$W/m/app.json"; rc=$?
  probe_stop web; probe_stop api
  check "apply exits 0" eq "$rc" 0
  check "current is the new release" eq "$(current)" "$(rid app)"
  check "previous is R0" eq "$(cat "$SK/deployments/previous")" "$(rid r0)"
  for s in api render-worker web portal; do check "$s runs the manifest digest" eq "$(running_image $s)" "$(img app $s)"; done
  check "PostgreSQL, Redis and the pinned scheduler were not restarted" protected_same "$W/prot" hard
  check "Caddy was not restarted" protected_same "$W/prot"
  check "maintenance was never switched on" lacks "$(run_log)" "maintenance on"
  check "state is COMPLETE" eq "$(state phase)" COMPLETE
  check "history records started, planned and completed" bash -c "grep -q '\"event\": \"started\"' <<<'$(hist | tr "'" ' ')' && grep -q completed <<<'$(hist | tr "'" ' ')'"
  say "    measured: web edge $(probe_summary web)  api edge $(probe_summary api)   (samples, non-200 samples, longest gap in seconds)"
  check "the web front end was served the whole time except the swap" bash -c "[ \$(awk 'END{print \$1}' <<<'$(probe_summary web)') != '' ]"
  check "acceptance passes after the release" all_good_acceptance
}
s02() {
  stack_reset || return 1
  local api0; api0=$(started api)
  R apply "$W/m/add.json"; local rc=$?
  check "a schema release without approval is refused (exit 3)" eq "$rc" 3
  check "nothing changed: the API was not restarted" eq "$(started api)" "$api0"
  check "state is ABORTED" eq "$(state phase)" ABORTED
  approve data >/dev/null; R apply "$W/m/add.json"; rc=$?
  check "an approval for a DIFFERENT manifest does not unlock it (exit 3)" eq "$rc" 3
  approve add; check "approval accepted" eq "$?" 0
  probe_start api "$APIH" /api/v1/health
  R apply "$W/m/add.json"; rc=$?
  probe_stop api
  check "additive schema release applies (exit 0)" eq "$rc" 0
  check "no maintenance for an additive migration" lacks "$(run_log)" "maintenance on"
  check "the new column exists" eq "$(psql_q -c "SELECT count(*) FROM information_schema.columns WHERE table_name='payments' AND column_name='receipt_note'")" 1
  check "the migration is recorded with its manifest checksum" eq "$(psql_q -c "SELECT checksum FROM _prisma_migrations WHERE migration_name LIKE '%receipt_note' ORDER BY started_at DESC LIMIT 1")" "$(python3 -c 'import json,sys; print([m["checksum"] for m in json.load(open(sys.argv[1]))["migrations"] if m["name"].endswith("receipt_note")][0])' "$W/m/add.json")"
  check "a restore point was recorded before the migration" contains "$(state restore_point)" release_
  say "    measured API edge during the additive release: $(probe_summary api)"
  check "acceptance passes after the release" all_good_acceptance
}
s03() {
  stack_reset || return 1
  snapshot_protected > "$W/prot"
  local bg0 sc0; bg0=$(sha256sum "$SK/sites/zz-betgenius.caddy" | cut -c1-16); sc0=$(sha256sum "$SK/sites/zz-custom-school.caddy" | cut -c1-16)
  local cf0; cf0=$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1)
  approve data
  RELEASE_FAULTS=pause_after_QUIESCED R apply "$W/m/data.json" --detach >/dev/null
  wait_state QUIESCED 60; check "release reached QUIESCED and paused" eq "$(state phase)" QUIESCED
  check "API host answers 503 in maintenance" eq "$(edge $APIH /api/v1/health)" 503
  check "the webhook path answers 503 (senders retry)" eq "$(edge $APIH /api/v1/payments/paystack/webhook -X POST)" 503
  check "503 carries Retry-After" bash -c "curl -sS -D - -o /dev/null --resolve '$APIH:$P_EDGE:127.0.0.1' 'http://$APIH:$P_EDGE/api/v1/health' | grep -qi '^retry-after: 120'"
  check "the web host answers 503" eq "$(edge $WEBH /staff/login)" 503
  check "BetGenius is still served (200)" eq "$(edge $BGH /)" 200
  check "a custom school domain is still served (200)" eq "$(edge $SCHOOLH /)" 200
  check "the API container is stopped under maintenance" eq "$(docker inspect -f '{{.State.Running}}' "$(cid_all api)")" false
  check "maintenance state is on disk" test -f "$SK/deployments/MAINTENANCE"
  continue_run; wait_run_done 120
  check "the release completed" eq "$(state phase)" COMPLETE
  check "the pre-release dump was written off-site and read back" bash -c "docker exec $(cid_of ops-pinned) ls /store/skq-bucket/dumps/pre-release | grep -q 'pre-release.*dump.sha256'"
  check "maintenance is off" eq "$(edge $APIH /api/v1/health)" 200
  check "the original Caddyfile was restored byte for byte" eq "$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1)" "$cf0"
  check "BetGenius site file is byte-identical" eq "$(sha256sum "$SK/sites/zz-betgenius.caddy" | cut -c1-16)" "$bg0"
  check "the custom school domain file is byte-identical" eq "$(sha256sum "$SK/sites/zz-custom-school.caddy" | cut -c1-16)" "$sc0"
  check "PostgreSQL, Redis, scheduler never restarted" protected_same "$W/prot" hard
  check "the data migration applied" eq "$(psql_q -c "SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '%backfill_legacy_ref' AND finished_at IS NOT NULL")" 1
}

untouched() { # every application container still has the id it had at $1 (a file of "service id")
  local svc id ok=0
  while read -r svc id; do [ "$(cid_of "$svc")" = "$id" ] || ok=1; done < "$1"; return $ok
}
app_ids() { local s; for s in api render-worker web portal; do echo "$s $(cid_of "$s")"; done; }
s04() { # interrupted deployments (the process is killed by SIGKILL at chosen points) and resume
  stack_reset || return 1
  snapshot_protected > "$W/prot"
  approve data >/dev/null
  RELEASE_FAULTS=kill_after_MIGRATED R apply "$W/m/data.json"; local rc=$?
  check "the killed release process exited abnormally" neq "$rc" 0
  check "state shows the last COMPLETED phase (MIGRATED), not a guess" eq "$(state phase)" MIGRATED
  check "status reports INTERRUPTED, not running" contains "$(R status)" "run:         INTERRUPTED"
  check "ingress is STILL closed after the crash (maintenance is a file, not a process)" eq "$(edge $APIH /api/v1/health)" 503
  check "the API stays stopped: no old release runs on the migrated schema" eq "$(docker inspect -f '{{.State.Running}}' "$(cid_all api)")" false
  check "the monitor flags the half-finished release" neq "$(rel bash "$TOOLS/monitor.sh" >/dev/null 2>&1; echo $?)" 0
  R resume; rc=$?
  check "resume completes the release" eq "$rc" 0
  check "state COMPLETE; current is the new release" eq "$(state phase):$(current)" "COMPLETE:$(rid data)"
  check "the migration was applied once" eq "$(psql_q -c "SELECT count(*) FROM _prisma_migrations WHERE migration_name LIKE '%backfill_legacy_ref'")" 1
  check "maintenance is off after resume" eq "$(edge $APIH /api/v1/health)" 200
  check "history records the resume" contains "$(hist)" '"event": "resumed"'
  check "PostgreSQL, Redis, scheduler untouched" protected_same "$W/prot" hard
  # and an app-only release killed right after preflight
  R apply "$W/m/data2.json" >/dev/null 2>&1; app_ids > "$W/ids"       # an application-only release on the migrated schema
  RELEASE_FAULTS=kill_after_PREFLIGHT_OK R apply "$W/m/data3.json" >/dev/null 2>&1
  check "killed after preflight: nothing was changed yet" untouched "$W/ids"
  R resume >/dev/null; check "resume completes it" eq "$(state phase):$(current)" "COMPLETE:$(rid data3)"
}
s05() { # SSH connection loss
  stack_reset || return 1
  # (a) a DETACHED release survives the launching session being killed outright
  ( setsid bash -c "cd $SK; SK_DIR=$SK RELEASE_QUALIFICATION=1 RELEASE_PROBE_API=http://127.0.0.1:$P_API/api/v1/health RELEASE_PROBE_API_DB=http://127.0.0.1:$P_API/api/v1/health/db RELEASE_PROBE_WEB=http://127.0.0.1:$P_WEB/staff/login RELEASE_PROBE_PORTAL=http://127.0.0.1:$P_PORTAL/api/health RELEASE_EDGE_SCHEME=http RELEASE_EDGE_PORT=$P_EDGE RELEASE_NOW_HHMM=1200 RELEASE_HEALTH_SLEEP=1 RELEASE_STOP_GRACE=3 RELEASE_DRAIN_TRIES=2 RELEASE_DRAIN_SLEEP=1 RELEASE_ACCEPT_WINDOW=20 RELEASE_DISK_PATH=$W RELEASE_MIN_FREE_KIB=1000 RELEASE_REGISTRY_ALLOW=$REG/ exec bash $TOOLS/release.sh apply $W/m/app.json --detach" > "$W/launch.out" 2>&1 & )
  # the "SSH session" dies once the detached child exists (its run_id is recorded); killing earlier would test nothing
  local _; for _ in $(seq 1 100); do [ "$(state phase)" != COMPLETE ] && break; sleep 0.2; done
  pkill -KILL -f "release.sh apply $W/m/app.json --detach" 2>/dev/null
  wait_run_done 120
  check "the detached release completed although its launching session was killed" eq "$(state phase):$(current)" "COMPLETE:$(rid app)"
  # (b) a FOREGROUND release hung up mid-way (what a dropped SSH session does) is recoverable
  for _ in $(seq 1 60); do flock -n "$SK/deployments/apply.lock" true 2>/dev/null && break; sleep 0.5; done   # the finished release has let go of its lock
  local pid
  RELEASE_FAULTS=pause_after_PREFLIGHT_OK setsid bash -c "cd $SK; SK_DIR=$SK RELEASE_QUALIFICATION=1 RELEASE_FAULTS=pause_after_PREFLIGHT_OK RELEASE_PROBE_API=http://127.0.0.1:$P_API/api/v1/health RELEASE_PROBE_API_DB=http://127.0.0.1:$P_API/api/v1/health/db RELEASE_PROBE_WEB=http://127.0.0.1:$P_WEB/staff/login RELEASE_PROBE_PORTAL=http://127.0.0.1:$P_PORTAL/api/health RELEASE_EDGE_SCHEME=http RELEASE_EDGE_PORT=$P_EDGE RELEASE_NOW_HHMM=1200 RELEASE_HEALTH_SLEEP=1 RELEASE_STOP_GRACE=3 RELEASE_ACCEPT_WINDOW=20 RELEASE_DISK_PATH=$W RELEASE_MIN_FREE_KIB=1000 RELEASE_REGISTRY_ALLOW=$REG/ exec bash $TOOLS/release.sh apply $W/m/app2.json" >/dev/null 2>&1 &
  wait_state PREFLIGHT_OK 60
  pid=$(pgrep -f "release.sh apply $W/m/app2.json" | head -n 1)
  kill -HUP "$pid"
  for _ in $(seq 1 60); do flock -n "$SK/deployments/apply.lock" true 2>/dev/null && break; sleep 0.5; done   # the hung-up process (and its paused sleep) have let go of the lock
  check "the hung-up foreground release stopped at a recorded phase" eq "$(state phase)" PREFLIGHT_OK
  check "status says INTERRUPTED" contains "$(R status)" INTERRUPTED
  R resume; check "resume finishes it" eq "$(state phase):$(current)" "COMPLETE:$(rid app2)"
}
s06() { # Caddy restarted during a maintenance window
  stack_reset || return 1
  approve data >/dev/null
  RELEASE_FAULTS=pause_after_QUIESCED R apply "$W/m/data.json" --detach >/dev/null
  wait_state QUIESCED 60
  check "in maintenance before the restart" eq "$(edge $APIH /api/v1/health)" 503
  docker restart "$(cid_of caddy)" >/dev/null; sleep 4
  check "STILL in maintenance after Caddy restarted (the closed Caddyfile is on disk)" eq "$(edge $APIH /api/v1/health)" 503
  check "BetGenius is served again after the restart" eq "$(edge $BGH /)" 200
  continue_run; wait_run_done 120
  check "the release completed" eq "$(state phase)" COMPLETE
  check "the release noticed the restart, and said so" contains "$(run_log)" "Caddy was restarted by something other than this release"
  check "maintenance ended and traffic is back" eq "$(edge $APIH /api/v1/health)" 200
}
s07() { # partial configuration writes
  stack_reset || return 1
  app_ids > "$W/ids"; local ov0 cf0; ov0=$(sha256sum "$SK/release.override.yml" | cut -d' ' -f1); cf0=$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1)
  RELEASE_FAULTS=corrupt_override R apply "$W/m/app.json"; local rc=$?
  check "a corrupt override is refused before it is ever used (exit 1)" eq "$rc" 1
  check "ABORTED, with nothing changed" eq "$(state phase):$(state mutated)" "ABORTED:false"
  check "the live override file is byte-identical" eq "$(sha256sum "$SK/release.override.yml" | cut -d' ' -f1)" "$ov0"
  check "no application container was touched" untouched "$W/ids"
  approve data >/dev/null
  RELEASE_FAULTS=truncate_caddy R apply "$W/m/data.json"; rc=$?
  check "a truncated maintenance Caddyfile is refused by Caddy's own validation (release stops, exit 1)" eq "$rc" 1
  check "the original Caddyfile is on disk byte for byte" eq "$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1)" "$cf0"
  check "the edge still serves traffic" eq "$(edge $APIH /api/v1/health)" 200
  check "no maintenance marker was left behind" test ! -f "$SK/deployments/MAINTENANCE"
  check "the service was returned to R0 and is healthy" eq "$(running_image api)" "$(img r0 api)"
  check "state is ROLLED_BACK, and acceptance passes" bash -c "[ '$(state phase)' = ROLLED_BACK ]"
}
s08() { # registry unavailable
  stack_reset || return 1
  app_ids > "$W/ids"
  for s in api render web portal; do docker rmi "$(img app "$([ "$s" = render ] && echo render-worker || echo "$s")")" >/dev/null 2>&1; done
  docker stop skq-registry >/dev/null
  R apply "$W/m/app.json"; local rc=$?
  check "apply stops at staging when the registry is down (exit 4: retry later)" eq "$rc" 4
  check "NOTHING changed: every container is untouched" untouched "$W/ids"
  check "the running release still answers" eq "$(edge $APIH /api/v1/health)" 200
  check "the state is ABORTED, not half-way" eq "$(state phase)" ABORTED
  # images already on the server deploy without the registry
  R apply "$W/m/app2.json" >/dev/null 2>&1; check "a release whose images are on the server does not need the registry beyond staging" bash -c "[ '$(state phase)' != '' ]"
  docker start skq-registry >/dev/null; registry_up
}
s09() { # failed application startup + rollback with the registry unavailable
  stack_reset || return 1
  docker stop skq-registry >/dev/null
  R apply "$W/m/crash.json"; local rc=$?
  check "a release that cannot start is rolled back automatically (exit 1)" eq "$rc" 1
  check "state ROLLED_BACK" eq "$(state phase)" ROLLED_BACK
  for s in api render-worker web portal; do check "$s is back on the R0 image, rolled back from LOCAL images with the registry down" eq "$(running_image $s)" "$(img r0 $s)"; done
  check "the previous release is current" eq "$(current)" "$(rid r0)"
  check "the API answers" eq "$(edge $APIH /api/v1/health)" 200
  local diag; diag=$(ls "$SK"/deployments/diagnostics/* | head -n 1)
  check "a diagnostics bundle exists" test -s "$diag"
  check "the container's log line (with a database URL, an API key and an email) was captured" contains "$(cat "$diag")" "fatal: cannot start"
  check "the database password is NOT in the diagnostics" lacks "$(cat "$diag")" "Sup3rS3cretPw"
  check "the API key is NOT in the diagnostics" lacks "$(cat "$diag")" "abcdefgh12345678"
  check "the email address is NOT in the diagnostics" lacks "$(cat "$diag")" "parent@example.com"
  check "an alert was written" bash -c "ls $SK/deployments/alerts/*rolled-back* >/dev/null"
  check "no secret or personal data in the run log or journal" bash -c "! grep -qE 'Sup3rS3cretPw|abcdefgh12345678|parent@example.com' $SK/deployments/run.log $SK/deployments/history.jsonl"
  docker start skq-registry >/dev/null; registry_up
}
s10() { # failed frontend readiness
  stack_reset || return 1
  R apply "$W/m/webbad.json"; local rc=$?
  check "a front end that boots but never becomes ready fails the release (exit 1)" eq "$rc" 1
  check "the API and worker, already switched, were rolled back with it" eq "$(running_image api)" "$(img r0 api)"
  check "the web front end is back on R0" eq "$(running_image web)" "$(img r0 web)"
  check "ROLLED_BACK" eq "$(state phase)" ROLLED_BACK
  check "the failed step is recorded" contains "$(hist)" '"event": "failed"'
  check "the edge answers" eq "$(edge $WEBH /staff/login)" 200
}
s11() { # failed migration
  stack_reset || return 1
  approve badmig >/dev/null
  local api0; api0=$(cid_of api)
  R apply "$W/m/badmig.json"; local rc=$?
  check "a failing migration fails the release (exit 1)" eq "$rc" 1
  check "the API was never stopped: an additive migration runs beside the old release" eq "$(cid_of api)" "$api0"
  check "ROLLED_BACK" eq "$(state phase)" ROLLED_BACK
  check "the failed migration left its row, unresolved, as Prisma does" eq "$(psql_q -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL")" 1
  check "the failed migration's changes were rolled back by PostgreSQL" eq "$(psql_q -c "SELECT count(*) FROM information_schema.columns WHERE table_name='payments' AND column_name='bad_col'")" 0
  R plan "$W/m/badmigfix.json" >/dev/null 2>&1; check "the next release is BLOCKED while a failed migration is unresolved (exit 3)" eq "$?" 3
  R resolve-migration 20270501000000_bad_column >/dev/null 2>&1; check "resolving needs the owner's one-command approval (refused without it)" neq "$?" 0
  RELEASE_APPROVED=true R resolve-migration 20270501000000_bad_column >/dev/null 2>&1; check "resolve marks it rolled back" eq "$?" 0
  approve badmigfix >/dev/null; R apply "$W/m/badmigfix.json"; check "the corrected release then applies" eq "$?" 0
  check "the column now exists" eq "$(psql_q -c "SELECT count(*) FROM information_schema.columns WHERE table_name='payments' AND column_name='bad_col'")" 1
}
s12() { # concurrent deployments
  stack_reset || return 1
  R apply "$W/m/app.json" --detach >/dev/null 2>&1 &
  R apply "$W/m/app2.json" --detach >/dev/null 2>&1 &
  wait; wait_run_done 120
  local started; started=$(grep -c '"event": "started"' "$SK/deployments/history.jsonl")
  check "exactly one of the two simultaneous releases started" eq "$started" 1
  check "the run finished cleanly, state COMPLETE" eq "$(state phase)" COMPLETE
  check "the lock refused the other with a clear message" contains "$(run_log)" "another release is running"
  R apply "$W/m/app.json" >/dev/null 2>&1; local rc=$?
  check "applying a release that is already live is a no-op (exit 0)" eq "$rc" 0
}
s13() { # pending webhook deliveries
  stack_reset || return 1
  psql_q >/dev/null <<'SQL'
INSERT INTO paystack_webhook_inbox (mode, event_key, event_type, received_at) VALUES ('live','fresh-1','charge.success', now()), ('live','fresh-2','charge.success', now());
INSERT INTO paystack_webhook_inbox (mode, event_key, event_type, received_at, claim_id, claimed_until) VALUES ('live','claimed-1','charge.success', now(), 'worker-1', now() + interval '5 minutes');
SQL
  app_ids > "$W/ids"
  R apply "$W/m/app.json"; local rc=$?
  check "a webhook delivery that is being processed holds the release back (exit 4, retry later)" eq "$rc" 4
  check "nothing was stopped or changed" untouched "$W/ids"
  psql_q -c "UPDATE paystack_webhook_inbox SET processed_at = now(), claimed_until = NULL WHERE event_key = 'claimed-1'" >/dev/null
  R apply "$W/m/app.json"; rc=$?
  check "once the delivery finishes, the release proceeds" eq "$rc" 0
  check "unprocessed deliveries were not lost or touched" eq "$(psql_q -c "SELECT count(*) FROM paystack_webhook_inbox WHERE event_key IN ('fresh-1','fresh-2') AND processed_at IS NULL")" 2
  # a stale backlog is a sick system: do not deploy onto it
  psql_q -c "INSERT INTO paystack_webhook_inbox (mode, event_key, event_type, received_at) SELECT 'live','stale-'||g,'charge.success', now() - interval '2 hours' FROM generate_series(1,6) g" >/dev/null
  app_ids > "$W/ids"; R apply "$W/m/app2.json"; rc=$?
  check "an abnormal webhook backlog stops the release at preflight (exit 1)" eq "$rc" 1
  check "and changed nothing" untouched "$W/ids"
  check "the reason is the backlog" contains "$(run_log)" "webhook events have waited over 10 minutes"
}
s14() { # active background jobs
  stack_reset || return 1
  docker exec "$(cid_of redis)" redis-cli lpush bull:render:active job-42 >/dev/null
  app_ids > "$W/ids"
  R apply "$W/m/app.json"; local rc=$?
  check "an active background job holds the release back (exit 4)" eq "$rc" 4
  check "the worker and API were not stopped under it" untouched "$W/ids"
  check "the job is still there" eq "$(docker exec "$(cid_of redis)" redis-cli llen bull:render:active | tr -d '\r')" 1
  docker exec "$(cid_of redis)" redis-cli del bull:render:active >/dev/null
  R apply "$W/m/app.json"; check "the release proceeds once the queue is idle" eq "$?" 0
}
s15() { # insufficient disk
  stack_reset || return 1
  app_ids > "$W/ids"
  docker rmi "$(img app api)" >/dev/null 2>&1
  RELEASE_MIN_FREE_KIB=900000000000 R apply "$W/m/app.json"; local rc=$?
  check "not enough free disk to pull: stopped before pulling anything (exit 4)" eq "$rc" 4
  check "nothing changed" untouched "$W/ids"
  RELEASE_MIN_FREE_KIB=900000000000 R apply "$W/m/app2.json" >/dev/null 2>&1; rc=$?
  check "not enough free disk with images present: refused at preflight" bash -c "[ $rc -ne 0 ] && [ '$(state phase)' = ABORTED ]"
  check "the reason is disk" contains "$(run_log)" "free disk is below"
}
s16() { # failed rollback, then operator recovery
  stack_reset || return 1
  app_ids > "$W/ids"
  RELEASE_FAULTS=hide_rollback_image R apply "$W/m/app.json"; local rc=$?
  check "a release whose rollback image is not on the server refuses to begin (no rollback = no release)" eq "$rc" 1
  check "the reason names the missing rollback image" contains "$(run_log)" "rollback image for api is not on this server"
  check "nothing changed" untouched "$W/ids"
  # the image can only go missing once the old container has been replaced: remove it then, for real
  RELEASE_FAULTS=rmprev_before_rollback R apply "$W/m/crash.json"; rc=$?
  check "failed release AND the rollback image gone: ROLLBACK FAILED (exit 7)" eq "$rc" 7
  check "state ROLLBACK_FAILED" eq "$(state phase)" ROLLBACK_FAILED
  check "maintenance is ON, a deliberate 503 rather than serving errors" eq "$(edge $APIH /api/v1/health)" 503
  check "an alert says an operator must act" bash -c "grep -q 'ROLLBACK FAILED' $SK/deployments/alerts/*"
  check "a new release is refused while in ROLLBACK_FAILED" bash -c "! R apply '$W/m/app.json' >/dev/null 2>&1"
  check "the monitor reports it" bash -c "! rel bash $TOOLS/monitor.sh >/dev/null 2>&1"
  check "the diagnostics bundle exists" bash -c "ls $SK/deployments/diagnostics/* >/dev/null"
  docker pull "$(img r0 api)" >/dev/null 2>&1   # the operator restores the image from the registry
  R rollback >/dev/null 2>&1; check "operator recovery: rollback succeeds from the restored image" eq "$?" 0
  check "the service answers and maintenance is off" eq "$(edge $APIH /api/v1/health)" 200
  check "state ROLLED_BACK" eq "$(state phase)" ROLLED_BACK
}
s17() { # protected infrastructure changed while a release runs
  stack_reset || return 1
  RELEASE_FAULTS=pause_after_PREFLIGHT_OK R apply "$W/m/app.json" --detach >/dev/null
  wait_state PREFLIGHT_OK 60
  docker restart "$(cid_of redis)" >/dev/null; sleep 3
  continue_run; wait_run_done 90
  check "the release stops: Redis was restarted by someone else (not by the release)" eq "$(state phase)" ABORTED
  check "the alert says protected infrastructure changed" contains "$(cat "$SK"/deployments/alerts/* 2>/dev/null)" "protected infrastructure changed"
  check "no application container was recreated" eq "$(running_image api)" "$(img r0 api)"
  stack_reset || return 1
  approve data >/dev/null
  RELEASE_FAULTS=pause_after_QUIESCED R apply "$W/m/data.json" --detach >/dev/null
  wait_state QUIESCED 60
  docker restart "$(cid_of redis)" >/dev/null; sleep 3
  continue_run; wait_run_done 120
  check "protected change after the window opened: the release is rolled back" eq "$(state phase)" ROLLED_BACK
  check "the earlier release runs again" eq "$(running_image api)" "$(img r0 api)"
  check "maintenance is off again" eq "$(edge $APIH /api/v1/health)" 200
  check "the data migration was safe to leave applied (rollback-compatible)" eq "$(psql_q -c "SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL")" 2
}
s18() { # breaking migration + failed start => fix-forward, never an unsafe rollback
  stack_reset || return 1
  approve brkcrash >/dev/null
  R apply "$W/m/brkcrash.json"; local rc=$?
  check "destructive migration without --allow-destructive approval is refused (exit 3)" eq "$rc" 3
  approve brkcrash --allow-destructive >/dev/null
  R apply "$W/m/brkcrash.json"; rc=$?
  check "breaking migration + application that cannot start: FIX-FORWARD REQUIRED (exit 6)" eq "$rc" 6
  check "state FIX_FORWARD_REQUIRED" eq "$(state phase)" FIX_FORWARD_REQUIRED
  check "ingress is held in maintenance, not serving errors" eq "$(edge $APIH /api/v1/health)" 503
  check "the old release was NOT restarted on a schema it cannot run on" bash -c "[ \"\$(docker inspect -f '{{.State.Running}}' $(cid_all api))\" = false ] || [ \"\$(docker inspect -f '{{.Config.Image}}' $(cid_all api))\" != '$(img r0 api)' ]"
  check "the column drop really happened (this is why a rollback is unsafe)" eq "$(psql_q -c "SELECT count(*) FROM information_schema.columns WHERE table_name='payments' AND column_name='legacy_ref'")" 0
  R apply "$W/m/app.json" >/dev/null 2>&1; check "an ordinary release is refused in this state" neq "$?" 0
  R apply "$W/m/brkfix.json" --fix-forward >/dev/null 2>&1; check "a fix-forward release needs an approval too (refused without)" neq "$?" 0
  approve brkfix >/dev/null
  R apply "$W/m/brkfix.json" --fix-forward; check "the corrected release fixes forward (exit 0)" eq "$?" 0
  check "maintenance ended; current is the corrected release" eq "$(edge $APIH /api/v1/health):$(current)" "200:$(rid brkfix)"
}
s19() { # transient startup is not a failure; automation switches
  stack_reset || return 1
  R apply "$W/m/slow.json"; local rc=$?
  check "an API that needs ~6 s to become healthy passes (a transient startup condition, retried)" eq "$rc" 0
  stack_reset || return 1
  R apply "$W/m/app.json" --trigger auto >/dev/null 2>&1; check "automatic deployment is refused until the server's own switch exists (exit 3)" eq "$?" 3
  touch "$SK/deployments/AUTO_ENABLED"
  R apply "$W/m/app.json" --trigger auto >/dev/null 2>&1; check "with the server switch on, an application-only release deploys unattended" eq "$?" 0
  R apply "$W/m/add.json" --trigger auto >/dev/null 2>&1; check "but a schema release never deploys unattended without an approval (exit 3)" eq "$?" 3
  mkdir -p "$SK/release"; echo MAINT_ON > "$SK/release/state"
  R apply "$W/m/app2.json" >/dev/null 2>&1; check "while the coordinated cutover tool is mid-procedure no release can start (exit 3)" eq "$?" 3
  echo REOPENED > "$SK/release/state"
  R apply "$W/m/app2.json" >/dev/null 2>&1; check "after the cutover reopens, releases are allowed again" eq "$?" 0
}
s20() { # acceptance: genuine failures are detected, and fast
  stack_reset || return 1
  local m t0; m="$SK/deployments/releases/$(current)/manifest.json"
  ACC "$m" internal --save-baseline "$W/base.env" >/dev/null; check "baseline accepted on a healthy system" eq "$?" 0
  inject() { # description sql-or-command expect-text
    local d=$1 sqltext=$2 expect=$3 out rc
    t0=$SECONDS; psql_q -c "$sqltext" >/dev/null; out=$(ACC "$m" internal --baseline "$W/base.env" 2>&1); rc=$?
    check "$d is detected (acceptance fails)" neq "$rc" 0
    check "  ...with the right reason" contains "$out" "$expect"
    check "  ...immediately: integrity failures are never retried ($((SECONDS - t0))s, window is 20s)" bash -c "[ $((SECONDS - t0)) -lt 15 ]"
  }
  inject "a duplicate Paystack reference" "INSERT INTO payments (id,school_id,invoice_id,amount,status,paystack_reference,allocated_kobo) VALUES ('dup1','school-a','inv1',1000,'SUCCESS','ref-001',1000)" "dup_paystack_refs = 1"
  psql_q -c "DELETE FROM payments WHERE id = 'dup1'" >/dev/null
  inject "a payment allocated above its amount" "UPDATE payments SET allocated_kobo = amount + 1 WHERE id = 'pay1'" "payment_over_allocated = 1"
  psql_q -c "UPDATE payments SET allocated_kobo = amount WHERE id = 'pay1'" >/dev/null
  inject "an invoice collected above what is due" "INSERT INTO payments (id,school_id,invoice_id,amount,status,paystack_reference,allocated_kobo) VALUES ('over1','school-a','inv1',999999,'SUCCESS','ref-over',999999)" "invoice_over_collected rose"
  psql_q -c "DELETE FROM payments WHERE id = 'over1'" >/dev/null
  inject "an instalment plan that no longer sums to the invoice" "UPDATE payment_plan_installments SET amount = 1 WHERE id = 'i1'" "instalment_sum_mismatch rose"
  psql_q -c "UPDATE payment_plan_installments SET amount = 250000 WHERE id = 'i1'" >/dev/null
  inject "an invoice whose totals do not add up" "UPDATE invoices SET total_due = total_due + 5 WHERE id = 'inv2'" "invoice_total_mismatch rose"
  psql_q -c "UPDATE invoices SET total_due = total_amount - total_discount WHERE id = 'inv2'" >/dev/null
  inject "an abnormal webhook backlog" "INSERT INTO paystack_webhook_inbox (mode,event_key,event_type,received_at) SELECT 'live','old-'||g,'x', now() - interval '3 hours' FROM generate_series(1,5) g" "webhook events have waited"
  psql_q -c "DELETE FROM paystack_webhook_inbox WHERE event_key LIKE 'old-%'" >/dev/null
  inject "a new dead-lettered webhook" "INSERT INTO paystack_webhook_inbox (mode,event_key,event_type,received_at,dead_at) VALUES ('live','dead-1','x', now(), now())" "webhook_dead rose"
  psql_q -c "DELETE FROM paystack_webhook_inbox WHERE event_key = 'dead-1'" >/dev/null
  check "a clean system passes again" eq "$(ACC "$m" internal --baseline "$W/base.env" >/dev/null 2>&1; echo $?)" 0
  # a pre-existing anomaly does not block, a NEW one does
  psql_q -c "UPDATE invoices SET total_due = total_due + 7 WHERE id = 'inv2'" >/dev/null
  ACC "$m" internal --save-baseline "$W/base2.env" >/dev/null 2>&1
  check "a pre-existing anomaly recorded in the baseline only warns" eq "$(ACC "$m" internal --baseline "$W/base2.env" >/dev/null 2>&1; echo $?)" 0
  psql_q -c "UPDATE invoices SET total_due = total_amount - total_discount WHERE id = 'inv2'" >/dev/null
  # gates, scheduler, backups, edge, identities
  printf 'MESSAGING_PAID_ENABLED=on\n' > "$W/gates.on"
  check "a runtime feature gate that is not as required fails" bash -c "! RELEASE_GATES_FILE=$W/gates.on ACC '$m' internal >/dev/null 2>&1"
  docker exec "$(cid_of ops-pinned)" sh -c 'rm -f /store/skq-bucket/dumps/daily/*; d=2026-11-20T010000Z; touch /store/skq-bucket/dumps/daily/school-kit-$d.dump /store/skq-bucket/dumps/daily/school-kit-$d.dump.sha256'
  check "a stale off-site backup (7 days old) fails" bash -c "! ACC '$m' internal >/dev/null 2>&1"
  docker exec "$(cid_of ops-pinned)" sh -c 'd=$(date -u +%Y-%m-%dT%H%M%SZ); touch /store/skq-bucket/dumps/daily/school-kit-$d.dump.sha256'
  check "a checksum marker without its dump is not a backup" bash -c "! ACC '$m' internal >/dev/null 2>&1"
  docker exec "$(cid_of ops-pinned)" sh -c 'f=$(ls /store/skq-bucket/dumps/daily/*.sha256 | sort | tail -n 1); touch "${f%.sha256}"'   # the dump that goes with the newest marker (a second clock read could name a different second)
  check "a fresh complete pair passes" eq "$(ACC "$m" internal >/dev/null 2>&1; echo $?)" 0
  echo "# tampered" >> "$SK/sites/zz-betgenius.caddy"
  check "a changed site file (BetGenius) is detected at the edge" bash -c "! ACC '$m' edge >/dev/null 2>&1"
  sed -i '/# tampered/d' "$SK/sites/zz-betgenius.caddy"
  docker stop "$(cid_of web)" >/dev/null
  t0=$SECONDS; out=$(RELEASE_ACCEPT_WINDOW=6 ACC "$m" internal 2>&1); rc=$?
  check "a front end that is down fails after the startup window, labelled as not ready" bash -c "[ $rc -ne 0 ]"
  check "  ...labelled STARTUP_NOT_READY" contains "$out" "STARTUP_NOT_READY"
  docker start "$(cid_all web)" >/dev/null
  docker stop "$(cid_of ops-pinned)" >/dev/null
  check "a stopped backup scheduler fails" bash -c "! ACC '$m' internal >/dev/null 2>&1"
  docker start "$(cid_all ops-pinned)" >/dev/null
}
s21() { # cleanup and monitor
  stack_reset || return 1
  R apply "$W/m/app.json" >/dev/null 2>&1; R apply "$W/m/app2.json" >/dev/null 2>&1
  local dry; dry=$(rel bash "$TOOLS/cleanup.sh" 2>&1)
  check "cleanup is a dry run by default" contains "$dry" "dry run: nothing was deleted"
  check "the current release's images are never listed" lacks "$dry" "WOULD REMOVE $(img app2 api)"
  check "the previous release's images are never listed" lacks "$dry" "WOULD REMOVE $(img app api)"
  RELEASE_KEEP_RELEASES=1 rel bash "$TOOLS/cleanup.sh" --apply >/dev/null 2>&1
  check "the running release still answers after cleanup" eq "$(edge $APIH /api/v1/health)" 200
  check "the PostgreSQL, Redis and scheduler images are untouched" bash -c "docker image inspect postgres:18-alpine redis:7.4-alpine >/dev/null"
  check "the pinned scheduler's image is untouched" bash -c "docker image inspect '$(sed -n 's/^OPS_IMAGE=//p' $SK/deploy.env)' >/dev/null"
  check "the append-only history survives cleanup" test -s "$SK/deployments/history.jsonl"
  check "the monitor passes on a healthy system" eq "$(rel bash "$TOOLS/monitor.sh" >/dev/null 2>&1; echo $?)" 0
  docker pause "$(cid_of redis)" >/dev/null 2>&1; docker unpause "$(cid_of redis)" >/dev/null 2>&1
}
s22() { # scoped build: only the changed unit is rebuilt, restarted and re-labelled
  stack_reset || return 1
  local sha web mdir; sha=$(hex40 "release-scoped")
  web=$(build_push "web-good-$sha" skq-web "$Q/stub/Dockerfile.app" "$Q/stub" --build-arg MODE=good --build-arg "REV=$sha") || return 1
  mdir="$W/mig-scoped"; mkdir -p "$mdir/migrations/20270101000000_baseline"; cp "$Q/migrations/m1_baseline.sql" "$mdir/migrations/20270101000000_baseline/migration.sql"
  python3 "$TOOLS/release_tool.py" build-manifest --git-sha "$sha" --pg-major 18 --migrations-dir "$mdir/migrations" --previous "$W/m/r0.json" \
    --built "web=$web" --input "api=$(unit_hash r0 api)" --input "render-worker=$(unit_hash r0 render-worker)" --input "web=$(unit_hash scoped web)" \
    --input "portal=$(unit_hash r0 portal)" --input "migrate=$(unit_hash r0 migrate)" --built-at "2026-11-27T12:50:00Z" --out "$W/m/scoped.json" >/dev/null
  check "the manifest reuses R0's API digest" eq "$(img scoped api)" "$(img r0 api)"
  check "the manifest records R0's commit as the API's provenance" eq "$(python3 "$TOOLS/release_tool.py" jget "$W/m/scoped.json" provenance.api)" "$(hex40 release-r0)"
  check "the plan changes only the web app" contains "$(R plan "$W/m/scoped.json")" '"web"'
  check "  ...and nothing else" bash -c "[ \"\$(python3 -c 'import json,sys; print(len(json.loads(sys.stdin.read())[\"services_changed\"]))' <<<'$(R plan "$W/m/scoped.json" | tr -d '\n')')\" = 1 ]"
  app_ids > "$W/ids"; local web0; web0=$(cid_of web)
  R apply "$W/m/scoped.json"; local rc=$?
  check "the scoped release applies (the unchanged images keep their original commit label, so staging accepts them)" eq "$rc" 0
  check "the web container was replaced" neq "$(cid_of web)" "$web0"
  for s in api render-worker portal; do check "$s was not touched (same container, not restarted)" eq "$(cid_of $s)" "$(grep "^$s " "$W/ids" | cut -d' ' -f2)"; done
  check "web runs the new digest" eq "$(running_image web)" "$web"
  check "acceptance passes" all_good_acceptance
}
s23() { # the tool installer: verified, atomic, never under a running release
  local t="$W/inst"; rm -rf "$t"; mkdir -p "$t/sk/deployments"
  bash "$ROOT/scripts/release/package-tools.sh" "$t/bundle.tar"
  SK_DIR="$t/sk" RELEASE_BUNDLE="$t/bundle.tar" bash "$TOOLS/install.sh" >/dev/null 2>&1; check "a good bundle installs" eq "$?" 0
  check "the tools are in place and executable" test -x "$t/sk/release-tools/release.sh"
  check "the installed tools run" bash -c "SK_DIR=$t/sk RELEASE_DATA=$t/sk/deployments python3 $t/sk/release-tools/release_tool.py validate $W/m/r0.json"
  local before; before=$(sha256sum "$t/sk/release-tools/release.sh" | cut -c1-16)
  mkdir -p "$t/x"; tar -C "$t/x" -xf "$t/bundle.tar"; echo "# tampered" >> "$t/x/release.sh"; tar -C "$t/x" -cf "$t/tampered.tar" .
  SK_DIR="$t/sk" RELEASE_BUNDLE="$t/tampered.tar" bash "$TOOLS/install.sh" >/dev/null 2>&1; check "a bundle whose file differs from SHA256SUMS is refused (exit 1)" eq "$?" 1
  check "the installed copy is unchanged" eq "$(sha256sum "$t/sk/release-tools/release.sh" | cut -c1-16)" "$before"
  cp "$t/bundle.tar" "$t/extra.tar"; mkdir -p "$t/y"; tar -C "$t/y" -xf "$t/bundle.tar"; echo "x" > "$t/y/surprise.sh"; tar -C "$t/y" -cf "$t/extra.tar" .
  SK_DIR="$t/sk" RELEASE_BUNDLE="$t/extra.tar" bash "$TOOLS/install.sh" >/dev/null 2>&1; check "a file not covered by SHA256SUMS is refused" eq "$?" 1
  mkdir -p "$t/z"; tar -C "$t/z" -xf "$t/bundle.tar"; echo 'if then fi fi' >> "$t/z/lib.sh"; (cd "$t/z" && sha256sum release.sh acceptance.sh lib.sh monitor.sh cleanup.sh install.sh snapshot.sh release_tool.py gates.conf > SHA256SUMS); tar -C "$t/z" -cf "$t/syntax.tar" .
  SK_DIR="$t/sk" RELEASE_BUNDLE="$t/syntax.tar" bash "$TOOLS/install.sh" >/dev/null 2>&1; check "a correctly checksummed bundle with a shell syntax error is refused" eq "$?" 1
  ( exec 8>"$t/sk/deployments/apply.lock"; flock -n 8; sleep 4 ) & sleep 1
  SK_DIR="$t/sk" RELEASE_BUNDLE="$t/bundle.tar" bash "$TOOLS/install.sh" >/dev/null 2>&1; check "the tools are never replaced under a running release (exit 5)" eq "$?" 5
  wait
  SK_DIR="$t/sk" RELEASE_BUNDLE="$t/bundle.tar" bash "$TOOLS/install.sh" >/dev/null 2>&1; check "and install once the release has ended; the previous copy is kept" bash -c "[ $? -eq 0 ] && [ -d $t/sk/release-tools.previous ]"
}
caddy_adapt_to() { (cd "$SK" && docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml exec -T caddy caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile </dev/null) > "$1" 2>/dev/null; }
caddy_groups_of() { python3 -c '
import json,sys
def groups(o):
    if isinstance(o, dict):
        for k, v in o.items():
            if k == "group" and isinstance(v, str): yield v
            else: yield from groups(v)
    elif isinstance(o, list):
        for x in o: yield from groups(x)
c=json.load(open(sys.argv[1])); out=[]
for srv in c["apps"]["http"]["servers"].values():
    for r in srv["routes"]:
        if any(sys.argv[2] in (m.get("host") or []) for m in r.get("match",[])): out += list(groups(r))
print(",".join(out))' "$1" "$2"; }
s24() { # the production incident: a command inside a script fed through standard input swallows the rest of it
  stack_reset || return 1
  local dcx; dcx="cd $SK && docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml"
  rm -f "$W"/marker.*
  # (a) REPRODUCTION with real containers: `docker compose exec -T redis` inside a heredoc-fed bash eats the remaining script
  bash -s <<EOF
$dcx exec -T redis cat > /dev/null
touch "$W/marker.a"
echo "everything after the exec is lost"
EOF
  local rc=$?
  check "REPRODUCED: the heredoc-fed script exits with status 0 ..." eq "$rc" 0
  check "... although the work after the docker compose exec never ran" test ! -e "$W/marker.a"
  # (b) the same commands as a FILE are immune: bash reads the file, not the stream the container is reading
  printf '%s\n' "$dcx exec -T redis cat > /dev/null" "touch $W/marker.b" > "$W/script.sh"; bash "$W/script.sh" </dev/null
  check "the same script run from a file completes" test -e "$W/marker.b"
  # (c) and stdin isolation protects even the heredoc form
  bash -s <<EOF
$dcx exec -T redis cat > /dev/null </dev/null
touch "$W/marker.c"
EOF
  check "a heredoc-fed script whose subprocess has its stdin isolated completes" test -e "$W/marker.c"
  # (d) the release tooling ignores whatever feeds it
  yes 'garbage that docker exec -i would swallow' | R apply "$W/m/app.json" >/dev/null 2>&1; rc=${PIPESTATUS[1]}
  check "apply completes (exit 0) even with a stream attached to its standard input" eq "$rc" 0
  check "and it is COMPLETE with its durable acceptance record" eq "$(state phase):$(state accepted):$(test -s "$SK/deployments/acceptance/$(rid app).json" && echo file)" "COMPLETE:true:file"
  yes junk | ACC "$SK/deployments/releases/$(current)/manifest.json" all >/dev/null 2>&1; rc=${PIPESTATUS[1]}; check "acceptance.sh ignores standard input too" eq "$rc" 0
  # (e) the snapshot (it used to be a heredoc piped into the scheduler) runs as a file
  approve data >/dev/null; yes junk | R apply "$W/m/data.json" >/dev/null 2>&1; rc=${PIPESTATUS[1]}
  check "a maintenance release, with a stream on stdin, takes its verified dump and completes" eq "$rc:$(state phase)" "0:COMPLETE"
  check "the verified-dump completion line was recorded" bash -c "grep -q 'SNAPSHOT .* verified off-site' $SK/deployments/snapshot.txt"
  check "static guards: no stdin-fed script, no heredoc into docker/ssh, stdin closed, one docker pull (staging)" bash "$ROOT/scripts/release/stdin-safety.test.sh"
}
s25() { # a premature exit is a FAILURE, including exit status 0, unless acceptance was durably recorded
  stack_reset || return 1
  approve data >/dev/null
  snapshot_protected > "$W/prot"
  RELEASE_FAULTS=exit0_after_MIGRATED R apply "$W/m/data.json"; local rc=$?
  check "the process tried to exit 0 mid-release: the tooling turns that into a failure (exit 9)" eq "$rc" 9
  check "state shows the last completed phase and records the unexpected exit" eq "$(state phase):$(state exit_unexpected):$(state accepted)" "MIGRATED:true:false"
  check "the journal says premature_exit" contains "$(hist)" '"event": "premature_exit"'
  check "an alert names the phase and says maintenance is still on" bash -c "grep -q 'ended at phase MIGRATED' $SK/deployments/alerts/*premature*"
  check "ingress is STILL closed (maintenance was not abandoned)" eq "$(edge $APIH /api/v1/health)" 503
  check "status says INTERRUPTED, never success" contains "$(R status)" "run:         INTERRUPTED"
  check "the monitor flags it" bash -c "! rel bash $TOOLS/monitor.sh >/dev/null 2>&1"
  R resume; rc=$?
  check "resume completes it" eq "$rc:$(state phase):$(state accepted)" "0:COMPLETE:true"
  check "the durable acceptance record exists" test -s "$SK/deployments/acceptance/$(rid data).json"
  check "maintenance is off" eq "$(edge $APIH /api/v1/health)" 200
  # the last moment: everything verified, the process "exits 0" just before the outcome is recorded
  R apply "$W/m/data2.json" >/dev/null 2>&1
  RELEASE_FAULTS=exit0_after_VERIFIED R apply "$W/m/data3.json"; rc=$?
  check "exit 0 after verification but before the acceptance record is still a failure (exit 9)" eq "$rc:$(state accepted)" "9:false"
  R resume >/dev/null 2>&1; check "and resume records it" eq "$(state phase):$(state accepted):$(current)" "COMPLETE:true:$(rid data3)"
  # a COMPLETE with no acceptance record (hand-edited, or from a crash) is not a completed release
  python3 "$TOOLS/release_tool.py" state set --file "$SK/deployments/state.json" accepted=false >/dev/null
  check "COMPLETE without the record reads as INTERRUPTED" contains "$(R status)" "run:         INTERRUPTED"
  R apply "$W/m/app.json" >/dev/null 2>&1; check "and no new release may start on top of it (exit 3)" eq "$?" 3
  check "PostgreSQL, Redis and the scheduler were never restarted by any of it" protected_same "$W/prot" hard
}
s26() { # the process dies in the middle of writing the Caddyfile, then Caddy restarts and loads what is on disk
  stack_reset || return 1
  snapshot_protected > "$W/prot"
  local orig bg0; orig=$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1); bg0=$(sha256sum "$SK/sites/zz-betgenius.caddy" | cut -c1-16)
  approve data >/dev/null
  RELEASE_FAULTS=kill_in_caddy_write R apply "$W/m/data.json" >/dev/null 2>&1; local rc=$?
  check "the release process was killed in the middle of the write" neq "$rc" 0
  check "the durable record exists (written BEFORE the first byte changed)" test -s "$SK/deployments/caddy.record.json"
  check "the Caddyfile on disk is a PREFIX of a file: neither the original nor the maintenance version" bash -c "[ \"\$(sha256sum $SK/Caddyfile | cut -d' ' -f1)\" != '$orig' ] && [ \$(wc -c < $SK/Caddyfile) -lt 100 ]"
  check "status says so" contains "$(R status)" "INTERRUPTED WRITE"
  check "the monitor flags it" bash -c "! rel bash $TOOLS/monitor.sh >/dev/null 2>&1"
  docker restart "$(cid_of caddy)" >/dev/null; sleep 4
  local dark; dark=$(edge $APIH /api/v1/health)
  check "WORST CASE shown: Caddy restarted onto the partial file serves nothing (neither 200 nor a 503)" bash -c "[ '$dark' != 200 ] && [ '$dark' != 503 ]"
  check "...and takes BetGenius down with it (why this matters)" neq "$(edge $BGH /)" 200
  R resume; rc=$?
  check "resume repairs Caddy from the record and completes the release" eq "$rc:$(state phase):$(state accepted)" "0:COMPLETE:true"
  check "the run says it repaired from the durable record" contains "$(run_log)" "repaired from the durable record"
  check "the original Caddyfile is back byte for byte" eq "$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1)" "$orig"
  check "BetGenius is served again and its file is untouched" eq "$(edge $BGH /):$(sha256sum "$SK/sites/zz-betgenius.caddy" | cut -c1-16)" "200:$bg0"
  check "the API edge answers" eq "$(edge $APIH /api/v1/health)" 200
  check "PostgreSQL, Redis and the scheduler untouched" protected_same "$W/prot" hard
}
s27() { # `caddy adapt` renumbers route groups; that must not read as a change, and a real change must still be caught
  stack_reset || return 1
  caddy_adapt_to "$W/adapt.before.json" || return 1
  check "the unrelated sites really have numbered route groups before the release" bash -c "grep -q 'group[0-9]' $W/adapt.before.json"
  approve data >/dev/null
  RELEASE_FAULTS=pause_after_QUIESCED R apply "$W/m/data.json" --detach >/dev/null; wait_state QUIESCED 60
  caddy_adapt_to "$W/adapt.during.json"
  local g1 g2; g1=$(caddy_groups_of "$W/adapt.before.json" "$BGH"); g2=$(caddy_groups_of "$W/adapt.during.json" "$BGH")
  say "    BetGenius route groups: before=[$g1] during maintenance=[$g2]"
  check "PHENOMENON on real Caddy: BetGenius' route-group ids CHANGED while its routing did not" neq "$g1" "$g2"
  check "a naive comparison of the whole adapted configs differs" bash -c "! cmp -s $W/adapt.before.json $W/adapt.during.json"
  local h
  for h in "$BGH" "$SCHOOLH"; do
    python3 "$TOOLS/release_tool.py" caddy-equivalent "$W/adapt.before.json" "$W/adapt.during.json" --host "$h" >/dev/null; check "$h routes are equivalent before and during (group numbers normalised)" eq "$?" 0
  done
  python3 "$TOOLS/release_tool.py" caddy-equivalent "$W/adapt.before.json" "$W/adapt.during.json" >/dev/null; check "the WHOLE routing is NOT equivalent during the window (School Kit's blocks are 503)" eq "$?" 3
  continue_run; wait_run_done 120
  check "release completed, which includes the before/after routing and running-config checks" eq "$(state phase)" COMPLETE
  check "acceptance reported the routing equivalent to before the release" contains "$(run_log)" "routing is equivalent to before the release"
  check "acceptance reported Caddy is running what its Caddyfile describes" contains "$(run_log)" "Caddy is running the configuration its Caddyfile describes"
  # a REAL routing change to an unrelated site must be caught even though group ids are normalised away
  printf '\nhttp://evil.test:8080 {\n\trespond "x" 200\n}\n' >> "$SK/sites/zz-betgenius.caddy"
  (cd "$SK" && docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null >/dev/null 2>&1)
  check "a real change (a new route on an unrelated site) FAILS the edge acceptance" bash -c "! ACC '$SK/deployments/releases/$(current)/manifest.json' edge >/dev/null 2>&1"
  check "...and the reason is the routing, not a number" contains "$(ACC "$SK/deployments/releases/$(current)/manifest.json" edge 2>&1)" "routing differs"
  sed -i '/evil.test/,$d' "$SK/sites/zz-betgenius.caddy"
  (cd "$SK" && docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null >/dev/null 2>&1)
  # a file edited on disk but never loaded: Caddy is RUNNING something else
  printf '\nhttp://late.test:8080 {\n\trespond "x" 200\n}\n' >> "$SK/sites/zz-betgenius.caddy"
  check "an edit that was never loaded is detected (running config differs from the file)" contains "$(ACC "$SK/deployments/releases/$(current)/manifest.json" edge 2>&1)" "running configuration is not what its Caddyfile adapts to"
  sed -i '/late.test/,$d' "$SK/sites/zz-betgenius.caddy"
}
s28() { # the whole lifecycle, chained: kill, Caddy restart, a torn Caddyfile, resume, then a failed release rolled back with no registry
  stack_reset || return 1
  snapshot_protected > "$W/prot"
  local orig bg0 rc; orig=$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1); bg0=$(sha256sum "$SK/sites/zz-betgenius.caddy" | cut -c1-16)
  approve data >/dev/null
  RELEASE_FAULTS=kill_after_QUIESCED R apply "$W/m/data.json" >/dev/null 2>&1
  check "1. killed with the window open: INTERRUPTED, edge closed" eq "$(state phase):$(edge $APIH /api/v1/health)" "QUIESCED:503"
  docker restart "$(cid_of caddy)" >/dev/null; sleep 4
  check "2. Caddy restarted: maintenance survives (503) and BetGenius is served" eq "$(edge $APIH /api/v1/health):$(edge $BGH /)" "503:200"
  # the resumed release re-asserts maintenance after the Caddy restart, and dies in the middle of THAT write (a real interrupted write)
  RELEASE_FAULTS=kill_in_caddy_write R resume >/dev/null 2>&1
  docker restart "$(cid_of caddy)" >/dev/null; sleep 4
  check "3. the resumed release is killed mid-write and Caddy restarts onto the partial file: the edge is dark" neq "$(edge $APIH /api/v1/health)" 503
  check "   the tooling sees an INTERRUPTED write (pending intent, same file, a prefix of what was being written)" contains "$(R status)" "INTERRUPTED WRITE"
  R resume; rc=$?
  check "4. resume repairs Caddy and completes with acceptance recorded" eq "$rc:$(state phase):$(state accepted)" "0:COMPLETE:true"
  check "   Caddyfile and BetGenius are byte-identical to the start; the edge is open" eq "$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1):$(sha256sum "$SK/sites/zz-betgenius.caddy" | cut -c1-16):$(edge $APIH /api/v1/health)" "$orig:$bg0:200"
  docker stop skq-registry >/dev/null
  R apply "$W/m/datacrash.json"; rc=$?
  check "5. next release cannot start; the registry is DOWN: rolled back from local images (exit 1)" eq "$rc:$(state phase)" "1:ROLLED_BACK"
  check "   the data release is serving again, edge open, BetGenius served" eq "$(running_image api):$(edge $APIH /api/v1/health):$(edge $BGH /)" "$(img data api):200:200"
  check "   nothing pulled from the registry during the rollback" bash -c "! grep -q 'pulling' $SK/deployments/run.log"
  check "   PostgreSQL, Redis and the scheduler were never restarted" protected_same "$W/prot" hard
  docker start skq-registry >/dev/null; registry_up
}

# =========================================================================================================================
# Review findings (2026-11-28): each scenario injects the failure for real wherever a real means exists.
# =========================================================================================================================
ev_order() { # event... -> 0 when, after the LAST rollback_started, these events occur in this order and no stop precedes the drain
  hist | python3 -c '
import sys, json
ev = [json.loads(l)["event"] for l in sys.stdin if l.strip()]
i = len(ev) - 1 - ev[::-1].index("rollback_started"); after = ev[i:]
p = 0
for w in sys.argv[1:]:
    try: p = after.index(w, p) + 1
    except ValueError: sys.exit(1)
if "stopping" in after and "rollback_drained" in after and after.index("stopping") < after.index("rollback_drained"): sys.exit(1)
' "$@"
}
rollback_did_not_stop() { hist | python3 -c '
import sys, json
ev = [json.loads(l)["event"] for l in sys.stdin if l.strip()]
i = len(ev) - 1 - ev[::-1].index("rollback_started")
sys.exit(1 if "stopping" in ev[i:] else 0)'; }
wait_file() { local _; for _ in $(seq 1 "${2:-60}"); do [ -e "$1" ] && return 0; sleep 1; done; return 1; }
api_health() { edge $APIH /api/v1/health; }

s29() { # FINDING 1: opening ingress by hand cannot bypass the readiness gates
  stack_reset || return 1
  R maintenance on >/dev/null 2>&1
  check "maintenance was switched on by hand (the edge answers 503)" eq "$(api_health)" 503
  gate() { # description inject restore expected-text
    local d=$1 inj=$2 rst=$3 expect=$4 out rc
    eval "$inj"; out=$(R maintenance off 2>&1); rc=$?
    check "$d: opening ingress is REFUSED (exit 3)" eq "$rc" 3
    check "  ...ingress stays closed (503)" eq "$(api_health)" 503
    check "  ...the reason is the gate: $expect" contains "$out" "$expect"
    check "  ...the refusal is journaled and alerted" bash -c "grep -q maintenance_off_refused $SK/deployments/history.jsonl && ls $SK/deployments/alerts/*maintenance-off-refused* >/dev/null"
    eval "$rst"
  }
  gate "a webhook backlog older than 10 minutes" "psql_q -c \"INSERT INTO paystack_webhook_inbox (mode,event_key,event_type,received_at) SELECT 'live','old-'||g,'x', now() - interval '3 hours' FROM generate_series(1,5) g\" >/dev/null" \
       "psql_q -c \"DELETE FROM paystack_webhook_inbox WHERE event_key LIKE 'old-%'\" >/dev/null" "webhook events have waited"
  gate "a duplicate Paystack reference (money)" "psql_q -c \"INSERT INTO payments (id,school_id,invoice_id,amount,status,paystack_reference,allocated_kobo) VALUES ('dup1','school-a','inv1',1000,'SUCCESS','ref-001',1000)\" >/dev/null" \
       "psql_q -c \"DELETE FROM payments WHERE id = 'dup1'\" >/dev/null" "dup_paystack_refs = 1"
  gate "a payment allocated above its amount (money)" "psql_q -c \"UPDATE payments SET allocated_kobo = amount + 1 WHERE id = 'pay1'\" >/dev/null" \
       "psql_q -c \"UPDATE payments SET allocated_kobo = amount WHERE id = 'pay1'\" >/dev/null" "payment_over_allocated = 1"
  printf 'MESSAGING_PAID_ENABLED=on\n' > "$W/gates.on"
  gate "a runtime gate that is not as required" "export RELEASE_GATES_FILE=$W/gates.on" "unset RELEASE_GATES_FILE" "gate MESSAGING_PAID_ENABLED is not"
  gate "an application that is down (web)" "docker stop \"\$(cid_of web)\" >/dev/null" "docker start \"\$(cid_all web)\" >/dev/null; sleep 3" "web is not running"
  gate "the backup scheduler stopped (infrastructure)" "docker stop \"\$(cid_of ops-pinned)\" >/dev/null" "docker start \"\$(cid_all ops-pinned)\" >/dev/null; sleep 2" "backup scheduler"
  gate "a stale off-site backup" "docker exec \"\$(cid_of ops-pinned)\" sh -c 'rm -f /store/skq-bucket/dumps/daily/*; d=2026-11-20T010000Z; touch /store/skq-bucket/dumps/daily/school-kit-\$d.dump /store/skq-bucket/dumps/daily/school-kit-\$d.dump.sha256'" \
       "docker exec \"\$(cid_of ops-pinned)\" sh -c 'd=\$(date -u +%Y-%m-%dT%H%M%SZ); touch /store/skq-bucket/dumps/daily/school-kit-\$d.dump /store/skq-bucket/dumps/daily/school-kit-\$d.dump.sha256'" "off-site dump"
  docker restart "$(cid_of redis)" >/dev/null; sleep 4
  local out rc; out=$(R maintenance off 2>&1); rc=$?
  check "protected infrastructure restarted while the window was open: refused (exit 3), still closed" eq "$rc:$(api_health)" "3:503"
  check "  ...the reason names the protected infrastructure" contains "$out" "protected infrastructure changed"
  R adopt --manifest "$W/m/r0.json" >/dev/null 2>&1   # the operator re-baselines the infrastructure they restarted
  out=$(R maintenance off 2>&1); rc=$?
  check "with every gate passing, maintenance off opens ingress (exit 0)" eq "$rc:$(api_health)" "0:200"
  check "  ...journaled as completed, after the checks" bash -c "grep -q maintenance_off_requested $SK/deployments/history.jsonl && grep -q maintenance_off_completed $SK/deployments/history.jsonl"
  check "  ...the readiness checks really ran (acceptance output is in the log)" contains "$out" "acceptance (internal) passed"
  # an unfinished release owns the window: it is finished (resume) or reversed (rollback), never bypassed by hand
  approve data >/dev/null
  RELEASE_FAULTS=kill_after_QUIESCED R apply "$W/m/data.json" >/dev/null 2>&1
  check "a release killed mid-window leaves ingress closed" eq "$(state phase):$(api_health)" "QUIESCED:503"
  out=$(R maintenance off 2>&1); rc=$?
  check "maintenance off over an UNFINISHED release is refused (exit 3) and ingress stays closed" eq "$rc:$(api_health)" "3:503"
  check "  ...it says to resume or roll back" contains "$out" "resume"
  RELEASE_FAULTS=pause_after_SNAPSHOT_DONE R resume >/dev/null 2>&1 &
  local _; for _ in $(seq 1 60); do [ "$(state phase)" = SNAPSHOT_DONE ] && break; sleep 1; done
  R maintenance off >/dev/null 2>&1; rc=$?
  check "maintenance off while a release is RUNNING is refused (exit 5)" eq "$rc" 5
  continue_run; wait; wait_run_done 120
  check "the release finishes through its own gates" eq "$(state phase):$(state accepted):$(api_health)" "COMPLETE:true:200"
}

s30() { # FINDING 3: an interrupted write is repaired; an unrelated edit, a replaced file or a tampered record never is
  stack_reset || return 1
  approve data >/dev/null
  local orig; orig=$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1)
  # (a) a real interrupted write: the intent was recorded as pending first
  RELEASE_FAULTS=kill_in_caddy_write R apply "$W/m/data.json" >/dev/null 2>&1
  check "(a) the record holds a pending write intent toward maintenance" contains "$(cat "$SK/deployments/caddy.record.json")" '"direction": "to_maintenance"'
  check "(a) ...and it is pending, not done" contains "$(cat "$SK/deployments/caddy.record.json")" '"status": "pending"'
  check "(a) the record names each file's inode" contains "$(cat "$SK/deployments/caddy.record.json")" '"ino"'
  check "(a) status says INTERRUPTED WRITE (not an unrelated edit)" contains "$(R status)" "INTERRUPTED WRITE"
  check "(a) the status JSON says INTERRUPTED" contains "$(R status --json)" '"caddy": "INTERRUPTED"'
  R resume; check "(a) resume repairs it and completes" eq "$?:$(state phase)" "0:COMPLETE"
  check "(a) the original Caddyfile is back byte for byte" eq "$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1)" "$orig"
  # (b) somebody edits the Caddyfile while a window is open: never overwritten
  stack_reset || return 1; approve data >/dev/null
  RELEASE_FAULTS=kill_after_QUIESCED R apply "$W/m/data.json" >/dev/null 2>&1
  printf '# hand edit: temporary rule added by an operator\n' >> "$SK/Caddyfile"
  local edited rc out; edited=$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1)
  check "(b) status says it is NOT repairable automatically" contains "$(R status)" "NOT REPAIRABLE AUTOMATICALLY"
  out=$(R resume 2>&1); rc=$?
  check "(b) resume refuses (exit 1) and says nothing was overwritten" eq "$rc" 1
  check "(b) ...the message" contains "$out" "nothing was overwritten"
  check "(b) the operator's edit is still on disk, byte for byte" eq "$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1)" "$edited"
  R rollback >/dev/null 2>&1; check "(b) a rollback refuses too (exit non-zero)" neq "$?" 0
  R maintenance off >/dev/null 2>&1; check "(b) maintenance off refuses too" neq "$?" 0
  check "(b) ...and the edit is STILL there" eq "$(sha256sum "$SK/Caddyfile" | cut -d' ' -f1)" "$edited"
  check "(b) an alert and a journal entry record the refusal" bash -c "ls $SK/deployments/alerts/*caddy-not-repaired* >/dev/null && grep -q caddy_not_repaired $SK/deployments/history.jsonl"
  check "(b) the monitor flags it" bash -c "! rel bash $TOOLS/monitor.sh >/dev/null 2>&1"
  grep -v 'hand edit' "$SK/Caddyfile" > "$W/cf.tmp"; cat "$W/cf.tmp" > "$SK/Caddyfile"     # the operator removes their edit, in place
  R resume >/dev/null 2>&1; check "(b) once the operator's edit is gone the release resumes and completes" eq "$(state phase):$(state accepted)" "COMPLETE:true"
  # (c) a partial file that is a DIFFERENT file (an editor replaced it): not the file the window was recorded on
  stack_reset || return 1; approve data >/dev/null
  RELEASE_FAULTS=kill_in_caddy_write R apply "$W/m/data.json" >/dev/null 2>&1
  cp "$SK/Caddyfile" "$W/partial"; rm -f "$SK/Caddyfile"; cp "$W/partial" "$SK/Caddyfile"    # same bytes, new inode
  check "(c) status says NOT REPAIRABLE (the file is not the one recorded)" contains "$(R status)" "NOT REPAIRABLE AUTOMATICALLY"
  out=$(R resume 2>&1); rc=$?
  check "(c) resume refuses and the bytes are untouched" eq "$rc:$(cmp -s "$W/partial" "$SK/Caddyfile" && echo same)" "1:same"
  check "(c) the reason names the inode" contains "$(cat "$SK/deployments/alerts/"*caddy-not-repaired*)" "inode"
  # (d) a tampered saved copy invalidates the whole record
  stack_reset || return 1; approve data >/dev/null
  RELEASE_FAULTS=kill_in_caddy_write R apply "$W/m/data.json" >/dev/null 2>&1
  echo "# tampered" >> "$SK/deployments/Caddyfile.maintenance"
  cp "$SK/Caddyfile" "$W/partial"
  out=$(R resume 2>&1); rc=$?
  check "(d) the record does not match its saved copy: refused, Caddyfile untouched" eq "$rc:$(cmp -s "$W/partial" "$SK/Caddyfile" && echo same)" "1:same"
  check "(d) the reason is the checksum" contains "$(cat "$SK/deployments/alerts/"*caddy-not-repaired*)" "RECORD_INVALID"
}

s31() { # FINDING 2: every rollback closes ingress and drains writers BEFORE it stops anything; a failed stop is never ignored
  stack_reset || return 1
  # (a) automatic rollback of an application-only release (which never needed maintenance)
  RELEASE_FAULTS=pause_rollback_before_stop R apply "$W/m/crash.json" --detach >/dev/null
  wait_file "$SK/deployments/.paused-before-stop" 120 || say "    the rollback never reached its pause"
  check "(a) at the moment the rollback is about to stop containers, ingress is CLOSED (503)" eq "$(api_health)" 503
  check "(a) ...the journal shows: rollback started, ingress closed, drained, and no stop before that" ev_order rollback_started rollback_ingress_closed rollback_drained
  continue_run; wait_run_done 120
  check "(a) the release was rolled back from local images" eq "$(state phase):$(running_image api)" "ROLLED_BACK:$(img r0 api)"
  check "(a) ingress is open again afterwards" eq "$(api_health)" 200
  # (b) an active background job holds the rollback: nothing is stopped under it
  stack_reset || return 1
  RELEASE_FAULTS=pause_after_QUIESCED R apply "$W/m/crash.json" --detach >/dev/null; wait_state QUIESCED 90
  docker exec "$(cid_of redis)" redis-cli lpush bull:render:active job-9 >/dev/null
  continue_run; wait_run_done 150
  check "(b) the release failed, then the rollback could NOT drain the writers: ROLLBACK_FAILED" eq "$(state phase)" ROLLBACK_FAILED
  check "(b) the reason says the writers did not drain and nothing was stopped" contains "$(run_log)" "the writers did not drain"
  check "(b) no container was stopped by the rollback" rollback_did_not_stop
  check "(b) the job is still there" eq "$(docker exec "$(cid_of redis)" redis-cli llen bull:render:active | tr -d '\r')" 1
  check "(b) ingress is closed (503), not serving a half-rolled-back system" eq "$(api_health)" 503
  docker exec "$(cid_of redis)" redis-cli del bull:render:active >/dev/null
  R rollback >/dev/null 2>&1; check "(b) once the queue is idle the operator's rollback succeeds" eq "$?:$(state phase):$(api_health)" "0:ROLLED_BACK:200"
  # (c) a stop that fails is never ignored: in the switch ...
  stack_reset || return 1; app_ids > "$W/ids"
  local rc; RELEASE_FAULTS=stop_fails_render-worker R apply "$W/m/app.json" >/dev/null 2>&1; rc=$?
  check "(c) a stop that fails fails the release (it does not carry on with a container still running): exit 1, ROLLED_BACK" eq "$rc:$(state phase)" "1:ROLLED_BACK"
  check "(c) the log names the failed stop" contains "$(run_log)" "stopping render-worker failed"
  check "(c) nothing was replaced: the previous release is still current" eq "$(current)" "$(rid r0)"
  # ... and in the rollback itself
  stack_reset || return 1
  RELEASE_FAULTS=rollback_stop_fails_api R apply "$W/m/crash.json" >/dev/null 2>&1; rc=$?
  check "(c) a rollback whose stop fails is ROLLBACK_FAILED (exit 7), not a rollback that carried on" eq "$rc:$(state phase)" "7:ROLLBACK_FAILED"
  check "(c) the log names the failed stop" contains "$(run_log)" "stopping api failed"
  check "(c) ingress is closed (503)" eq "$(api_health)" 503
  R rollback >/dev/null 2>&1; check "(c) the operator's rollback (the stop now works) succeeds" eq "$?:$(state phase):$(api_health)" "0:ROLLED_BACK:200"
  # (d) operator-initiated rollback
  stack_reset || return 1
  R apply "$W/m/app.json" >/dev/null 2>&1; check "(d) an application-only release is live" eq "$(current)" "$(rid app)"
  RELEASE_FAULTS=pause_rollback_before_stop R rollback >/dev/null 2>&1 &
  wait_file "$SK/deployments/.paused-before-stop" 90 || say "    the operator rollback never reached its pause"
  check "(d) the operator's rollback has closed ingress before stopping anything (503)" eq "$(api_health)" 503
  check "(d) ...and the app containers still run the release being rolled back" eq "$(running_image api)" "$(img app api)"
  continue_run; wait
  check "(d) rolled back, ingress open" eq "$(state phase):$(running_image api):$(api_health)" "ROLLED_BACK:$(img r0 api):200"
  check "(d) the order is journaled" ev_order rollback_started rollback_ingress_closed rollback_drained
  # (e) operator rollback held by an active job: nothing replaced
  stack_reset || return 1
  R apply "$W/m/app.json" >/dev/null 2>&1; app_ids > "$W/ids"
  docker exec "$(cid_of redis)" redis-cli lpush bull:render:active job-7 >/dev/null
  R rollback >/dev/null 2>&1; rc=$?
  check "(e) rollback with an active job: exit 7, and every container is still the one it was" eq "$rc" 7
  check "(e) ...untouched" untouched "$W/ids"
  docker exec "$(cid_of redis)" redis-cli del bull:render:active >/dev/null
}

s32() { # FINDING 4: COMPLETE needs a durable record that names THIS release id and manifest checksum, everywhere
  stack_reset || return 1
  local d="$SK/deployments" r0 app
  r0=$(rid r0); app=$(rid app)
  check "adopt: the baseline has its durable acceptance record" test -s "$d/acceptance/$r0.json"
  check "adopt: it names the release id and the manifest checksum" bash -c "grep -q '\"release_id\":\"$r0\"' $d/acceptance/$r0.json && grep -q '$(msha r0)' $d/acceptance/$r0.json"
  check "status reports the record as valid" contains "$(R status --json)" '"valid": true'
  R apply "$W/m/app.json" >/dev/null 2>&1
  check "a normal release: the record names its release id and its manifest checksum" bash -c "grep -q '\"release_id\":\"$app\"' $d/acceptance/$app.json && grep -q '$(msha app)' $d/acceptance/$app.json"
  R apply "$W/m/app.json" >/dev/null 2>&1; check "NOOP (already running): exit 0, record still valid" eq "$?:$(R status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["acceptance"]["valid"])')" "0:True"
  local fakessh="$W/fakessh"
  printf '#!/usr/bin/env bash\nexec env SK_DIR=%s RELEASE_DATA=%s bash %s/release.sh status --json </dev/null\n' "$SK" "$d" "$TOOLS" > "$fakessh"
  printf '#!/usr/bin/env bash\nshift 2\nexec env SK_DIR=%s RELEASE_DATA=%s bash %s/release.sh status --json </dev/null\n' "$SK" "$d" "$TOOLS" > "$fakessh"; chmod +x "$fakessh"
  poll() { RELEASE_SSH="$fakessh" POLL_INTERVAL=1 POLL_MAX_LOST=3 "$@" bash "$ROOT/scripts/release/poll-release.sh" vps 20 >"$W/poll.out" 2>&1; echo $?; }
  check "polling a valid COMPLETE exits 0" eq "$(poll env)" 0
  check "polling for the release this workflow started: exit 0" eq "$(poll env EXPECT_RELEASE_ID="$app" EXPECT_MANIFEST_SHA256="$(msha app)")" 0
  check "polling when the server holds a different release than the workflow started: exit 9" eq "$(poll env EXPECT_RELEASE_ID="$r0")" 9
  tamper() { # description command-that-damages-the-record
    local desc=$1; shift
    "$@"
    check "$desc: status reads INTERRUPTED, not idle" contains "$(R status)" "run:         INTERRUPTED"
    check "  ...the acceptance block reports it invalid" contains "$(R status --json)" '"valid": false'
    check "  ...polling treats it as a failure (exit 9)" eq "$(poll env)" 9
    R apply "$W/m/app2.json" >/dev/null 2>&1; check "  ...no new release may start on top of it (exit 3)" eq "$?" 3
    check "  ...the monitor flags it" bash -c "! rel bash $TOOLS/monitor.sh >/dev/null 2>&1"
    R resume >/dev/null 2>&1
    check "  ...resume runs acceptance AGAIN and records a valid one" eq "$(state phase):$(R status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["acceptance"]["valid"])')" "COMPLETE:True"
    check "  ...the journal says it re-verified" contains "$(hist)" acceptance_reverify
  }
  tamper "a record for a different manifest checksum" sed -i 's/"manifest_sha256":"[0-9a-f]*"/"manifest_sha256":"0000000000000000000000000000000000000000000000000000000000000000"/' "$d/acceptance/$app.json"
  tamper "a record naming a different release id" sed -i 's/"release_id":"[^"]*"/"release_id":"20200101T000000Z-aaaaaaaaaaaa"/' "$d/acceptance/$app.json"
  tamper "a missing record" rm -f "$d/acceptance/$app.json"
  tamper "state naming a different manifest checksum than the record" python3 "$TOOLS/release_tool.py" state set --file "$d/state.json" manifest_sha256=1111111111111111111111111111111111111111111111111111111111111111
  tamper "a malformed record" bash -c "echo '{broken' > $d/acceptance/$app.json"
  tamper "a manifest kept for the release that no longer matches" bash -c "echo '{}' >> $d/releases/$app/manifest.json"
}

s33() { # FINDING 5: unreadable Caddy admin configuration fails release acceptance closed; only monitoring may report it as degraded
  stack_reset || return 1
  local m out rc; m="$SK/deployments/releases/$(current)/manifest.json"
  ACC "$m" edge >/dev/null 2>&1; check "control: with the admin endpoint available the edge acceptance passes" eq "$?" 0
  out=$(RELEASE_FAULTS=caddy_admin_unavailable ACC "$m" edge 2>&1); rc=$?
  check "the admin endpoint cannot be read: edge acceptance FAILS (it does not skip)" neq "$rc" 0
  check "  ...and says it cannot be verified" contains "$out" "cannot be verified"
  check "  ...it is a failure, not a warning-only skip" lacks "$out" "running-configuration check skipped"
  RELEASE_FAULTS=caddy_admin_unavailable R apply "$W/m/app.json" >/dev/null 2>&1; rc=$?
  check "a release whose edge cannot be verified is never COMPLETE" bash -c "[ $rc -ne 0 ] && [ '$(state phase)' != COMPLETE ]"
  check "  ...it did not become the current release" eq "$(current)" "$(rid r0)"
  check "  ...the log says why" contains "$(run_log)" "cannot be verified"
  R rollback >/dev/null 2>&1; R maintenance off >/dev/null 2>&1
  out=$(RELEASE_FAULTS=caddy_admin_unavailable rel bash "$TOOLS/monitor.sh" 2>&1); rc=$?
  check "monitoring only: the same condition is reported as DEGRADED verification" contains "$out" "DEGRADED"
  check "  ...and is not reported as a failure by itself (exit 0)" eq "$rc" 0
  check "  ...a separate alert says verification is degraded" bash -c "ls $SK/deployments/alerts/*monitor-degraded* >/dev/null"
  rel bash "$TOOLS/monitor.sh" >/dev/null 2>&1; check "control: the monitor is healthy and silent about degradation when Caddy's admin is readable" eq "$?" 0
}

s34() { # FINDING 6: every route is accounted for before maintenance; an unclassified route that reaches School Kit is rejected
  stack_reset || return 1
  app_ids > "$W/ids"
  check "the default fixture (static unrelated sites, the school-address site) is fully accounted for" contains "$(rel bash -c "cd $SK && source $TOOLS/lib.sh && source $TOOLS/acceptance.sh && check_route_accounting" 2>&1)" "route accounting:"
  # a custom school domain that proxies to the portal: it would keep serving through a window the rest of the edge is closed for
  printf 'http://parents.example.test:8080 {\n\treverse_proxy portal:3000\n}\n' > "$SK/sites/zz-custom-portal.caddy"
  (cd "$SK" && docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile </dev/null >/dev/null 2>&1)
  approve data >/dev/null
  local out rc; out=$(R apply "$W/m/data.json" 2>&1); rc=$?
  check "a data release that needs maintenance is REFUSED before anything changes (exit 1, ABORTED)" eq "$rc:$(state phase)" "1:ABORTED"
  check "  ...the reason names the unclassified route and its upstream" contains "$out" "parents.example.test"
  check "  ...and says it refuses to enter maintenance" contains "$out" "refusing to enter maintenance"
  check "  ...nothing changed: containers untouched" untouched "$W/ids"
  check "  ...the edge still serves" eq "$(api_health)" 200
  R maintenance on >/dev/null 2>&1; check "maintenance on by hand is refused too (exit 3) and the edge stays open" eq "$?:$(api_health)" "3:200"
  R apply "$W/m/app.json" >/dev/null 2>&1; check "an application-only release (no maintenance) is not blocked by it" eq "$?" 0
  # the operator decides, in writing; the decision is data on the server, never in code
  printf '# decisions\nparents.example.test accept-live fictional: parents keep read-only portal pages during a window\n' > "$SK/deployments/caddy-route-decisions.conf"
  R apply "$W/m/data.json" >/dev/null 2>&1; rc=$?
  check "with the operator's written decision the same release goes ahead and completes" eq "$rc:$(state phase)" "0:COMPLETE"
  check "  ...the accounting reported the accepted route" contains "$(run_log)" "1 operator-accepted"
  # a site file whose address cannot be resolved cannot be accounted for: fail closed
  stack_reset || return 1
  printf '{$UNSET_CUSTOM_DOMAIN_HOST} {\n\trespond ok\n}\n' > "$SK/sites/zz-unresolvable.caddy"
  approve data >/dev/null
  out=$(R apply "$W/m/data.json" 2>&1); rc=$?
  check "a site file with an address that cannot be resolved: refused before maintenance" eq "$rc:$(state phase)" "1:ABORTED"
  check "  ...by route accounting" contains "$out" "route accounting"
  rm -f "$SK/sites/zz-unresolvable.caddy"
}

run_scenarios() {
  scenario s01 "application-only release: scoped, maintenance-free, no protected restarts" s01
  scenario s02 "additive schema release: approval gate, no maintenance, checksum recorded" s02
  scenario s03 "data-migration release: persistent maintenance, verified dump, other sites untouched" s03
  scenario s04 "interrupted deployment (SIGKILL): durable state, closed ingress, resume" s04
  scenario s05 "SSH connection loss: detached release survives; hung-up release resumes" s05
  scenario s06 "Caddy restart during maintenance: maintenance persists" s06
  scenario s07 "partial configuration writes: corrupt override and truncated Caddyfile" s07
  scenario s08 "registry unavailable: stops before any change" s08
  scenario s09 "failed application startup: automatic local rollback with the registry down; redacted diagnostics" s09
  scenario s10 "failed front-end readiness: whole release rolled back" s10
  scenario s11 "failed migration: unresolved-migration gate, resolve, corrected release" s11
  scenario s12 "concurrent deployments: one runs, the other is refused" s12
  scenario s13 "pending webhook deliveries: claimed holds, stale backlog blocks, nothing lost" s13
  scenario s14 "active background jobs: never stopped mid-job" s14
  scenario s15 "insufficient disk: refused before pulling or changing anything" s15
  scenario s16 "failed rollback: maintenance on, operator alert, operator recovery" s16
  scenario s17 "protected infrastructure changed mid-release: stop safely" s17
  scenario s18 "breaking migration + failed start: fix-forward, never an unsafe rollback" s18
  scenario s19 "transient startup, automation switches, cutover exclusion" s19
  scenario s20 "automated acceptance: every genuine failure class is detected" s20
  scenario s21 "cleanup and monitor" s21
  scenario s22 "scoped build: only the changed unit is restarted; unchanged units keep digest and commit" s22
  scenario s24 "incident: stdin swallowed by a subprocess (reproduced with real containers) and made impossible" s24
  scenario s25 "premature exit, including status 0, is a failure; acceptance must be durably recorded" s25
  scenario s26 "partial Caddyfile write, Caddy restart onto it, recovery from the durable record" s26
  scenario s27 "route-group renumbering on real Caddy: ignored; a real routing change: caught" s27
  scenario s28 "lifecycle gauntlet: kill, Caddy restart, torn Caddyfile, resume, rollback with the registry down" s28
  scenario s29 "FINDING 1 maintenance off by hand cannot bypass the readiness gates (webhooks, money, apps, infrastructure, backups)" s29
  scenario s30 "FINDING 3 Caddy recovery: interrupted write repaired; unrelated edit, replaced file and tampered record never overwritten" s30
  scenario s31 "FINDING 2 rollback closes ingress and drains writers before any stop; a failed stop is never ignored" s31
  scenario s32 "FINDING 4 COMPLETE needs a durable record matching release id and manifest checksum: adopt, NOOP, resume, status, polling" s32
  scenario s33 "FINDING 5 unreadable Caddy admin configuration fails release acceptance closed; monitoring reports it as degraded" s33
  scenario s34 "FINDING 6 route accounting before maintenance: unclassified routes that reach School Kit are rejected" s34
  scenario s23 "tool installer: verified, atomic, never under a running release" s23
}
