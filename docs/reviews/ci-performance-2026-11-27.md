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
| API tests in 6 shards (+ one job for the 94 s timing spec), each its own database | `apps/api` runs 287 spec files serially against one PostgreSQL by design (RLS bugs only show on a real server). That property is kept *inside* a shard; sharding multiplies databases, it does not share one. Shard 1 of 6, run for real against PostgreSQL 18: 48 files, 705 tests, all passed, 2 m 42 s while competing with another job. One file (`worker-tuning.spec.ts`, a timing test) takes 94 s alone, which sets the floor for the shard that holds it |
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

Measured on GitHub's runners on the same day as the "before" run above. Run 46068154766 (this
change's first run; `ci.yml` is a global input, so **every job ran, nothing was skipped**):

| Job | Wall time | What it is |
|---|---|---|
| what changed | 0 m 09 s | |
| lint + typecheck + frontend tests | 2 m 09 s | setup 0:35 · `turbo run lint typecheck` 1:13 · web/portal/cbt unit tests 0:15 |
| api tests, shards 2-6 | 2 m 08 s - 2 m 14 s | setup 0:55 · tests 0:49 - 1:02 |
| api tests, shard 1 | 3 m 39 s | the same, but it held the 94 s timing spec (tests 2:26) |
| build web, portal, cbt | 3 m 17 s | setup 0:40 · three builds in parallel 2:23 |
| e2e shards 1-5 | about 4 m (shard 4, the largest at 64 tests: 3 m 59 s) | setup 1:05 · Playwright 2:50 |
| release tooling and scripts | 0 m 09 s | |
| PostgreSQL backup image | 1 m 10 s | cold layer cache |
| **`lint + typecheck + test + build` (the aggregate)** | **3 m 56 s after the run started** | was 12 m 58 s |
| **whole run, e2e included** | **8 m 01 s** | was min 13 m 20 s, **median 15 m 42 s**, max 19 m 07 s |

The old-style CI on the other pull request (#570, run 46067975979, same day) took 8 m 02 s in its
`Test` step alone and about 13 m 45 s for that job.

Reading it honestly: the **routine unit/lint/typecheck/build path is 3 m 56 s**, inside the 3-6 minute
target. A change that also needs the browser suite (any application change) is **8 m 01 s**: the
critical path is `changes` 0:09 → `build` 3:17 → an e2e shard 4:00. That is half the old median but
above 6 minutes; the next levers are below.

**Second run, after the timing spec got its own job** (run 46069503506, head 75c6ead, again everything ran):

| | |
|---|---|
| `lint + typecheck + test + build` (aggregate) | **3 m 10 s** after the run started (was 12 m 58 s) |
| api tests | shards 1-6: 1 m 50 s - 2 m 24 s; the 94 s timing spec in its own job: 2 m 52 s |
| lint + typecheck + frontend tests | 0 m 55 s (Turbo restored every task from the previous run's cache; a changed source file reruns only its tasks) |
| build web, portal, cbt | 2 m 03 s (warm `.next/cache`) |
| e2e shards | 2 m 41 s (34 tests) - 4 m 52 s; shard 2 took **7 m 04 s**, see below |
| whole run | **9 m 22 s**; the other four e2e shards had finished by 7 m 08 s |

**The slow shard (run 46069503506): a flake, not the sharding.** Shard 2 held `tests/exam-papers.spec.ts`; its
first attempt hit the 180 s per-test timeout and the retry passed in 5.4 s (Playwright reports it as
`1 flaky`; CI has run with `retries: 2` for exactly this). `ci.yml`'s old comments already record "a
dev-server memory restart (a 3-minute retry)". Sharding does not cause it, but it does not hide it
either: one such retry is 3 minutes on one shard, where on the old single worker it was 3 minutes in a
44-minute run. Without it the whole run was about 7 m 15 s. Finding why that test's first attempt
hangs is worth doing and is not part of this change.

## 4. Next levers (not done)

- **Overlap the e2e shards' setup with the build** (about -1 m): shards wait for the build artifact only
  at the step that needs it, instead of for the whole `build` job.
- **A sixth e2e shard** (about -30 s): the largest shard has 64 tests against an average of 50.
- **A warm `.next/cache`**: the first run with a new lockfile pays a cold build; later runs are incremental.

## 5. Not done, and why

- **No cross-commit test-result reuse for a squash merge.** A merge to `main` re-runs everything on a tree
  the pull request already tested. The saving is real but needs a reliable "this tree was already green"
  proof; a wrong skip would put an untested commit in front of the release gate, which reads CI on that commit.
- **No remote Turbo cache.** It would need a credential and a trust decision; the local cache and
  content-addressed restore are used instead.
- **Test files are not rebalanced by duration.** Vitest and Playwright shard by file count; one 94 s
  timing test makes one API shard longer than the others. Splitting it would change what it tests.
- **Coverage is not merged across shards** (see above).

## 6. The hang in run 46070650528, found in the trace (2026-11-28)

Both tests in `dashboard-navigation-race.spec.ts` sat for the whole 180 s, on all three attempts, then
failed with `browserContext.close: Target page, context or browser has been closed`. That error is only
where the timeout landed; the Playwright trace of retry 1 (downloaded from the run's artifact) shows what
was actually running: every action finished in under 0.3 s, and the last call, started 0.1 s after the
click and never finished, is **`Wait for load state`**, i.e. `page.waitForLoadState("networkidle")`.

The network log of the same trace explains why it never fired: two `GET /staff/_next/image?url=…schoolkit-icon.png&w=32`
and `&w=16` requests (the next/image optimiser, for the topbar logo) were issued right after the held
request was released and **never got a response** (status -1), so the page was never idle. A third, `w=48`,
had completed in 67 ms earlier in the same trace. The config sets no `actionTimeout`, which Playwright
treats as no limit, so `waitForLoadState` waited until the test timeout; the context cleanup then ran with
no time left. The exam-papers test passed in 3 s in that run: it was not involved (my earlier attribution to
it was wrong, it was the neighbouring flake in an earlier run).

Fix (test only, nothing loosened): `networkidle` is replaced by `settle(page)`: ten animation frames plus
500 ms, which is all the race needs (the old code's `router.replace` ran in the first frames after the
response), bounded and independent of unrelated background requests. The assertions that follow, the URL
staying on `/students` and carrying no `termId`, are unchanged. No timeout was raised and nothing skipped.
Not done: the optimiser stall itself (why two image requests never completed on that server), and the same
`networkidle` idiom in `session-expiry-deep-link`, `guardian-auth` and `a11y-wave3a`, which carry the same
exposure; changing them was out of scope here.
