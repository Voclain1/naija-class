# CI performance: 2026-11-27

Companion to `docs/reviews/deployment-ci-audit-2026-11-27.md` (§1.2 has the findings; this file
has the design, the measurements and what is deliberately not done).

## 1. Before

Measured through the Actions API on `main` run 46047290807 (all green, the latest complete run when
the work began), and the 14 most recent successful runs around it.

| Job | Wall time | Breakdown |
|---|---|---|
| `lint + typecheck + test + build` | **12 m 58 s** | setup 0:50 · install/generate/build packages/migrate/seed 0:50 · lint 0:24 · typecheck 1:09 · **test 7:36** · build web 1:52 · build portal 0:34 |
| `e2e (Playwright)` | **12 m 17 s** | setup 1:20 · browser 0:16 · **build web+portal+cbt 1:53** · **Playwright 9:07** (106 spec files, 1 worker) |
| `PostgreSQL backup image` | 0 m 24 s | |

Run wall time (queue included) over the 14 most recent successful runs: **min 13 m 20 s, median 15 m 42 s,
max 19 m 07 s.** Nothing was skipped by path: a one-line docs change cost the same as an API change.

## 2. Design

```
changes ──┬─ static   lint + typecheck + web/portal/cbt unit tests          (1 job)
          ├─ api-test 6 shards, each with its own PostgreSQL 18 and Redis    (6 jobs)
          ├─ build    web, portal, cbt production builds, once               (1 job)
          │           └─ e2e-test 5 Playwright shards                        (5 jobs)
          ├─ tooling  release tooling unit tests, script tests, shellcheck
          └─ backup-image (layer-cached)
          ci  "lint + typecheck + test + build"  and  e2e  "e2e (Playwright)"   <- the contract names
```

| Decision | Reason and evidence |
|---|---|
| Lint, typecheck and the front-end unit tests share one job | One `turbo run lint typecheck` runs all 25 tasks concurrently: 1 m 46 s locally. The front-end unit tests take 13 s + 2 s + 2 s; three runners for 17 s of work would each pay a minute of setup |
| API tests in 6 shards, each its own database | `apps/api` runs 287 spec files serially against one PostgreSQL by design (RLS bugs only show on a real server). That property is kept *inside* a shard; sharding multiplies databases, it does not share one. Shard 1 of 6, run for real against PostgreSQL 18: 48 files, 705 tests, all passed, 2 m 42 s while competing with another job. One file (`worker-tuning.spec.ts`, a timing test) takes 94 s alone, which sets the floor for the shard that holds it |
| Playwright in 5 shards | `playwright test --list` over the 5 shards gives 55 + 45 + 51 + 64 + 34 = **249 tests in 106 files**, identical to the unsharded list. No spec depends on another (no `globalSetup`, no `serial`, no project dependencies): each signs up its own school. Shard 5 run for real against the production builds: 34 tests, 2 m 27 s (31 passed; the 3 typography specs failed only for lack of an ffmpeg revision in this sandbox and passed when it was linked) |
| The three Next.js builds happen once, in parallel, and are passed to the shards as an artifact | They were built twice (ci: web+portal; e2e: web+portal+cbt). They are also the compile check. `.next/cache` is cached by lockfile so an incremental build is shorter |
| Change detection (`scripts/ci/changes.py`) is an allow-list of what may be skipped | An unrecognised path runs everything. Documentation no test reads, and the release tooling (which has its own job), may skip the heavy jobs. `docs/onboarding-guide.md`, `CLAUDE.md` and `AGENTS.md` are read by tests and are not skippable. Pushes to `main`, the nightly schedule and manual runs run everything, and the aggregate jobs fail if anything was skipped on such a run |
| The two aggregate jobs keep their old names | Branch protection and `release.yml`'s "CI is green for this commit" gate read `lint + typecheck + test + build` and `e2e (Playwright)` |
| PostgreSQL 18 is proved, not assumed | `scripts/ci/db-init.sh` fails if `server_version_num / 10000` is not 18, so a service image that drifts to another major cannot make every database test pass against the wrong server |
| One CI `.env`, one setup action | The 40-line `.env` was copied verbatim into two jobs; now `scripts/ci/write-env.sh`. The six setup steps are `.github/actions/ci-setup` |
| Coverage moves to a nightly job | It was collected on every run; it is reporting only (no threshold) and cannot be merged across shards without more machinery. The nightly job runs the same unsharded api + web suites with coverage and prints the same summary |
| `infra/vps/Dockerfile.next` installs from the lockfile first | It was `COPY . .` then `pnpm install`, so every commit reinstalled every dependency. Now `pnpm fetch` (lockfile only) is its own layer, and the layer cache `release.yml` keeps in GitHub's cache hits it |
| The slow, real-stack release qualification is its own workflow | `release-qualification.yml` (about 30 minutes) runs when the tooling changes, weekly and on demand; routine CI never waits for it |

## 3. After

*(filled from the exact-head run; see the pull request)*

## 4. Not done, and why

- **No cross-commit test-result reuse for a squash merge.** A merge to `main` re-runs everything on a tree
  the pull request already tested. The saving is real but needs a reliable "this tree was already green"
  proof; a wrong skip would put an untested commit in front of the release gate, which reads CI on that commit.
- **No remote Turbo cache.** It would need a credential and a trust decision; the local cache and
  content-addressed restore are used instead.
- **Test files are not rebalanced by duration.** Vitest and Playwright shard by file count; one 94 s
  timing test makes one API shard longer than the others. Splitting it would change what it tests.
- **Coverage is not merged across shards** (see above).
