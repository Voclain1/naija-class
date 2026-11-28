# Deployment and CI audit: 2026-11-27

Scope: GitHub Actions workflows, Dockerfiles, the VPS deployment and operator scripts, migration
procedure, backup and recovery, secrets, concurrency, and CI history. Method: read every file named
below, measure real CI runs through the Actions API (run 46047290807 and the 30 runs around it),
and run the new tooling against a real PostgreSQL 18 + Redis + Caddy stack. Nothing here touched
production, and no production credential was used.

Companion documents: `docs/runbooks/automated-release.md` (how to operate the result),
`docs/reviews/deployment-ci-qualification-2026-11-27.md` (the failure-injection evidence).

## 1. What was found

### 1.1 Deployment

| ID | Severity | Finding | Evidence |
|---|---|---|---|
| D1 | **High** | **The routine deploy cannot be used on production, so every release became a hand-run Termius session.** `deploy-vps.yml` refuses to run unless `VPS_MODE=rehearsal` and `deploy.sh` refuses unless the same. Production is `live`, so the only path left is the one-off `cutover.sh` | `deploy-vps.yml` "Check settings"; `deploy.sh` lines 10-14 |
| D2 | **High** | **`deploy.sh` is dangerous on a production host.** It runs `compose up -d --build --remove-orphans`. The pinned backup scheduler (`ops-pinned`) exists only in an override file the script does not pass, so `--remove-orphans` would delete it. `--build` can rebuild Caddy and PostgreSQL. This is why the rehearsal-only guard had to exist | `deploy.sh` `compose up -d --build --remove-orphans`; `lib.sh` has no override |
| D3 | **High** | **Images are addressed by mutable tag** (`school-kit-api:<sha>` through `APP_TAG`). Rollback is `compose up -d` of the previous tag, which can pull whatever the tag points at now, needs the registry, and is not provably the image that ran before | `docker-compose.yml` `image: ${IMAGE_PREFIX}/school-kit-api:${APP_TAG}`; `deploy.sh` `.previous-tag` |
| D4 | **High** | **Migrations run from the CI runner, over an SSH tunnel, before the new images exist and with no restore point, drain, approval or classification.** A failed migration after a partial deploy has no defined recovery. The header comment says it plainly: "A rollback swaps images only, never the schema, so migrations must stay backward compatible, as today", but nothing checks that | `deploy-vps.yml` "Migrate the VPS database" |
| D5 | **High** | **The smoke test writes to production.** `smoke-test.sh` signs up a new school and owner on every deploy; `prune-smoke-schools.sql` cleans up afterwards over the same tunnel. A failure between the two leaves test tenants in the live database | `scripts/smoke-test.sh` op 3; `deploy-vps.yml` "Prune smoke-test schools" |
| D6 | **High** | **No financial or infrastructure verification after a deploy.** Acceptance is six HTTP calls plus a 60 x 3 s health loop. Nothing checks duplicate Paystack references, over-allocation, the webhook inbox, instalment integrity, that the backup scheduler still runs, or that the image running is the image intended | `deploy.sh` `healthy()`; `smoke-test.sh` |
| D7 | Med | **Every image changes on every commit**, because the commit is a build argument (`SENTRY_RELEASE`) and an image label. Every deploy therefore restarts every service, however small the change, and there is no way to say "only the web app changed" | `deploy-vps.yml` build steps |
| D8 | Med | **No durable deployment state.** The only memory is `APP_TAG` in `deploy.env` and a one-line `.previous-tag`; since the cutover, `release.override.yml` is the real pin and `APP_TAG` is stale. An interrupted deploy leaves no record of how far it got | `deploy.sh`; `ops-tools/lib.sh` `dco` comment |
| D9 | Med | **No server-side lock.** The workflow has a concurrency group, but nothing stops a Termius session from running at the same time as a workflow. `cutover.sh` has its own lock file that `deploy.sh` does not take | `deploy-vps.yml` `concurrency`; `cutover.sh` `flock` |
| D10 | Med | **The operator tooling is a single-release tool.** `cutover.sh` is bound to PR #563 (the phrase `batch3`, `UNIFIED_MESSAGING_CUTOVER_APPROVED`, a hard-coded `releases/25e54017…/candidate.yml`, `invoice-565.override.yml`). It is excellent evidence of the right invariants, but it cannot ship the next release | `ops-tools/lib.sh` lines 17-26 |
| D11 | Med | **Four workflows are keyed to specific PR numbers** (563, 564, 566) and build images under four tag schemes (`batch2-candidate-<run>`, `batch2-recovery-<run>`, `instalment-<sha>`…). They are one-off and cannot be reused, and nothing records what a "release" is | `batch2-images.yml`, `messaging-frontend-images.yml`, `instalment-release-images.yml` |
| D12 | Med | **Settings are regenerated from GitHub secrets on every deploy**, with a hand-written exception for two voice keys the server holds locally. Any other setting changed on the server is silently overwritten | `deploy-vps.yml` "Ship settings and switch" |
| D13 | Med | **A VPS disk preflight prunes the build cache on the production host** (`docker builder prune -af --filter until=24h`). It is limited to build cache, but it is a mutation outside any release | `deploy-vps.yml` "VPS disk preflight" |
| D14 | Low | The release step copies the whole `infra/vps` folder to the server (including `ops-tools/`) on every deploy | `deploy-vps.yml` `tar -C infra/vps` |
| D15 | Info | Caddy is shared with BetGenius and other sites. The repository's Caddyfile may not be byte-identical to the server's, so any tool that edits it must change only School Kit's blocks and refuse if it cannot find exactly those | `infra/vps/Caddyfile`, owner brief |

