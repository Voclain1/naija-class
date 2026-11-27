#!/usr/bin/env bash
# Controlled cleanup of old release artefacts on the server. DRY RUN by default; --apply deletes.
#
# What it may remove: School Kit application/migration images that no kept release needs, and
# diagnostics/alerts/staged manifests past their retention. What it never touches: volumes,
# containers, PostgreSQL/Redis/Caddy/backup images, the pinned scheduler's image or its fallback
# tag, anything the current or previous release (or a release in flight) names, the append-only
# history journal, or any image a container still uses (Docker itself refuses that).
# No `prune` of any kind is ever run.
set -Eeuo pipefail
here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# shellcheck source=lib.sh
. "$here/lib.sh"
exec </dev/null
cd "$SK_DIR"
apply=0; [ "${1:-}" = --apply ] && apply=1
KEEP_RELEASES=${RELEASE_KEEP_RELEASES:-3}
FALLBACK_TAG=${FALLBACK_TAG:-schoolkit-ops-fallback:batch2-verified}
[ -f "$D/current" ] || { echo "BLOCK no adopted release: refusing to decide what is old" >&2; exit 1; }
terminal() { case "$(state_get phase)" in ''|ROLLED_BACK|ABORTED) return 0 ;; COMPLETE) [ "$(state_get accepted)" = true ] ;; *) return 1 ;; esac; }
terminal || { echo "BLOCK a release is in state $(state_get phase): no cleanup now" >&2; exit 1; }
exec 9>"$D/apply.lock"; flock -n 9 || { echo "BLOCK a release is running" >&2; exit 5; }

keep=$(mktemp); all=$(mktemp); trap 'rm -f "$keep" "$all"' EXIT
refs() { python3 -c 'import json,sys
m=json.load(open(sys.argv[1])); print("\n".join(list(m["images"].values())+[m["migrate_image"]]))' "$1"; }
# newest N releases by directory name (ids sort by build time), plus current and previous, plus the staged one if any
{ ls -1 "$D/releases" 2>/dev/null | sort | tail -n "$KEEP_RELEASES"; cat "$D/current" "$D/previous" 2>/dev/null; } | sort -u | while read -r id; do
  [ -f "$D/releases/$id/manifest.json" ] && refs "$D/releases/$id/manifest.json"
done > "$keep"
rid=$(state_get release_id); [ -z "$rid" ] || { [ ! -f "$D/staging/$rid.json" ] || refs "$D/staging/$rid.json" >> "$keep"; }
for f in "$D"/releases/*/manifest.json; do [ -f "$f" ] && refs "$f"; done | sort -u > "$all"
override=$(sed -n 's/^[[:space:]]*image:[[:space:]]*//p' backup-ops.override.yml 2>/dev/null | head -n 1 || true)
[ -z "$override" ] || echo "$override" >> "$keep"
sort -u -o "$keep" "$keep"
removed=0
while read -r ref; do
  [ -n "$ref" ] || continue
  grep -qxF "$ref" "$keep" && continue
  [[ $ref == *school-kit-postgres* ]] && continue
  docker image inspect "$ref" >/dev/null 2>&1 || continue
  if [ "$apply" = 1 ]; then docker rmi "$ref" >/dev/null 2>&1 && { echo "REMOVED $ref"; removed=$((removed + 1)); } || echo "KEPT (in use) $ref"
  else echo "WOULD REMOVE $ref"; removed=$((removed + 1)); fi
done < "$all"
# data retention
act=(-print); [ "$apply" = 0 ] || act=(-print -delete)
find "$D/diagnostics" -type f -mtime +"${RELEASE_KEEP_DIAG_DAYS:-30}" "${act[@]}" 2>/dev/null | sed 's/^/DIAGNOSTIC /' || true
find "$D/alerts" -type f -mtime +"${RELEASE_KEEP_ALERT_DAYS:-90}" "${act[@]}" 2>/dev/null | sed 's/^/ALERT /' || true
find "$D/staging" -type f -mtime +"${RELEASE_KEEP_STAGING_DAYS:-30}" ! -name "$(state_get release_id).json" "${act[@]}" 2>/dev/null | sed 's/^/STAGED /' || true
# approvals are single-use evidence of consent: expired ones go, the journal keeps the fact
for a in "$D"/approvals/*.json; do
  [ -f "$a" ] || continue
  python3 -c 'import json,sys,time; sys.exit(0 if json.load(open(sys.argv[1]))["expires_at"] < time.time() - 86400 else 1)' "$a" && { [ "$apply" = 1 ] && rm -f "$a"; echo "APPROVAL $(basename "$a") (expired)"; }
done
echo "$([ "$apply" = 1 ] && echo removed || echo would-remove) $removed image reference(s); kept releases: $(sort -u "$keep" | wc -l) image(s)"
[ "$apply" = 1 ] || echo "dry run: nothing was deleted (re-run with --apply)"
