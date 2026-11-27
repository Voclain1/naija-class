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
st() { printf '{"run":"%s","state":{"phase":"%s","error":"%s"}}' "$1" "$2" "${3:-}"; }
run() { rm -f "$T/n"; printf '%s\n' "$@" > "$T/script"; RELEASE_SSH="$T/ssh" POLL_INTERVAL=0 POLL_MAX_LOST=3 bash "$here/poll-release.sh" vps 20 >"$T/out" 2>&1; echo $?; }
export T
chk "running then complete -> 0" "$(run "ok $(st RUNNING QUIESCED)" "ok $(st RUNNING SWITCHED)" "ok $(st IDLE COMPLETE)")" 0
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