What is **already good** and was kept as the standard to meet: the cutover tool's protected-infrastructure
identity checks, the stopped original `ops` container, immutable digests with revision labels, the
drain-before-stop rule, persistent maintenance by Caddyfile rewrite, and fail-closed process inspection.

### 1.2 CI

Measured on run 46047290807 (main, all green), the most recent complete run:

| Job | Wall time | Where it goes |
|---|---|---|
| `lint + typecheck + test + build` | **12 m 58 s** | checkout/setup 0:30 · install+generate+build packages+migrate+seed 0:50 · lint 0:24 · typecheck 1:09 · **test 7:36** · build web 1:52 · build portal 0:34 |
| `e2e (Playwright)` | **12 m 17 s** | setup+install+db 1:20 · browser 0:16 · **build web+portal+cbt 1:53** · **Playwright 9:07 (1 worker)** |
| `PostgreSQL backup image` | 0 m 24 s | |

Across the 31 most recent completed runs: median wall time about 15 m 40 s, fastest 13 m 20 s,
slowest 20 m 11 s (a failing run); 12 of 31 were cancelled by a newer push (the existing
`cancel-in-progress` works).

| ID | Finding |
|---|---|
| C1 | **The critical path is one serial chain.** Lint, typecheck, test and two builds run one after another in one job, so wall time is the sum (12:58) rather than the longest piece. |
| C2 | **The test step is 59 % of that job**, and it is serial by design: `apps/api` runs 287 spec files in a single fork because they share one database (`vitest.config.ts` `singleFork`). Coverage (`VITEST_COVERAGE=1`) is also always on. |
| C3 | **Duplicated builds.** `ci` builds web and portal (2:26) and `e2e` builds web, portal and cbt again (1:53). The e2e job also repeats install, Prisma generate, package build, migrate and seed. |
| C4 | **Playwright runs 106 spec files on one worker** (`workers: 1`) in one job: 9 minutes, and historically up to 44 (the timeout comments in `ci.yml`). |
| C5 | **Everything runs for every change.** A docs-only or `infra/` change pays the full 13 minutes. There is no change detection. |
| C6 | **A merge to `main` runs the whole suite again** on the commit the PR already tested, and the deploy waits for it. |
| C7 | **No dependency-aware caching of build or typecheck results** (Turbo is used with local, non-persisted cache only). |
| C8 | **The PostgreSQL 18 service container is started per job**, which is correct (the same major as production), but the migrate + seed steps repeat in each job that needs a database. |
| C9 | Releases and CI are not separated: there is no "routine" versus "release qualification" split. The heavy, slow-by-nature checks (a real-stack rehearsal) have no home. |

## 2. Decisions

