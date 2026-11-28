# Automated release runbook

How routine School Kit releases reach the VPS without a Termius session, what the system refuses
to do, and what to do when a release does not finish. Written 2026-11-27 with the tooling in
`infra/vps/release/`. **Automatic deployment is not switched on** (§9 is the checklist, and every
step in it is the owner's).

Read with: `docs/reviews/deployment-ci-audit-2026-11-27.md` (why),
`docs/reviews/deployment-ci-qualification-2026-11-27.md` (the failure-injection evidence).
This is separate from `docs/runbooks/batch2-acceptance-and-batch3.md` (the one-off coordinated
cutover) and never runs while that procedure is in progress.

## 1. The shape of it

```
 GitHub (release.yml)                               VPS (/opt/school-kit)
 ─────────────────────                              ───────────────────────────────────────────
 inputs   what changed? (tree hashes)               release-tools/      verified, versioned scripts
 build    only changed units, by digest             deployments/        durable state and journal
 manifest one JSON file = the release                 state.json        phase, release, error, mutated
 plan     read-only on the server                      history.jsonl     append-only journal (redacted)
 deploy   starts it DETACHED, then only watches       releases/<id>/    manifest of every release
                                                      current, previous pointers
                                                      approvals/        owner approvals (bound to a hash)
                                                      baseline/         money counters before each release
                                                      diagnostics/ alerts/  redacted failure evidence
```

The release runs **on the server**, under one lock, as a sequence of phases. The CI job can lose
its connection, be cancelled or time out and the release carries on; `release.sh status` is the
truth.

### Phases

`PLANNED → STAGED → PREFLIGHT_OK → QUIESCED → SNAPSHOT_DONE → MIGRATED → SWITCHED → VERIFIED → COMPLETE`

The recorded phase is the last one **completed**, so `resume` continues at the next. Terminal states:
`COMPLETE`, `ROLLED_BACK`, `ABORTED` (stopped before changing anything), and the two that need a
person: `FIX_FORWARD_REQUIRED` and `ROLLBACK_FAILED`.

## 2. What kind of release is it

`release.sh plan <manifest>` decides from the database and the manifest, not from the commit message.

| Class | When | Approval | Maintenance | Rollback after |
|---|---|---|---|---|
| `NOOP` | what is wanted is already running | none | none | n/a |
| `APP_ONLY` | images differ, no pending migration | none (a server switch exists for unattended runs, §9) | none; only the changed services are recreated | yes |
| `SCHEMA`, all pending **additive** | pending migrations that cannot disturb the old release | **owner approval bound to the manifest** | none: the migration runs beside the old release, then the switch | yes |
| `SCHEMA`, any **data** migration | a backfill or insert into an existing table | approval | **yes**: ingress closed, verified off-site dump, API and worker stopped | yes |
| `SCHEMA`, any **breaking** migration | drops/renames, `NOT NULL` without default, a new constraint or unique index on an existing table | approval | **yes** | **no**: failure ends in `FIX_FORWARD_REQUIRED` |
| any, with a **destructive** migration | `DROP TABLE/COLUMN/TYPE/SCHEMA`, `TRUNCATE`, `DELETE FROM` | approval **with `--allow-destructive`** | as above | as above |

The classification is a heuristic over the SQL text (`release_tool.py classify_sql`, unit tested) and
errs towards the stricter class. Constraints, unique indexes and inserts on a table created in the
same migration do not count. Every manifest carries every migration's class, so a rollback can be
judged later from the record rather than re-guessed.

**Blockers** stop a release before it starts: an already-applied migration whose checksum changed,
a failed (unresolved) migration, a migration older than one already applied, a database ahead of the
release that is not rollback-safe, an unreadable `_prisma_migrations`, or no recorded baseline.

## 3. A routine release

1. Merge to `main`; CI passes (both the job `lint + typecheck + test + build` and `e2e (Playwright)`).
2. Actions → **release** → Run workflow, action `plan` first if you want to look. It builds what
   changed, writes the manifest (kept 90 days as the record), and prints the plan.
3. Run it again with action `deploy`.
   - `APP_ONLY`: job `deploy-app` runs. Nothing else to do.
   - `SCHEMA`: job `deploy-schema` waits for the **required reviewer on the `production-schema`
     environment** (the owner). Approving that job is the approval; it is written to the server as
     `approvals/<manifest sha>.json`, valid four hours, for exactly that manifest.
4. The job installs the verified tools (refused if a release is running), copies the manifest
   (checksum compared after the copy), **stages the images by digest** (a registry outage ends here
   with nothing changed), and starts `release.sh apply … --detach`.
5. It follows the release. On the server, in order:
   - **preflight**: the plan has no blockers; the running system is the recorded current release
     (hand changes are drift); every rollback image is on this server; disk is above the floor;
     PostgreSQL's major matches; the backup is fresh (≤ 26 h, a complete dump and checksum pair
     verified off-site); the feature gates hold; webhook inbox and money counters are healthy;
     not inside the 01:00-02:30 UTC backup window for schema releases; the Caddyfile and every site
     file are fingerprinted; PostgreSQL, Redis, the pinned scheduler, the stopped original `ops` and
     `backup.env` are recorded by container id and start time.
   - **quiesce**: waits (bounded) for zero active background jobs and zero claimed Paystack webhook
     deliveries; **never stops anything mid-job** (exit 4: nothing changed, try again later). Data and
     breaking releases then close ingress and stop only the API and the worker.
   - **snapshot**: a restore point for every schema release; for data/breaking, also a full dump
     written off-site, read back and checksum-verified.
   - **migrate**: with the release's own digest-pinned migration image, `lock_timeout` set so a
     blocked table fails cleanly instead of stalling the live system; then every manifest migration is
     checked applied with its manifest checksum.
   - **switch**: the new pins are written to `release.override.yml`, validated by `docker compose
     config` **before** being used, then each changed service is stopped gracefully and created on
     its pinned digest with `--no-deps --no-build --pull never`, health-checked, in the order worker,
     API, web, portal (exam app if enabled).
   - **verify**: acceptance (§5); then maintenance off; then the edge is checked through Caddy.
