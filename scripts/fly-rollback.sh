#!/usr/bin/env bash
#
# Fly image rollback helper.
#
# ─── Why this exists (2026-09-26) ────────────────────────────────────────────
#
# `flyctl releases rollback` DOES NOT EXIST. It is not a subcommand in flyctl
# v0.4.83 (`flyctl releases --help` lists only flags: -a/--app, -c/--config,
# -h/--help, --image, -j/--json — no subcommands at all). It was nonetheless
# invoked by docs/runbooks/deploy-rollback.md and, worse, by
# deploy-staging.yml's auto-rollback-on-smoke-failure step — so that automatic
# rollback would itself have failed the moment it ever fired.
#
# `flyctl releases list` is invalid for the same reason and was also in the
# runbook. The correct invocation is a bare `flyctl releases`.
#
# The mechanism that DOES work, verified in production on 2026-09-26 (it
# produced school-kit-api v278 from v276's image):
#
#     flyctl deploy --config <cfg> --app <app> --image <imageRef>
#
# That redeploys an existing registry image. It does not rebuild from source,
# so it cannot pick up the bad commit again, and it is fast (~65s observed).
#
# ─── Ordering is NOT assumed ─────────────────────────────────────────────────
#
# `flyctl releases --image --json` happens to return newest-first, but this
# script sorts by .Version descending explicitly rather than indexing .[0]/.[1]
# on faith. A silent ordering change upstream would otherwise roll production
# to an arbitrary image.
#
# ─── Why node and not jq ─────────────────────────────────────────────────────
#
# Both exist on ubuntu-latest, and deploy-staging.yml already runs
# actions/setup-node before flyctl. node was chosen because the selection logic
# can then be exercised locally against a real `flyctl releases --image --json`
# capture (see scripts/__tests__/fly-rollback.test.sh), which is what makes the
# fail-closed paths verifiable without breaking production to try them.

set -euo pipefail

die() {
  echo "::error::fly-rollback: $*" >&2
  exit 1
}

# Reads a flyctl releases JSON array on stdin and prints "<version>\t<imageRef>"
# for the Nth-newest COMPLETE release that carries a non-empty ImageRef.
# $1 = zero-based rank (0 = newest, 1 = the one before it).
# Exits non-zero, with a reason on stderr, on anything malformed.
select_release() {
  local rank="$1"
  node -e '
    const rank = Number(process.argv[1]);
    let raw = "";
    process.stdin.on("data", (d) => (raw += d)).on("end", () => {
      let rel;
      try {
        rel = JSON.parse(raw);
      } catch {
        console.error("flyctl releases did not return parseable JSON");
        process.exit(1);
      }
      if (!Array.isArray(rel)) {
        console.error("expected a JSON array of releases");
        process.exit(1);
      }
      const usable = rel
        .filter(
          (r) =>
            r &&
            r.Status === "complete" &&
            typeof r.ImageRef === "string" &&
            r.ImageRef.length > 0 &&
            Number.isFinite(Number(r.Version)),
        )
        .sort((a, b) => Number(b.Version) - Number(a.Version));
      if (usable.length <= rank) {
        console.error(
          `need at least ${rank + 1} complete release(s) with an image, found ${usable.length}`,
        );
        process.exit(1);
      }
      const pick = usable[rank];
      process.stdout.write(`${pick.Version}\t${pick.ImageRef}\n`);
    });
  ' "$rank"
}

releases_json() {
  local app="$1"
  flyctl releases --app "$app" --image --json 2>/dev/null ||
    die "could not list releases for app '$app' (auth, network, or unknown app)"
}

# current-image <app>  -> "<version>\t<imageRef>" of the live release
cmd_current_image() {
  local app="${1:-}"
  [ -n "$app" ] || die "current-image needs <app>"
  releases_json "$app" | select_release 0 ||
    die "could not determine the current image for '$app'"
}

# previous-image <app> -> "<version>\t<imageRef>" of the release before the live
# one. For interactive/runbook use; the workflow prefers a pre-deploy capture.
# Fails closed when there is no distinct earlier image to go back to.
cmd_previous_image() {
  local app="${1:-}"
  [ -n "$app" ] || die "previous-image needs <app>"
  local json cur prev
  json="$(releases_json "$app")"
  cur="$(printf '%s' "$json" | select_release 0)" ||
    die "could not read the current release for '$app'"
  prev="$(printf '%s' "$json" | select_release 1)" ||
    die "no previous complete release with an image for '$app' — nothing to roll back to"
  if [ "${cur#*$'\t'}" = "${prev#*$'\t'}" ]; then
    die "current and previous releases for '$app' point at the same image (${prev#*$'\t'}) — a rollback would be a no-op; pick a target explicitly"
  fi
  printf '%s\n' "$prev"
}

# to-image <app> <config> <imageRef>
# Redeploys an exact image. No-ops (exit 0) when the app is already on it, so
# rolling back an app that never advanced is safe rather than a spurious deploy.
cmd_to_image() {
  local app="${1:-}" config="${2:-}" target="${3:-}"
  [ -n "$app" ] || die "to-image needs <app>"
  [ -n "$config" ] || die "to-image needs <config>"
  [ -n "$target" ] || die "to-image needs a non-empty <imageRef> for '$app' (was a pre-deploy capture skipped?)"
  [ -f "$config" ] || die "fly config '$config' not found"
  case "$target" in
    registry.fly.io/*) ;;
    *) die "refusing to deploy '$target' for '$app': not a registry.fly.io image reference" ;;
  esac

  local cur cur_ver cur_img
  cur="$(cmd_current_image "$app")"
  cur_ver="${cur%%$'\t'*}"
  cur_img="${cur#*$'\t'}"

  echo "app=$app current=v${cur_ver} current_image=${cur_img}"
  echo "app=$app target_image=${target}"

  if [ "$cur_img" = "$target" ]; then
    echo "app=$app already on the target image — nothing to roll back"
    return 0
  fi

  echo "app=$app rolling back v${cur_ver} -> ${target}"
  flyctl deploy --config "$config" --app "$app" --image "$target" --wait-timeout 300 ||
    die "rollback deploy FAILED for '$app' — it may still be on the bad image; see docs/runbooks/deploy-rollback.md"

  local after after_ver
  after="$(cmd_current_image "$app")"
  after_ver="${after%%$'\t'*}"
  if [ "${after#*$'\t'}" != "$target" ]; then
    die "rollback for '$app' reported success but the live image is ${after#*$'\t'}, not ${target}"
  fi
  echo "app=$app rolled back OK — now v${after_ver} on ${target}"
  flyctl status --app "$app" || true
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    current-image) cmd_current_image "$@" ;;
    previous-image) cmd_previous_image "$@" ;;
    to-image) cmd_to_image "$@" ;;
    *)
      cat >&2 <<'USAGE'
usage:
  fly-rollback.sh current-image  <app>
  fly-rollback.sh previous-image <app>
  fly-rollback.sh to-image       <app> <fly-config> <imageRef>

current-image / previous-image print "<version><TAB><imageRef>".
to-image redeploys an exact existing image; it never rebuilds from source.
USAGE
      exit 2
      ;;
  esac
}

main "$@"
