#!/usr/bin/env python3
"""Decides which CI jobs a change needs. CONSERVATIVE BY CONSTRUCTION: it can only SKIP work for files
it positively recognises as unable to affect that work. Any file it does not recognise runs everything.

  changes.py [--base REF] [--head REF] [--all] [--list FILE]    prints key=value lines for $GITHUB_OUTPUT

Outputs: static, api, frontend_apps (JSON array), build, e2e, tooling, backup_image, all.
`--all` (pushes to main, schedules, manual runs) turns everything on: the full suite always runs
before a release and after a merge, so a wrong skip on a pull request cannot reach production."""
from __future__ import annotations

import argparse
import fnmatch
import json
import subprocess
import sys

APPS = ["web", "portal", "cbt"]
# Anything under these forces the full suite: they are inputs of every job.
GLOBAL = [
    "pnpm-lock.yaml", "package.json", "pnpm-workspace.yaml", "turbo.json", "tsconfig.base.json", ".npmrc", ".nvmrc",
    ".github/workflows/ci.yml", ".github/workflows/ci-*.yml", ".github/actions/ci-*/**", "scripts/ci/**",
    "packages/config/**", "packages/types/**", "packages/db/**", "infra/postgres/**", "docker-compose.yml",
]
# Only tooling jobs (unit tests, shellcheck, the real-stack qualification) need to react.
TOOLING = [
    "infra/vps/**", "scripts/release/**", "scripts/release-qualification/**", "scripts/*.sh", "scripts/*.mjs", "scripts/*.sql",
    "scripts/__tests__/**", ".github/workflows/release*.yml", ".github/workflows/batch2-*.yml", ".github/workflows/deploy-*.yml",
    ".github/workflows/vps-*.yml", ".github/workflows/messaging-*.yml", ".github/workflows/instalment-*.yml",
    ".github/workflows/backup-*.yml", ".github/workflows/db-restore-test.yml", ".github/workflows/assistant-live-evals.yml",
    ".github/workflows/mobile-build.yml", ".github/workflows/pr-title.yml", ".github/actions/vps-*/**", "docs/runbooks/**",
]
# Documentation no test reads. (The two files tests DO read are deliberately not here.)
DOCS = ["docs/**", "*.md", "LICENSE", ".github/ISSUE_TEMPLATE/**", ".github/*.md", "dump.rdb"]
DOCS_READ_BY_TESTS = ["docs/onboarding-guide.md", "CLAUDE.md", "AGENTS.md", "WORKFLOW.md"]
BACKUP_IMAGE = ["infra/vps/postgres/**", ".github/workflows/ci.yml"]


def match(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, p) or (p.endswith("/**") and path.startswith(p[:-2])) for p in patterns)


def decide(files: list[str], everything: bool = False) -> dict:
    out = {"static": False, "api": False, "frontend": set(), "build": False, "e2e": False, "tooling": False, "backup_image": False}
    if everything or not files:  # nothing known: do everything
        out.update(static=True, api=True, frontend=set(APPS), build=True, e2e=True, tooling=True, backup_image=True)
        out["all"] = True
        return out
    out["all"] = False
    for f in files:
        if match(f, DOCS_READ_BY_TESTS):
            out.update(api=True, static=False)
            out["frontend"].add("web")
            continue
        if match(f, BACKUP_IMAGE):
            out["backup_image"] = True
        if match(f, GLOBAL):
            out.update(static=True, api=True, build=True, e2e=True, tooling=True, backup_image=True)
            out["frontend"] |= set(APPS)
            out["all"] = True
        elif match(f, TOOLING):
            out["tooling"] = True
        elif match(f, DOCS):
            continue
        elif f.startswith("apps/api/") or f.startswith("packages/ai/"):
            out.update(static=True, api=True, e2e=True, build=True)
        elif f.startswith("packages/ui/"):
            out.update(static=True, build=True, e2e=True)
            out["frontend"] |= set(APPS)
        elif any(f.startswith(f"apps/{a}/") for a in APPS):
            app = f.split("/")[1]
            out.update(static=True, build=True, e2e=True)
            out["frontend"].add(app)
        elif f.startswith("apps/mobile/"):
            out["static"] = True
        elif f.startswith("e2e/"):
            out.update(static=True, build=True, e2e=True)
        else:
            # not recognised: run everything
            out.update(static=True, api=True, build=True, e2e=True, tooling=True)
            out["frontend"] |= set(APPS)
            out["all"] = True
    return out


def changed_files(base: str, head: str) -> list[str]:
    r = subprocess.run(["git", "diff", "--name-only", f"{base}...{head}"], capture_output=True, text=True)
    if r.returncode != 0:
        r = subprocess.run(["git", "diff", "--name-only", base, head], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"cannot list changed files: {r.stderr.strip()}")
    return [x for x in r.stdout.splitlines() if x]


def render(d: dict) -> list[str]:
    b = lambda v: "true" if v else "false"  # noqa: E731
    return [
        f"static={b(d['static'])}", f"api={b(d['api'])}", f"frontend_apps={json.dumps(sorted(d['frontend']))}",
        f"build={b(d['build'])}", f"e2e={b(d['e2e'])}", f"tooling={b(d['tooling'])}",
        f"backup_image={b(d['backup_image'])}", f"all={b(d['all'])}",
    ]


def main(argv=None) -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base"); p.add_argument("--head", default="HEAD")
    p.add_argument("--all", action="store_true"); p.add_argument("--list")
    a = p.parse_args(argv)
    if a.list:
        files = [x.strip() for x in open(a.list) if x.strip()]
    elif a.all or not a.base:
        files = []
    else:
        files = changed_files(a.base, a.head)
    print("\n".join(render(decide(files, a.all))))
    return 0


if __name__ == "__main__":
    sys.exit(main())