6. `COMPLETE`: `current` moves to the new release and `previous` to the old one.

Exit codes of `release.sh apply`: `0` done · `1` failed and the previous release is serving (or it
stopped before changing anything) · `3` refused · `4` system busy or a precondition outside the
release (registry/disk), nothing changed, retry later · `5` another release command is running ·
`6` fix-forward required · `7` rollback failed · **`9` premature exit**: the process ended (for any reason, *including exit status 0*) with no recorded outcome. That is a failure, not a success; state and maintenance are left exactly as they were, and `release.sh resume` continues.

## 4. Commands (on the server: `/opt/school-kit/release-tools/release.sh`)

| Command | Does |
|---|---|
| `status [--json]` | state, phase, current, previous, maintenance, and what to do next |
| `plan F` | read-only plan and blockers |
| `stage F` | pull images by digest, check revision labels; no runtime change |
| `approve F [--allow-destructive] --by WHO` | needs `RELEASE_APPROVED=true` for that one command and the phrase `APPROVE <first 12 of the manifest's sha256>` |
| `apply F [--trigger auto\|manual] [--detach] [--fix-forward]` | the release |
| `resume` | continue an INTERRUPTED release from its last completed phase |
| `abort` | cancel a release that has not changed anything |
| `rollback [--to ID]` | return to `previous` (or an earlier recorded release) from local images |
| `resolve-migration NAME` | mark a failed migration rolled back (needs `RELEASE_APPROVED=true`) |
| `maintenance on\|off\|status` | manual maintenance window |
| `history [N]`, `diagnostics` | journal tail; write a redacted diagnostics bundle |
| `show-current` | print the current release's manifest |
| `adopt --manifest F [--extra-file F]…` | one-time: record what is running as the baseline (§9) |
| `monitor.sh`, `cleanup.sh [--apply]`, `acceptance.sh F internal\|edge\|all` | monitoring, retention, acceptance on demand |

## 5. What acceptance checks

Read-only. It never creates a payment, sends a message, or signs up a school. It replaces the old
smoke test, which created a school in production on every deploy.

