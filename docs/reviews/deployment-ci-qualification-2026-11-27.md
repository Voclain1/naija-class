# Release qualification evidence: 2026-11-27

What was run, how failures were injected, what it found, and what it does **not** prove. The
procedure is `scripts/release-qualification/run.sh`; the `release-qualification` workflow runs it
whenever the tooling changes, weekly, and on demand. Raw logs for every scenario are the workflow's
`qualification-evidence` artifact.

## 1. The environment

| Part | Real or stand-in |
|---|---|
| PostgreSQL 18.7 (`postgres:18-alpine`) | **real** |
| Redis 7.4 (`redis:7.4-alpine`), BullMQ-style `bull:*:active` lists | **real** |
| Caddy 2.10.2 with **the repository's own `infra/vps/Caddyfile`**, plus a BetGenius site and a custom school domain as separate site files | **real** |
| Docker Compose project with the same service names, restart policies and loopback ports as `infra/vps/docker-compose.yml`, including the `ops-pinned` override and the stopped original `ops` | **real**, a twin of production's shape |
| Image registry (`registry:2` on localhost:5000): every image has a real `@sha256` digest, and the registry can really be stopped | **real** |
| Backup scheduler: a PostgreSQL 18 client image with real `pg_dump`, `pg_restore` and `crond`; `rclone` is a file-backed stand-in | real tools, stand-in object store |
| Migration runner: records `_prisma_migrations` rows the way Prisma does (SHA-256 of `migration.sql`; a failing migration leaves `finished_at` NULL) | stand-in with the real contract |
| Application images (api, render worker, web, portal) | **stand-ins** (a tiny HTTP server with the real health paths; behaviours `good`, `slow`, `unhealthy`, `crash` are baked in, so a bad release is a different digest) |
| Money tables | fictional, with the column names the acceptance queries read |

No real school, parent, payment, message, provider or credential is involved; every secret in the
fixtures is a fictional literal and the harness asserts none leaks into logs.

## 2. How faults are injected

By real means wherever one exists: `kill -9` of the release process at a recorded phase; killing the
launching session; `docker stop` of the registry; `docker restart` of Caddy and of Redis; `docker rmi`
of an image after its container was replaced; real rows in `paystack_webhook_inbox` and real `LPUSH`
into a BullMQ active list; real SQL that makes a migration fail; a real stand-in image that cannot
start; one that boots and never becomes healthy. Four faults have no safe real equivalent in a shared
sandbox and are switched on only under `RELEASE_QUALIFICATION=1` (no production path sets it): a
corrupted override file, a truncated maintenance Caddyfile, a pause at a phase boundary, and pretending
a rollback image is absent at the start of a release. Disk exhaustion is exercised through the
release's free-space floor, not by filling a disk.

## 3. Results

Final run on the code in this pull request, 2026-11-27 (PostgreSQL 18.7, Caddy 2.10.2, Docker Compose,
local registry):

| Scenario | What | Result | Time |
|---|---|---|---|
| s01 | application-only release: scoped, maintenance-free, no protected restarts | PASS | 75s |
| s02 | additive schema release: approval gate, no maintenance, checksum recorded | PASS | 79s |
| s03 | data-migration release: persistent maintenance, verified dump, other sites untouched | PASS | 69s |
| s04 | interrupted deployment (SIGKILL): durable state, closed ingress, resume | PASS | 185s |
| s05 | SSH connection loss: detached release survives; hung-up release resumes | PASS | 118s |
| s06 | Caddy restart during maintenance: maintenance persists | PASS | 74s |
| s07 | partial configuration writes: corrupt override and truncated Caddyfile | PASS | 55s |
| s08 | registry unavailable: stops before any change | PASS | 71s |
| s09 | failed application startup: automatic local rollback with the registry down; redacted diagnostics | PASS | 97s |
| s10 | failed front-end readiness: whole release rolled back | PASS | 105s |
| s11 | failed migration: unresolved-migration gate, resolve, corrected release | PASS | 92s |
| s12 | concurrent deployments: one runs, the other is refused | PASS | 63s |
| s13 | pending webhook deliveries: claimed holds, stale backlog blocks, nothing lost | PASS | 86s |
| s14 | active background jobs: never stopped mid-job | PASS | 73s |
| s15 | insufficient disk: refused before pulling or changing anything | PASS | 29s |
| s16 | failed rollback: maintenance on, operator alert, operator recovery | PASS | 103s |
| s17 | protected infrastructure changed mid-release: stop safely | PASS | 84s |
| s18 | breaking migration + failed start: fix-forward, never an unsafe rollback | PASS | 117s |
| s19 | transient startup, automation switches, cutover exclusion | PASS | 167s |
| s20 | automated acceptance: every genuine failure class is detected | PASS | 136s |
| s21 | cleanup and monitor | PASS | 110s |
| s22 | scoped build: only the changed unit is restarted; unchanged units keep digest and commit | PASS | 53s |
| s23 | tool installer: verified, atomic, never under a running release | PASS | 4s |

**23 of 23 scenarios passed; 231 individual checks passed, 0 failed.** The wall time of a scenario
includes building a fresh stack and, for the faulted ones, waiting out the timeouts the scenario sets.

## 4. What the qualification found (and what was done)

The first complete run passed 15 of 21 scenarios. The six failures were not noise. They were real
defects, found by running the failure paths against real infrastructure, and all are fixed and proved
by the table above.