| # | Decision | Why |
|---|---|---|
| A1 | **A release is a manifest**: a JSON file naming every image by `@sha256` digest (tags refused, registry allow-listed), every migration with its Prisma checksum and a class, and the commit each image was built from. | The unit of approval, deployment, rollback and audit. What was approved is what runs. |
| A2 | **Build only what changed.** Each unit's inputs (git tree hashes of the paths that can change it, plus its public build settings) are hashed; an unchanged unit keeps its digest and is never restarted. The commit is no longer baked into units that did not change. | Fixes D7. "Scoped deployment of affected services only". |
| A3 | **Migrations are classified from their SQL**: additive, data, or breaking, with a destructive flag. Objects created in the same migration are not counted against it. On this repository's 209 migrations: 100 additive, 53 data, 56 breaking, 7 destructive. | Decides, mechanically, which gates apply: additive runs beside the old release with no maintenance; data and breaking need a quiet system; breaking forbids rollback; destructive needs a second approval. |
| A4 | **Two gates and one kill switch.** Application-only releases need no approval. Schema releases need an owner approval *bound to the manifest's hash* (4 h), destructive ones a second flag. `--trigger auto` additionally needs a file only the server holds (`AUTO_ENABLED`). | Fixes D4; keeps the owner's "approval gates for migrations, destructive operations and exceptional financial changes". |
| A5 | **The release runs on the server, detached, as a phase machine** with a durable state file and an append-only journal. Any phase boundary is a place it can stop and a place `resume` can continue. The CI job only starts it and watches. | Fixes D8 and makes SSH loss a non-event. |
| A6 | **A single server lock** held by every state-changing command, including the installer and cleanup. | Fixes D9. |
| A7 | **Rollback uses only images already on the server**, verified present before a release is allowed to start. It is allowed only when every migration applied since is additive or data. Otherwise the state is `FIX_FORWARD_REQUIRED` with maintenance on. | Fixes D3. "Local rollback independent of registry availability"; "fix-forward recovery for incompatible database changes". |
| A8 | **Only the four application services are ever created, stopped or recreated**: `--no-deps --no-build --pull never`, no `--remove-orphans`, no `down`, no prune. PostgreSQL, Redis, the pinned scheduler, the stopped original `ops`, and `backup.env` are re-checked by container identity before and after every phase. A Caddy restart by something else is reported and maintenance re-asserted, not treated as a failure. | Fixes D2. |
| A9 | **Persistent maintenance is the Caddyfile on disk**, not a process: only School Kit's three host blocks (and its school-address wildcard) are rewritten to `503 + Retry-After`; everything else is copied byte for byte, and the rewriter refuses unless it finds exactly those three blocks. | Fixes D15; survives a Caddy restart or a reboot. |
| A10 | **Acceptance is read-only and never initiates a payment or message.** It replaces the production smoke test (D5). Startup conditions are retried inside a window; integrity conditions are not. Money counters are compared to a baseline taken before the release, so existing data anomalies warn and new ones fail; duplicate Paystack references and allocation above amount have zero tolerance. | Fixes D5, D6. |
| A11 | **Logs are redacted at the point of writing** (URLs with credentials, API keys, webhook secrets, bearer tokens, signatures, emails, phone numbers, JWTs), and the journal stores identifiers and phases only. | "Logs must never disclose credentials, personal information or payment secrets." |
| A12 | **The existing operator tooling is left alone**, and the new tool refuses to run while `release/state` shows the coordinated cutover in progress. The release data lives in `deployments/`, not `release/`. | The owner's instruction not to interfere with Codex's work. |
| A13 | **Qualification runs real infrastructure.** A local registry gives real digests and can really be stopped; PostgreSQL 18, Redis and Caddy are the real images; the real repository Caddyfile is used; only the application images are stand-ins. Faults are injected by real means (kill -9, stopping the registry, restarting Redis, removing an image). | A helper-function test cannot show that a half-finished release is recoverable. |
| C-A | (PR 2) Split CI into parallel jobs, shard the API tests across jobs that each own a PostgreSQL 18 service, shard Playwright, build the front ends once, filter by changed paths conservatively, and make the slow release qualification a separate workflow. | See `docs/reviews/ci-performance-2026-11-27.md`. |

## 3. Residual risks (also in the runbook)

1. **The production Caddyfile has not been read.** The tool refuses unless it finds exactly the
   three School Kit host blocks it expects; if the server's file differs, maintenance cannot be
   switched on and a schema release will stop before changing anything.
2. **Stub application images** were used for qualification; the real images' start-up behaviour
   (migrations at boot, Redis connection, graceful shutdown inside 60 s) is exercised only at the
   first real release.
3. **The API has a brief gap while it restarts.** An application-only release has no maintenance
   window, so a request or Paystack delivery arriving in those seconds sees an error; Paystack
   retries, and the webhook inbox is checked afterwards. The measured gap is in the qualification
   evidence.
4. **A migration classified `additive` that is not** (the classifier is a heuristic over SQL text)
   would run beside the old release. The approval gate and the restore point are the backstop, and
   `breaking` is the default for anything the rules cannot place.
5. **`release.override.yml` is shared with `cutover.sh`.** The new tool refuses to run during a
   cutover, but a cutover started after a release overwrites the file by design.
6. The GitHub workflows in this change cannot be exercised end to end without the production
   secrets; their logic lives in scripts that are tested (`poll-release.sh`, `service-inputs.sh`,
   `release_tool.py`, the installer), and the workflow YAML is parsed and reviewed but unproven
   until the first manual dispatch.
