#!/usr/bin/env bash
# Builds the release tooling bundle: infra/vps/release/ (without tests) + SHA256SUMS, as a tar on
# stdout or to a file.   scripts/release/package-tools.sh [out.tar]
set -euo pipefail
src=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../infra/vps/release" && pwd)
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
cp "$src"/{release.sh,acceptance.sh,lib.sh,monitor.sh,cleanup.sh,install.sh,release_tool.py,gates.conf} "$t/"
( cd "$t" && sha256sum release.sh acceptance.sh lib.sh monitor.sh cleanup.sh install.sh release_tool.py gates.conf > SHA256SUMS )
if [ -n "${1:-}" ]; then tar -C "$t" -cf "$1" .; else tar -C "$t" -cf - .; fi
