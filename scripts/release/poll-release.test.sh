#!/usr/bin/env bash
# Tests poll-release.sh against a scripted fake `ssh`: complete sequences, not helper functions.
set -u
here=$(cd "$(dirname "$0")" && pwd); T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; fail=0
chk() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got $2, want $3)"; fail=1; fi; }
cat > "$T/ssh" <<'S'
#!/usr/bin/env bash
# each call consumes the next line of $SCRIPT: "ok <json>" or "fail"
n=$(cat "$T/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$T/n"
line=$(sed -n "${n}p" "$T/script"); [ -n "$line" ] || line=$(tail -n 1 "$T/script")
case $line in fail) exit 255 ;; ok\ *) echo "${line#ok }" ;; esac
S
chmod +x "$T/ssh"
# ACC = state.accepted; ACCV = the server's own verification of the durable record; ARID/ASHA = what that record names
st() { printf '{"run":"%s","state":{"phase":"%s","error":"%s","accepted":%s,"release_id":"rel-1","manifest_sha256":"aaaa"},"acceptance":{"valid":%s,"release_id":"%s","manifest_sha256":"%s"}}' "$1" "$2" "${3:-}" "$([ "$2" = COMPLETE ] && echo "${ACC:-true}" || echo false)" "${ACCV:-true}" "${ARID:-rel-1}" "${ASHA:-aaaa}"; }
run() { rm -f "$T/n"; printf '%s\n' "$@" > "$T/script"; RELEASE_SSH="$T/ssh" POLL_INTERVAL=0 POLL_MAX_LOST=3 bash "$here/poll-release.sh" vps 20 >"$T/out" 2>&1; echo $?; }
export T
chk "running then complete -> 0" "$(run "ok $(st RUNNING QUIESCED)" "ok $(st RUNNING SWITCHED)" "ok $(st IDLE COMPLETE)")" 0
chk "COMPLETE without a durable acceptance record is a failure, not a success -> 9" "$(ACC=false run "ok $(ACC=false st IDLE COMPLETE)")" 9
chk "accepted=true but the server cannot verify the record -> 9" "$(ACCV=false run "ok $(ACCV=false st IDLE COMPLETE)")" 9
chk "the record names a different release id than the state -> 9" "$(ARID=rel-OTHER run "ok $(ARID=rel-OTHER st IDLE COMPLETE)")" 9
chk "the record names a different manifest checksum than the state -> 9" "$(ASHA=bbbb run "ok $(ASHA=bbbb st IDLE COMPLETE)")" 9
chk "COMPLETE for the release this workflow started -> 0" "$(EXPECT_RELEASE_ID=rel-1 EXPECT_MANIFEST_SHA256=aaaa run "ok $(st IDLE COMPLETE)")" 0
chk "COMPLETE, but for a different release than this workflow started -> 9" "$(EXPECT_RELEASE_ID=rel-2 run "ok $(st IDLE COMPLETE)")" 9
chk "COMPLETE, but for a different manifest checksum than this workflow started -> 9" "$(EXPECT_MANIFEST_SHA256=cccc run "ok $(st IDLE COMPLETE)")" 9
chk "survives lost SSH sessions while the release runs -> 0" "$(run "ok $(st RUNNING QUIESCED)" fail fail "ok $(st RUNNING SWITCHED)" fail "ok $(st IDLE COMPLETE)")" 0
chk "rolled back -> 1" "$(run "ok $(st RUNNING SWITCHED)" "ok $(st IDLE ROLLED_BACK)")" 1
chk "aborted before any change -> 1" "$(run "ok $(st IDLE ABORTED preflight)")" 1
chk "aborted because the system was busy -> 4" "$(run "ok $(st IDLE ABORTED quiesce)")" 4
chk "fix-forward required -> 6" "$(run "ok $(st IDLE FIX_FORWARD_REQUIRED)")" 6
chk "rollback failed -> 7" "$(run "ok $(st IDLE ROLLBACK_FAILED)")" 7
chk "never reachable -> 8 (and says the release may still run)" "$(run fail fail fail fail)" 8
grep -q "may still be running" "$T/out" && echo "PASS lost-contact message says the release may still be running" || { echo "FAIL lost-contact message"; fail=1; }
chk "interrupted (process gone mid-release) -> 9" "$(run "ok $(st INTERRUPTED MIGRATED)")" 9
exit $fail