| Check | Class | Fails when |
|---|---|---|
| running images | integrity | a service is not running the manifest's digest, or is crash-looping |
| protected infrastructure | integrity | PostgreSQL, Redis, the pinned scheduler, the original `ops` or `backup.env` changed identity |
| migrations | integrity | one is pending, unresolved, or its checksum differs |
| duplicate Paystack references; payment allocated above its amount; runtime role privileged | integrity, **zero tolerance** | any |
| invoices collected above what is due; invoice totals; negative paid; PAID without money; instalment plans not summing to the invoice; non-positive instalments; orphaned instalment links | integrity, **against the baseline** | the count rose since before the release (an old anomaly only warns) |
| webhook inbox | integrity | backlog above 200, more than 3 events waiting over 10 minutes, a new dead-lettered event, a claim stuck over 10 minutes |
| backup scheduler | integrity | not running, not exactly one cron, the original `ops` running, newest complete off-site dump older than 26 h |
| runtime gates (`gates.conf`) | integrity | a gate differs from what the running API holds (paid messaging and legacy SMS must be `off`) |
| application health, API database role, worker, Redis | **transient**: retried for `RELEASE_ACCEPT_WINDOW` (90 s) | still failing after the window: reported as `STARTUP_NOT_READY` |
| edge routing | transient | maintenance still on, Caddy config invalid, a host block missing or duplicated, API/web/portal not 200 through Caddy |
| Caddy untouched | integrity | the Caddyfile or any site file differs from before the release |

A transient failure that outlasts its window is a genuine failure of this release and rolls it back.
An integrity failure is never retried: waiting does not remove a duplicate payment reference.

## 6. When something goes wrong

Always start with `release.sh status`. It says what to do next. Then the diagnostics bundle at
`deployments/diagnostics/` (redacted: URLs with credentials, API keys, webhook secrets, bearer
tokens, signatures, e-mail addresses, phone numbers and JWTs are masked at the point of writing).

| State | Meaning | Do |
|---|---|---|
| `ROLLED_BACK` | the release failed after changes began and the previous release was restored from local images | nothing urgent. Read the alert/diagnostics, fix, release again. If a migration failed, see below |
| `ABORTED` | stopped before any change (registry, disk, preflight, busy) | nothing changed; fix the cause and run again. Exit 4 means "busy, retry later" |
| `INTERRUPTED` (status), phase shows last completed | the process was killed (SSH, reboot, OOM). If maintenance was on, **it is still on**; nothing is half-written | `release.sh resume` |
| `FIX_FORWARD_REQUIRED` | a breaking migration is applied and the new release cannot run; the old one cannot run on the new schema. Maintenance is **on** | ship a corrected release: `apply <manifest> --fix-forward` (needs an approval); do not roll back |
| `ROLLBACK_FAILED` | the rollback itself failed (e.g. an image is missing). Maintenance is **on** (a deliberate 503) | an operator must act: fix the cause (restore the image from the registry: `docker pull <ref>`), then `release.sh rollback` |
| failed migration, API untouched | Prisma leaves a failed row. It blocks the next release | `RELEASE_APPROVED=true release.sh resolve-migration NAME`, then release the corrected migration |
| maintenance stuck on | a window was left open | `release.sh maintenance off` (refused while a release runs). The monitor reports a window open with no release running |
| lost SSH while releasing | nothing was lost | reconnect; `release.sh status`; it is running or resumable |
| registry unavailable | stops at `stage`, nothing changed. **Rollback never needs the registry** | wait, or deploy images already on the server |
| disk | refused before pulling (exit 4) | free space (`cleanup.sh --apply` removes only images no kept release needs) |

Restore from backup is a separate, deliberate decision (`docs/runbooks/batch2-acceptance-and-batch3.md`
and the PITR procedure); the release records the restore point name in `state.json` for it.

## 6a. The 2026-11-27 incident, and what the tooling does about it

A deployment script was fed to `bash` through a heredoc. A `docker compose exec -T redis ...` inside it forwarded the script's own
standard input to the container and consumed the rest of the script (1,916 bytes). Bash reached end-of-file and exited **0**, with
production still in maintenance. Nothing failed; nothing had finished. The permanent rules (each has a qualification scenario):

1. **Scripts run from files.** `release.sh` and every helper is a file run by path; the installer and the pre-release dump script are
   copied to the server and run by path (`snapshot.sh` is copied into the scheduler with `docker cp`). No `bash -s`, no heredoc piped
   to `docker exec` or `ssh` (`scripts/release/stdin-safety.test.sh` fails the build if one appears).
2. **Standard input is closed** for every command that does not need it (`exec </dev/null` at the top of every entry point; `ssh -n`
   in the workflows). A command that needs input gets it from an explicit redirection.
3. **A premature exit is a failure, whatever its status.** An EXIT guard turns any end of `apply` that is not a recorded final state
   into exit 9, records `premature_exit`, writes an alert and leaves maintenance on. `COMPLETE` is final only with `accepted=true`
   and `deployments/acceptance/<release>.json`, written (and synced) after acceptance passed and before the outcome; the workflow
   poller treats `COMPLETE` without it as a failure.
