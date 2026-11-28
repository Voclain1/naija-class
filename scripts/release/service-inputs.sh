#!/usr/bin/env bash
# Prints one `service=hash` line per release unit for a commit: the git TREE hashes of every path
# that can change that unit's image, plus a hash of its public build settings. Equal hash = the
# previous image is still correct, so it is reused (same digest) and the service is not restarted.
# Conservative on purpose: shared inputs (the lockfile, the root manifest, shared packages) change
# EVERY dependent unit. A path missing at the commit contributes nothing, never an error.
#   service-inputs.sh <commit> [public-settings-dir]    (dir holds api.env web.env portal.env cbt.env public lines)
set -euo pipefail
sha=${1:?commit}; pub=${2:-}
tree() { git rev-parse --verify -q "$sha:$1" 2>/dev/null || echo "-"; }
paths_hash() { local p; for p in "$@"; do echo "$p $(tree "$p")"; done | sha256sum | cut -c1-24; }
pubhash() { if [ -n "$pub" ] && [ -f "$pub/$1.env" ]; then sha256sum < "$pub/$1.env" | cut -c1-16; else echo "-"; fi; }
shared=(pnpm-lock.yaml package.json pnpm-workspace.yaml packages/config packages/types packages/db tsconfig.base.json turbo.json)
echo "api=$(paths_hash "${shared[@]}" packages/ai apps/api)"
echo "render-worker=$(paths_hash "${shared[@]}" packages/ai apps/api)"
echo "web=$(paths_hash "${shared[@]}" packages/ui apps/web infra/vps/Dockerfile.next infra/vps/Dockerfile.next.dockerignore)-$(pubhash web)"
echo "portal=$(paths_hash "${shared[@]}" packages/ui apps/portal infra/vps/Dockerfile.next infra/vps/Dockerfile.next.dockerignore)-$(pubhash portal)"
echo "cbt=$(paths_hash "${shared[@]}" packages/ui apps/cbt infra/vps/Dockerfile.next infra/vps/Dockerfile.next.dockerignore)-$(pubhash cbt)"
echo "migrate=$(paths_hash pnpm-lock.yaml package.json pnpm-workspace.yaml packages/config packages/db infra/vps/migrate)"