| # | Found by | Defect | Fix |
|---|---|---|---|
| 1 | s07 | **A truncated maintenance Caddyfile was accepted.** A file holding only a comment is a valid Caddyfile, so `caddy validate` passed, Caddy loaded an empty configuration and the edge served nothing. The release noticed the edge was not answering 503 but returned without restoring the original; the "rolled back" release left the site dark | The generated file must equal exactly what the rewriter would produce from the original (`maintenance-verify`); the bytes written are compared with `cmp`; every failure after the edge changed restores the original; **rollback itself now restores and proves the edge** (Caddy routing through the real proxy, every site file byte-identical) |
| 2 | s11 | After a failed additive migration the rollback was correct, but post-rollback acceptance counted the failed (unfinished) row as "database ahead of release" and declared ROLLBACK_FAILED | A failed row is unresolved, not applied: it blocks the *next* release until `resolve-migration`, and no longer makes the database "ahead" |
| 3 | s17 | After a *successful* data migration followed by a safe rollback, acceptance judged the database against the old manifest, which does not know the migration, and declared ROLLBACK_FAILED | Rollback acceptance classifies the extra migrations from the failed release's manifest (the compatibility the rollback check had just proved) |
| 4 | s18 | **A fix-forward could not start.** Preflight treated the maintenance window left on deliberately as a stale one, checked drift against a recorded release that by definition is not running, and fingerprinted the Caddy files while they were in maintenance (so they could never match after reopening) | A fix-forward skips the drift and API-gate checks until after the switch (acceptance runs them in full), accepts its own maintenance window, and fingerprints the *original* files |
| 5 | s11 (a regression of mine, introduced while fixing 1-3) | A `grep` with no match under `errexit` + `pipefail` ended the failure handler silently and left the state half-way | `|| true`; the failure handler is now covered by every failure scenario |
| 6 | s16 | `release.sh rollback` after ROLLBACK_FAILED targeted "previous" instead of restoring the current release | In ROLLBACK_FAILED the target is the release that was running |
| 7 | s17 | An alert said a release stopped but not why | Alerts carry the last problem recorded |
| 8 | harness | The migration stand-in did not honour the real image's `migrate <command>` entry; the harness overrode the disk floor it was testing; one scenario compared against an older manifest; Docker will not delete an image a running container uses, so "rollback image missing" can only happen after the old container is replaced | Fixed; the scenarios now remove the image at that moment, for real |

The 56 unit tests in `infra/vps/release/test_release_tool.py` cover the classifier, manifest
validation, planning, rollback compatibility, scoped builds, redaction and the Caddy rewriter,
including the truncation case from #1.

## 5. Measured behaviour

Measured on the final run (a laptop-class sandbox with four cores; the real VPS and real images will
differ, so read these as shape, not promise):

| What | Measured |
|---|---|
| Application-only release, all four services, start of staging to "live" including acceptance and the money checks | **44 s** (scenario s01) |
| Edge availability during that release (a probe every ~0.25 s on the web app and on the API, through Caddy) | web: 0 failed of 207 samples. API: 0 failed of 207 samples (a sub-second recreate can fall between samples) |
| Edge availability during an additive schema release (API probed) | 6 failed of 235 samples; **longest gap 1.3 s**, the API container's stop and recreate (s02) |
| A release whose API cannot start: from switching to the previous release serving again | health wait 48 s (the scenario's own limit) + **20 s** to roll back and re-verify from local images (s09, with the registry down) |
| A release whose front end boots but never becomes ready: switch to restored | 52 s wait + **26 s** rollback of API, worker and web (s10) |
| Maintenance window (data migration) | ingress closed, API and worker stopped, off-site dump written, read back and checksum-verified, migration, switch, acceptance, ingress reopened; the API host answered 503 with `Retry-After: 120` and BetGenius and the custom school domain answered 200 throughout (s03) |
| Interrupted at a phase boundary with `kill -9`, then `resume` | state shows the last completed phase; ingress stayed closed across the crash; resume finished the release and applied the migration exactly once (s04) |
| A corrupt override or a truncated maintenance Caddyfile | refused before use; the live `release.override.yml` and the Caddyfile are byte-identical to before and the edge keeps serving (s07) |
| Time to detect each integrity failure (duplicate Paystack reference, over-allocation, invoice/instalment mismatch, webhook backlog, new dead letter) with a 20 s startup window configured | each under 15 s: integrity checks are not retried (s20) |

## 6. What this does not prove

- **The real application images.** Start-up (migrations at boot, queue connections, graceful shutdown
  inside the 60 s stop grace) is exercised only by the first real release. The stand-ins prove the
  orchestration, not the application.
- **The production Caddyfile.** The tool refuses unless it finds exactly the three School Kit host
  blocks; whether the server's file has them has not been read (activation checklist step 3).
- **The production object store.** `rclone` was a file-backed stand-in; the real dump and read-back
  path is the one `cutover.sh` already uses, but it was not run here.
- **The GitHub workflows end to end.** They need the production secrets and a host. Their logic is in
  tested scripts (`poll-release.sh`, `service-inputs.sh`, `release_tool.py`, `install.sh`); the YAML is
  parsed and linted but unproven until the first manual dispatch.
- **Timing at scale.** One school-sized database. A large `pg_dump` window, and `lock_timeout` behaviour
  under production write load, are not measured.
- **Classification of future migrations.** The classifier is a heuristic over SQL text and is
  deliberately strict (anything it cannot place is `breaking`), but a migration it calls `additive`
  could still surprise an older release. The approval gate and the restore point are the backstop.