4. **Recovery is deterministic**: phases are persisted, `status` says INTERRUPTED, `resume` continues at the next phase.
5. **Maintenance survives a Caddy restart** (it is the Caddyfile on disk).
6. **Partial Caddyfile writes cannot strand the edge.** Before any byte of Caddy's configuration changes, a durable record
   (`caddy.record.json`: sha256 of the original and maintenance Caddyfile and school-address site, whose full copies sit beside it)
   is written. A write cannot be atomic (a rename would break the single-file bind mount), so a crash can leave a prefix, and a Caddy
   restart then loads it (a comment-only file is a valid, empty configuration). Every release command first compares the files with
   the record and puts back a whole version; `status` and the monitor report "PARTIAL WRITE".
7. **BetGenius, custom school domains and every other site** are never rewritten and are compared after the release.
8. **Route-group ids**: `caddy adapt` numbers groups (`group0`, `group1`...) across the whole Caddyfile, so changing one site
   renumbers the others. Acceptance compares routing after normalising group ids by first appearance (the structure of who shares a
   group is still compared, so a real change is not hidden), compares the running configuration (admin API) with what the file adapts
   to, and keeps the byte fingerprint as well.
9. **Rollback uses local images only**: the only `docker pull` in the tooling is in staging (a test enforces it).

## 7. Safety properties (each is a qualification scenario)

- Only `api`, `render-worker`, `web`, `portal` and `cbt` are ever stopped or recreated. Never
  PostgreSQL, Redis, the pinned scheduler, the stopped original `ops`, or Caddy (reload only). No
  `down`, no `--remove-orphans`, no `--build`, no prune, no volume operation.
- A release never starts without its rollback images on the server, and rollback never reaches the registry.
- Rollback is refused (fix-forward instead) when a breaking migration is applied.
- The API and worker are never stopped under an active job or a claimed webhook delivery.
- A schema release is impossible without an approval bound to that manifest's hash, and a destructive
  one without the second flag. A different manifest, an expired approval, or an edited manifest is refused.
- Nothing in the journal, the run log, the diagnostics or the alerts can carry a secret.
- Another site on the shared Caddy (BetGenius, a custom school domain) is served throughout and is
  byte-identical afterwards.
- Paid messaging, SMS and WhatsApp provider paths are not touched by any release step; acceptance
  fails if their gates are not `off`.

### Review findings (2026-11-28), and what the tooling does about each

- **Maintenance off by hand is gated.** `release.sh maintenance off` takes the lock, repairs nothing it cannot prove
  is an interrupted write, refuses while any release is unfinished (use `resume` or `rollback`), then runs the same
  internal acceptance a release does (images, protected infrastructure, migrations, money and webhook invariants
  against the last baseline, backups, runtime gates, application health, workers). Only then is ingress opened, and
  the edge is checked; if it does not serve, the window is closed again. A refusal is journaled and alerted.
- **Rollback protects the system first.** Automatic and operator rollbacks close ingress (after route accounting),
  wait for the writers (active jobs, claimed webhook deliveries) and only then stop or replace a container. A stop
  that fails, or leaves the container running, fails the step (`ROLLBACK_FAILED`, exit 7); it is never ignored.
- **Caddy recovery tells an interrupted write from an edit.** The durable record holds checksums of both versions
  and of the saved copies, each live file's inode, and the write intent (direction, pending/done). A file is repaired
  only if the intent is pending, it is the same inode, the container sees that inode, and its bytes are a strict
  prefix of what was being written. Anything else (a hand edit, a replaced file, a tampered copy) is reported
  (`status` says NOT REPAIRABLE AUTOMATICALLY, an alert is written) and **never overwritten**: release, rollback and
  `maintenance off` all refuse until a person resolves it.
- **COMPLETE needs a matching record.** `acceptance/<release>.json` must name the same release id and manifest
  checksum as the state and as the manifest kept for that release. Adopt, NOOP, normal completion, resume, `status`
  (`acceptance.valid` in `--json`), the monitor, cleanup and the poller (which also checks the id and checksum the
  workflow started, `EXPECT_RELEASE_ID`, `EXPECT_MANIFEST_SHA256`) all use the same check. A COMPLETE that does not
  verify reads as INTERRUPTED and `resume` runs acceptance again in full before recording anything.
