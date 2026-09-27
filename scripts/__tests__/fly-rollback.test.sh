#!/usr/bin/env bash
#
# Tests for scripts/fly-rollback.sh's release-selection and fail-closed paths.
#
# Deliberately does NOT call flyctl. It sources the script's node selector via a
# stub `flyctl` on PATH that replays a captured `flyctl releases --image --json`
# payload, so every branch below is exercised without deploying anything. This
# is the answer to "validate the workflow change without causing a production
# rollback": the logic that decides WHICH image to deploy is the risky part, and
# it is fully testable offline.

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../fly-rollback.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
ok() { printf '  ok   %s\n' "$1"; pass=$((pass + 1)); }
no() { printf '  FAIL %s\n     %s\n' "$1" "${2:-}"; fail=$((fail + 1)); }

# Builds a stub flyctl that prints $1 for `releases` and refuses everything else,
# so an accidental `deploy` in a test is a loud failure rather than a real one.
make_stub() {
  local payload_file="$1"
  mkdir -p "$TMP/bin"
  cat > "$TMP/bin/flyctl" <<STUB
#!/usr/bin/env bash
if [ "\$1" = "releases" ]; then cat "$payload_file"; exit 0; fi
echo "STUB REFUSES: flyctl \$*" >&2
exit 99
STUB
  chmod +x "$TMP/bin/flyctl"
}

run() { PATH="$TMP/bin:$PATH" bash "$SCRIPT" "$@" 2>"$TMP/err"; }

# ── 1. real captured payload: newest complete release wins ──────────────────
REAL="$HERE/fixtures/releases-api.json"
if [ ! -f "$REAL" ]; then
  echo "missing fixture $REAL" >&2
  exit 1
fi
make_stub "$REAL"

