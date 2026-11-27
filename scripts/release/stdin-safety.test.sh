#!/usr/bin/env bash
# Static guards for the production-incident class "a command swallowed the rest of the script from standard input, the
# shell reached end-of-file and exited 0 with the work half done". The behaviour itself is proved with real containers
# by the release qualification (s24); these fail fast, in seconds, if someone re-introduces the patterns.
set -u
root=$(cd "$(dirname "$0")/../.." && pwd); cd "$root" || exit 2; fail=0
chk() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }
R=infra/vps/release
for f in release.sh monitor.sh cleanup.sh; do chk "$f closes standard input before it runs anything" "grep -q '^\(\[ \"\$cmd\" = approve \] || \)\?exec </dev/null' $R/$f"; done
chk "acceptance.sh run directly closes standard input" "grep -q '^  exec </dev/null' $R/acceptance.sh"
chk "snapshot.sh is a file that closes its own standard input" "grep -q '^exec </dev/null' $R/snapshot.sh"
chk "no release script or workflow runs a script from standard input (bash -s / sh -s)" "! grep -nE '\\b(ba)?sh -s\\b' $R/*.sh .github/workflows/release.yml .github/workflows/release-qualification.yml .github/actions/vps-release/action.yml scripts/release/*.sh | grep -vE 'stdin-safety.test.sh|poll-release.test.sh|:[0-9]+:[[:space:]]*#'"
chk "no heredoc is piped into docker exec / ssh in the release tooling" "! grep -nE '(docker exec|ssh)[^|#]*<<' $R/*.sh scripts/release/*.sh .github/workflows/release.yml .github/actions/vps-release/action.yml | grep -vE 'stdin-safety.test.sh|poll-release.test.sh|:[0-9]+:[[:space:]]*#'"
chk "every non-piped ssh in the release workflow and action is ssh -n (or scp)" "! grep -nE '(^|[^|] )ssh vps' .github/workflows/release.yml .github/actions/vps-release/action.yml | grep -v 'ssh -n'"
chk "a premature exit guard exists and is armed for apply" "grep -q 'trap premature_guard EXIT' $R/release.sh && grep -q 'exit 9' $R/release.sh"
chk "COMPLETE needs a durable acceptance record" "grep -q 'record_acceptance' $R/release.sh && grep -q 'accepted=true' $R/release.sh"
# rollback never reaches a registry: the only place the tooling pulls is staging
chk "'docker pull' appears exactly once in the release tooling, inside stage_core" "[ \"\$(grep -c 'docker pull' $R/release.sh $R/lib.sh $R/acceptance.sh $R/monitor.sh $R/cleanup.sh | awk -F: '{s+=\$2} END{print s}')\" = 1 ] && awk '/^stage_core\\(\\)/,/^cmd_stage\\(\\)/' $R/release.sh | grep -q 'docker pull'"
chk "no 'compose pull', '--pull always' or image build anywhere in the release tooling" "! grep -nE 'compose[^#]*\\bpull\\b|--pull always|docker build|--build' $R/*.sh | grep -vE -- '--no-build|--pull never|:[0-9]+:[[:space:]]*#'"
exit $fail