- **Unreadable Caddy admin configuration fails acceptance.** Only the monitor may report it, separately, as
  DEGRADED verification (exit 0, a `monitor-degraded` alert).
- **Route accounting before maintenance.** `caddy adapt` is read for every route. Hosts the maintenance rewrite closes
  (API, web, portal, the school-address site) and routes that reach nothing of School Kit's pass. A route that
  reaches a School Kit upstream (`api`, `web`, `portal`, `cbt`, `render-worker`, the database, or their loopback
  ports) and is neither closed nor decided is **rejected before anything changes**; so is a site file whose host is
  missing from the adapted configuration or cannot be resolved. A decision is a line in
  `deployments/caddy-route-decisions.conf`: `HOST accept-live REASON` (data on the server, never in code).

## 8. Monitoring and retention

- `monitor.sh` (read-only; exit 1 = needs attention): off-site backup age and WAL archiving, drift from
  the recorded release, webhook backlog/dead letters, disk, maintenance left on, a release half-way,
  money counters against the last baseline, the gates. Run it from cron or systemd every 15 minutes
  and point `deployments/hooks/notify` at whatever delivers alerts; the hook receives the kind and the
  path of a redacted file, never content on the command line.
- `cleanup.sh` is a dry run by default. It removes only School Kit application and migration images no
  kept release needs (default: the newest 3 plus current and previous), diagnostics older than 30 days,
  alerts older than 90, staged manifests older than 30, expired approvals. It never removes volumes,
  containers, other images, the scheduler's image, or the journal.
- Manifests are kept as workflow artifacts for 90 days and on the server for ever (a few KB each).

## 9. Production activation checklist (NOT done; each step is the owner's)

0. Codex's outstanding release is finished and its cutover tool is idle (`release/state` is
   `REOPENED` or absent). This tool refuses otherwise.
1. Review and merge the deployment PR with independent review. Nothing deploys on merge.
2. In GitHub: create environments `production` (no reviewers) and **`production-schema` (required
   reviewer: the owner)**. Confirm secrets `VPS_HOST`, `VPS_SSH_KEY`, `WEB_ENV_FILE`, `PORTAL_ENV_FILE`
   (and `CBT_ENV_FILE`), and optionally `RESEND_API_KEY` + `RELEASE_ALERT_EMAIL`. Set variable `PG_MAJOR=18`.
3. Read the production Caddyfile and compare it with `infra/vps/Caddyfile`: it must contain exactly one
   `{$API_HOST} {`, `{$WEB_HOST} {` and `{$PORTAL_HOST} {` block. If not, fix this before anything else.
3a. List every site file in `sites/` and decide each host that reaches a School Kit upstream (typically
   `cbt.schoolkit.ng`, and any custom school domain proxying to the portal): either it is closed by the maintenance
   rewrite or write `HOST accept-live REASON` in `deployments/caddy-route-decisions.conf`. Without it, a release that
   needs maintenance is refused at preflight (that is the point).
4. Run `release.yml` with action `plan`. This installs the tools on the server and prints the plan;
   it will say `NO_BASELINE`. Nothing else has changed.
5. Build a manifest for **the commit that is running now** and adopt it:
   `release.sh adopt --manifest <it> --extra-file invoice-565.override.yml --extra-file releases/…/candidate.yml`
   (the overlays the operators' `dco` uses today). Adopt verifies the running containers are exactly
   the manifest's digests and the database holds exactly its migrations, then records them.
6. `release.sh status`, `monitor.sh` and `acceptance.sh <manifest> all`: all green.
7. Run `cleanup.sh` (dry run) and read it.
8. Do a first **application-only** release by hand-dispatching `release.yml` with `deploy`, watching it.
9. Rehearse a rollback in a quiet hour: `release.sh rollback`, then `apply` again.
10. Put `monitor.sh` on a timer and a `hooks/notify`.
11. Do a first **additive schema** release the same way before a data/breaking one.
12. Only then consider unattended releases: create `deployments/AUTO_ENABLED` on the server **and**
    uncomment the `workflow_run` block in `release.yml` in a PR of its own. Schema releases still wait
    for the owner either way.

## 10. Re-running the qualification

`scripts/release-qualification/run.sh` (≈ 25 minutes; needs Docker). Also run by the
`release-qualification` workflow whenever the tooling changes. See the evidence document for what each
of the 28 scenarios proves and what it measured.