out="$(run current-image school-kit-api)" && {
  ver="${out%%$'\t'*}"; img="${out#*$'\t'}"
  expected_ver="$(node -e 'const a=require(process.argv[1]);console.log(Math.max(...a.filter(r=>r.Status==="complete"&&r.ImageRef).map(r=>Number(r.Version))))' "$REAL")"
  [ "$ver" = "$expected_ver" ] && ok "current-image picks highest Version ($ver)" || no "current-image version" "got $ver want $expected_ver"
  case "$img" in registry.fly.io/*) ok "current-image returns a registry image" ;; *) no "current-image image ref" "$img" ;; esac
} || no "current-image on real payload" "$(cat "$TMP/err")"

out="$(run previous-image school-kit-api)" && {
  ok "previous-image succeeds on real payload (v${out%%$'\t'*})"
} || no "previous-image on real payload" "$(cat "$TMP/err")"

# ── 2. ordering is not trusted: shuffled input must give the same answer ────
node -e '
  const a = require(process.argv[1]);
  // reverse + rotate so .[0] is NOT the newest
  const shuffled = a.slice().reverse();
  require("fs").writeFileSync(process.argv[2], JSON.stringify(shuffled));
' "$REAL" "$TMP/shuffled.json"
make_stub "$TMP/shuffled.json"
out2="$(run current-image school-kit-api)" && {
  [ "${out2%%$'\t'*}" = "$expected_ver" ] && ok "ordering-independent: shuffled input still picks v$expected_ver" || no "ordering independence" "got ${out2%%$'\t'*}"
} || no "current-image on shuffled payload" "$(cat "$TMP/err")"

# ── 3. fail-closed paths ────────────────────────────────────────────────────
printf 'not json at all' > "$TMP/bad.json"; make_stub "$TMP/bad.json"
run current-image school-kit-api >/dev/null && no "malformed JSON should fail" || ok "fail-closed: malformed JSON"

printf '{"not":"an array"}' > "$TMP/obj.json"; make_stub "$TMP/obj.json"
run current-image school-kit-api >/dev/null && no "non-array should fail" || ok "fail-closed: JSON that is not an array"

printf '[]' > "$TMP/empty.json"; make_stub "$TMP/empty.json"
run current-image school-kit-api >/dev/null && no "empty array should fail" || ok "fail-closed: zero releases"

printf '[{"Version":9,"Status":"complete","ImageRef":""}]' > "$TMP/noimg.json"; make_stub "$TMP/noimg.json"
run current-image school-kit-api >/dev/null && no "empty ImageRef should fail" || ok "fail-closed: empty ImageRef"

printf '[{"Version":9,"Status":"failed","ImageRef":"registry.fly.io/a:b"}]' > "$TMP/failed.json"; make_stub "$TMP/failed.json"
run current-image school-kit-api >/dev/null && no "non-complete release should fail" || ok "fail-closed: only incomplete releases"

# only ONE complete release -> previous-image must refuse
printf '[{"Version":9,"Status":"complete","ImageRef":"registry.fly.io/a:b"}]' > "$TMP/one.json"; make_stub "$TMP/one.json"
run previous-image school-kit-api >/dev/null && no "single release should fail previous-image" || ok "fail-closed: fewer than 2 releases for previous-image"

# two releases pointing at the SAME image -> refuse as a meaningless rollback
printf '[{"Version":9,"Status":"complete","ImageRef":"registry.fly.io/a:b"},{"Version":8,"Status":"complete","ImageRef":"registry.fly.io/a:b"}]' > "$TMP/same.json"
make_stub "$TMP/same.json"
run previous-image school-kit-api >/dev/null && no "identical images should fail" || ok "fail-closed: current and previous images identical"

# ── 4. to-image argument + shape guards (never reaches flyctl deploy) ───────
make_stub "$REAL"
run to-image school-kit-api apps/api/fly.toml "" >/dev/null && no "empty target should fail" || ok "fail-closed: empty target image"
run to-image school-kit-api apps/api/fly.toml "docker.io/evil:latest" >/dev/null && no "non-fly image should fail" || ok "fail-closed: rejects a non-registry.fly.io image"
run to-image school-kit-api does/not/exist.toml "registry.fly.io/a:b" >/dev/null && no "missing config should fail" || ok "fail-closed: missing fly config"

# no-op path: target == current image, so it must NOT call flyctl deploy
cur_img="$(run current-image school-kit-api)"; cur_img="${cur_img#*$'\t'}"
if out4="$(run to-image school-kit-api apps/api/fly.toml "$cur_img")"; then
  case "$out4" in *"already on the target image"*) ok "no-op when already on target (no deploy attempted)" ;; *) no "no-op path" "$out4" ;; esac
else
  no "no-op path exited non-zero" "$(cat "$TMP/err")"
fi

# ── 4b. capture: fail-closed vs explicit opt-in ─────────────────────────────
# This is the behaviour that decides whether a deploy proceeds at all, so each
# failure mode is asserted separately rather than lumped together.

make_stub "$REAL"
if out="$(run capture school-kit-api)"; then
  case "$out" in registry.fly.io/*) ok "capture returns a bare image ref on success" ;; *) no "capture success output" "$out" ;; esac
else
  no "capture on healthy payload" "$(cat "$TMP/err")"
fi

# flyctl itself failing (auth / network / unknown app): stub exits non-zero
mkdir -p "$TMP/bin"
printf '#!/usr/bin/env bash
exit 1
' > "$TMP/bin/flyctl"; chmod +x "$TMP/bin/flyctl"
run capture school-kit-api >/dev/null && no "flyctl failure should abort capture" || ok "fail-closed: capture aborts when flyctl exits non-zero"

# unparseable response
printf 'Error: something went wrong' > "$TMP/bad2.json"; make_stub "$TMP/bad2.json"
run capture school-kit-api >/dev/null && no "unparseable response should abort capture" || ok "fail-closed: capture aborts on unparseable response"

# valid but EMPTY history — still aborts for these established apps
printf '[]' > "$TMP/empty2.json"; make_stub "$TMP/empty2.json"
run capture school-kit-api >/dev/null && no "empty history should abort capture" || ok "fail-closed: capture aborts on empty release history"

# explicit opt-in downgrades it to a warning and yields an empty ref
make_stub "$TMP/empty2.json"
if out="$(ALLOW_MISSING_ROLLBACK_TARGET=true PATH="$TMP/bin:$PATH" bash "$SCRIPT" capture school-kit-api 2>"$TMP/err")"; then
  [ -z "$(printf '%s' "$out" | tr -d '[:space:]')" ] && ok "opt-in: ALLOW_MISSING_ROLLBACK_TARGET=true yields an empty ref, exit 0" || no "opt-in output should be empty" "$out"
  grep -q "ALLOW_MISSING_ROLLBACK_TARGET=true" "$TMP/err" && ok "opt-in warns on stderr" || no "opt-in warning missing" "$(cat "$TMP/err")"
else
  no "opt-in should exit 0" "$(cat "$TMP/err")"
fi

# opt-in must NOT mask a real flyctl failure into a silent success without warning
printf '#!/usr/bin/env bash
exit 1
' > "$TMP/bin/flyctl"; chmod +x "$TMP/bin/flyctl"
if out="$(ALLOW_MISSING_ROLLBACK_TARGET=true PATH="$TMP/bin:$PATH" bash "$SCRIPT" capture school-kit-api 2>"$TMP/err")"; then
  grep -q "::warning::" "$TMP/err" && ok "opt-in still warns loudly when flyctl itself failed" || no "opt-in silent on flyctl failure" "$(cat "$TMP/err")"
else
  ok "opt-in + flyctl failure: aborts (also acceptable)"
fi

# ── 5. the invalid commands must not reappear ───────────────────────────────
# Matches INVOCATIONS (line begins with the command) rather than prose, so the
# comments explaining why the command was removed do not trip this.
# docs/journal and docs/modules are historical records and are excluded.
INVOCATION='^[[:space:]]*flyctl releases (rollback|list)'
if grep -rqE "$INVOCATION" "$HERE/../.." --include="*.sh" --include="*.yml" --include="*.md"      --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=journal --exclude-dir=modules 2>/dev/null; then
  no "no invalid flyctl invocations" "$(grep -rnE "$INVOCATION" "$HERE/../.." --include='*.sh' --include='*.yml' --include='*.md' --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=journal --exclude-dir=modules 2>/dev/null | head -5)"
else
  ok "no 'flyctl releases rollback|list' invocations outside historical docs"
fi

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
