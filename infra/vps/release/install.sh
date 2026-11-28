#!/usr/bin/env bash
# Installs the release tooling on the server from a tar stream, verifying every file against the
# SHA256SUMS inside it, and swapping the whole directory in ONE rename. It refuses while a release
# is running (the tools are never replaced under a running release) and keeps the previous copy.
#
#   scripts/release/package-tools.sh bundle.tar && scp bundle.tar vps:/tmp/rt.tar
#   scp infra/vps/release/install.sh vps:/tmp/ && ssh -n vps 'RELEASE_BUNDLE=/tmp/rt.tar bash /tmp/install.sh'   (works on a fresh server too)
# The installer itself is copied to the server and run BY PATH (bash /tmp/install.sh), never piped to `bash -s`.
# Without RELEASE_BUNDLE the bundle is read from standard input.
#
# It writes nothing outside $SK_DIR/release-tools and $SK_DIR/release-tools.previous.
set -Eeuo pipefail
umask 022
SK_DIR=${SK_DIR:-/opt/school-kit}
new=$SK_DIR/release-tools.new
rm -rf "$new"; mkdir -p "$new"
tar -C "$new" -xf "${RELEASE_BUNDLE:--}" --no-same-owner --no-same-permissions
[ -s "$new/SHA256SUMS" ] || { echo "BLOCK the bundle has no SHA256SUMS" >&2; rm -rf "$new"; exit 1; }
# every file in the bundle must be listed, and every listed file must match
( cd "$new" && sha256sum -c --quiet SHA256SUMS ) || { echo "BLOCK checksum verification failed; nothing was installed" >&2; rm -rf "$new"; exit 1; }
extra=$(cd "$new" && find . -type f ! -name SHA256SUMS | sed 's|^\./||' | sort | comm -23 - <(awk '{print $2}' SHA256SUMS | sort) || true)
[ -z "$extra" ] || { echo "BLOCK files not covered by SHA256SUMS: $extra" >&2; rm -rf "$new"; exit 1; }
for f in release.sh acceptance.sh lib.sh monitor.sh cleanup.sh snapshot.sh release_tool.py gates.conf; do [ -f "$new/$f" ] || { echo "BLOCK $f is missing from the bundle" >&2; rm -rf "$new"; exit 1; }; done
python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read())' "$new/release_tool.py" || { echo "BLOCK release_tool.py does not parse" >&2; rm -rf "$new"; exit 1; }
for f in "$new"/*.sh; do bash -n "$f" || { echo "BLOCK $(basename "$f") has a syntax error" >&2; rm -rf "$new"; exit 1; }; done
chmod 755 "$new"/*.sh "$new/release_tool.py"
mkdir -p "$SK_DIR/deployments"
exec 9>"$SK_DIR/deployments/apply.lock"
flock -n 9 || { echo "BLOCK a release is running; the tools are not replaced under it" >&2; rm -rf "$new"; exit 5; }
rm -rf "$SK_DIR/release-tools.previous"
[ ! -d "$SK_DIR/release-tools" ] || mv "$SK_DIR/release-tools" "$SK_DIR/release-tools.previous"
mv "$new" "$SK_DIR/release-tools"
echo "installed release tools $(cut -c1-12 "$SK_DIR/release-tools/SHA256SUMS" | head -n 1) ($(wc -l < "$SK_DIR/release-tools/SHA256SUMS") files); previous kept in release-tools.previous"
