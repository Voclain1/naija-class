# Batch 2 acceptance and Batch 3 controlled deployment

Revised 2026-11-26 (supersedes the first revision). Companion to `docs/runbooks/unified-messaging.md`.
**Nothing here authorises a deployment.** `UNIFIED_MESSAGING_CUTOVER_APPROVED` is never set by this work, SMS and paid
messaging stay off, neither PR is merged, nothing was rebooted and PostgreSQL was never restarted.

Evidence labels: **OWNER** (owner-run on production 25–26 Nov, not repeated), **HOSTED** (a GitHub Actions job on an
exact PR #563 head, with the run named), **LOCAL** (fixture tests run by the engineer), **PENDING** (needs an owner action).

## 1. What the independent review found, and what resolved each item

| Review point | Resolution | Evidence |
|---|---|---|
| `docker top -eo args` invocations | none left; every process inspection is `docker top -eo pid,args`, validated (PID/COMMAND header, at least one process, numeric pid on every row) and **fails closed** (inspection failure, malformed or empty output = error, not "no cron") | `ops-tools/lib.sh` `proc_listing`; 6 fail-closed cases in `scripts/ops-tools-test.sh` (LOCAL + HOSTED `tooling`) |
| Suppressed storage/checksum/WAL-G/dry-run errors | nothing is hidden behind `\|\| true`: listing exit codes are checked (only rclone exit 3 = "folder not created yet" is tolerated), checksum, `wal-verify` (integrity AND timeline must say OK), the WAL-G dry run and the prune dry run each fail the run | `ops-tools/retention-inspect.sh` |
| Failed checks must exit non-zero | one `FAILED` flag, `exit "$FAILED"` in every mode, `set -Eeuo pipefail` | `ops-tools-test.sh` |
| Missing / empty / duplicate config; `AWS_REGION`; provider rules | `ops-tools/backup_env.py`: 7 required keys incl. `AWS_REGION`, duplicates, empties, CRLF, quotes, whitespace, R2 endpoint shape, region `auto`, `WALG_S3_PREFIX` bucket = `BACKUP_BUCKET`, heartbeat URL shape. Prints names only | 16 cases `scripts/backup-env-test.sh` |
| Secret lengths / hash prefixes in output | removed everywhere; tests assert no value, length or hex string appears | `backup-env-test.sh`, `ops-tools-test.sh` |
| Heartbeat rotation not recoverable | `rotate-ping` snapshots `backup.env` + override, changes one line, validates, recreates **only** `ops-pinned`; on failure restores byte-for-byte and recreates again, then falls back to the verified local image; never starts the original `ops`. Same for `repin-ops` | `ops-tools-test.sh` (rollback, fallback, total-failure cases) |
| Preserve original stopped `ops` and fallback image | asserted by `guard.sh scheduler` and by the cutover after every phase | rehearsal S1–S4 |
| Retention on isolated fixtures, pinned image, via Actions | job `retention` runs the fixtures **inside the pinned production backup image** (`…@sha256:1c0ac540…`, matrix `production-pinned`) and inside the fresh image (`fresh`) | HOSTED `batch2-images` / `retention` |
| Marker/dump consistency; orphan markers breaking restore selection | `backup.sh` now prunes **pairs by stamp, marker first**, keeps the newest 3 complete pairs whatever their age, never touches other prefixes or unrecognised names, and fails on a listing error. `restore-test.sh` selects the newest **complete** pair, skips and reports incomplete ones, and fails (no silent fallback) on a checksum mismatch | fixtures (below) |
| WAL-G retention on fixtures + non-destructive production inspection | `scripts/batch2-walg-fixture.sh`: real `wal-g` on a throwaway PostgreSQL 18, 9 base backups, dry run deletes nothing, `retain FULL 7 --confirm` keeps exactly 7, the oldest kept base is fetchable, its first WAL is still archived, `wal-verify` OK. Production: `guard.sh retention` (dry run only) | HOSTED `walg-retention` steps |
| Render-worker images | candidate and recovery (`93cc9eeb`) render workers are built, labelled with their commit and pinned by digest; a migration-runner image too | HOSTED `build` |
| Rehearsal must include the worker and real rendering | the rehearsal queues a report-card job and each worker (recovery, then candidate) must produce a `%PDF-` file > 1 kB with an audit row | HOSTED `rehearse` |
| Controlled deployment, generic mechanism stays rehearsal-only | `ops-tools/cutover.sh` is separate; `deploy.sh` and `deploy-vps.yml` are untouched in their guard and the rehearsal asserts `deploy.sh` still refuses | HOSTED `cutover` |
| Reconcile workflow rejects empties and blocks discrepancies | `backup-config-reconcile` fails on any empty/missing required value, duplicate, provider violation or difference | HOSTED (it **fails today**, correctly, see §4) |
| Tablet-operable owner procedure | `guard.sh owner-session`: one guided run, hidden prompts, no downloads (CI ships the tools) | §3 |
| Also found: `db-restore-test.yml` was scheduled and targeted the original, now stopped `ops` | manual-only with a typed confirmation, targets `ops-pinned` | diff |
| Also found: documented guards that do not exist | `BACKUP_ENV_FILE` key check and `UNIFIED_MESSAGING_CUTOVER_APPROVED` now **exist**: the first in the validator, the second as a mandatory per-command export in `cutover.sh` | rehearsal S0 |
| Also found: deploy workflow overwrote the server's `backup.env` from the secret | the ship step keeps a server's file and uses the secret only to bootstrap an empty server | `deploy-vps.yml` |

## 2. Engineering acceptance matrix and release images

The final matrix, the immutable references for the exact head, and every run link are in the delivery message of this
session and in the `batch2-images` run summary of the final head (the **release manifest** block). The same manifest is
written to the VPS as `release/manifest.proposed` **only if every hosted rehearsal for that head passed**.

## 3. Owner procedure: one Termius session (Android tablet)

Nothing is downloaded and nothing is typed except hidden values. CI has already put the tools on the server:
`/opt/school-kit/ops-tools` (check that `cat HEAD_SHA` there is the PR head you approved).

**Before you start (browser on the tablet, two minutes)**
1. Healthchecks.io → *Add check*: same name pattern, schedule `30 1 * * *` UTC, grace about 2 h, same email channel. Copy its ping URL (long-press → copy). **Leave the old check running.** (The old URL was disclosed; rotating removes the risk that anyone can fake a success.)
2. GitHub → Settings → Developer settings → *Fine-grained tokens* → new token: **only** `Voclain1/naija-class`, permission *Secrets: Read and write*, expires in 1 day. Copy it.

**In Termius (one session)**
```
sudo apt-get install -y python3-nacl      # once; skip if already installed
cd /opt/school-kit/ops-tools && sha256sum -c SHA256SUMS && cat HEAD_SHA
bash /opt/school-kit/ops-tools/guard.sh owner-session
```
It runs, stopping at the first failure: config + scheduler + retention inspections → (if the manifest names a different
backup image) `REPIN` → `YES` to rotate the heartbeat (paste the new URL; hidden) → validation → paste the GitHub token
(hidden) to make the `BACKUP_ENV_FILE` secret equal the running file. Paste with a long-press; nothing is echoed.
Every failure path rolls back by itself and tells you; the original `ops` container is never started.

**Afterwards**: revoke the GitHub token; in GitHub → PR #563 → Checks → `backup-config-reconcile` → *Re-run all jobs*: it must
say `identical`; next morning confirm the **new** Healthchecks check went green after 01:30 UTC, then pause the old one;
optionally create a throw-away check with a 1-minute period and 1-minute grace on the same email channel, ping it once,
wait, and confirm the "down" email (that proves the email path only).

## 4. Facts from the first hosted reconcile run (key names only, no values)
The running `backup.env` has 8 keys and the GitHub secret 7. The only difference is `HEALTHCHECK_PING_URL`, present only on
the server. Seven keys are identical; nothing exists only in GitHub. All required keys, including `AWS_REGION`, passed
validation on the server. So replacing the secret from the server file loses nothing, and, since the deploy workflow no
longer overwrites a server's file, a future deploy cannot delete the heartbeat either.

## 5. Batch 3 — the controlled cutover (`ops-tools/cutover.sh`)

Why a separate procedure: `deploy.sh` runs `compose up -d --build --remove-orphans` (it would remove `ops-pinned`,
start the stopped original `ops` and rebuild PostgreSQL) and `deploy-vps.yml` migrates *before* draining; both stay
rehearsal-only. The cutover names only `api` and `render-worker`, always with `--no-deps --no-build --pull never`.

**Preconditions (all must be true)**
1. Hosted CI for the exact head is green, including `retention`, `walg-retention`, `rehearse`, `cutover` and `tooling`; the release manifest was proposed to the VPS by CI (it only does so after those pass).
2. §3 done: `ops-pinned` runs the manifest's backup image; heartbeat rotated; secret reconciled.
3. Owner approval recorded; window outside 01:00–02:30 UTC (suggest 03:00 UTC); schools told; `VPS_DEPLOY_ENABLED=false`.
4. `PAYSTACK_WEBHOOK_LEGACY_REVIEW_BY` (2026-12-09) is still in the future (the gate checks it). SMS/paid messaging keys are `off` in `api.env` (the gate checks all four).

**Commands (Termius; each prints PASS/FAIL lines, stops on the first failure)**
```
cd /opt/school-kit
bash ops-tools/cutover.sh stage        # shows the proposed head; type its first 12 characters; pulls every image BY DIGEST; checks revision labels
bash ops-tools/cutover.sh verify       # read-only gates: PG major, backup config, scheduler, images, api.env gates, disk, Caddy block
bash ops-tools/cutover.sh authorize    # type: I AUTHORISE THE BATCH 3 CUTOVER   (binds head + manifest hash, 4 h)
UNIFIED_MESSAGING_CUTOVER_APPROVED=true bash ops-tools/cutover.sh execute
```
`execute` does, in order, and re-checks PostgreSQL identity, `ops-pinned` and the stopped original `ops` after every phase:
1. gates (any failure: exit 10, nothing changed);
2. pre-migration snapshot: `pg_dump` → object store `dumps/pre-batch3/` (never pruned) with read-back checksum, plus a named WAL restore point (no heartbeat is sent);
3. **maintenance**: API host answers **HTTP 503 + `Retry-After`** on every path including the Paystack webhook (Caddy validated, reloaded in place, then verified from the edge);
4. **drain**: wait, require zero active BullMQ jobs, stop old `api` and `render-worker`;
5. **migrate** with the immutable migration image (`status`, then `deploy`), verify no unresolved migration, `allocated_kobo`, FORCE RLS on the inbox, `app_user` not superuser/bypassrls;
6. start the **candidate** by digest (paid messaging/SMS gates already `off`), health of API and worker;
7. financial gate (no duplicate references, no allocation above its amount, migrations OK); reopen ingress; edge answers 200.

**Failure paths (all rehearsed on isolated infrastructure)**
- *Gates fail* → exit 10, nothing touched.
- *Migration fails* → exit 20; ingress **stays 503**, old app stays stopped, nothing started. Nothing was written since the restore point. Fix the cause, `resolve-migration`, `execute --resume`; or restore with the owner's engineer.
- *Candidate unhealthy* → exit 30; ingress stays 503; candidate stopped; **the pre-allocation image is never started**. Run `recover`.
- `recover` starts the **allocation-compatible recovery release** (`93cc9eeb`, API + worker by digest) with ingress still closed, runs the financial gate, and leaves the decision to you; `reopen` gives traffic back. Replay or dead-letter handling goes through the audited endpoint; never restore a pre-cutover snapshot over newer transactions.

**The no-return rule.** After ingress reopens, `61b5c214` (or any image that sums gross payment amounts) must never receive finance writes again. `cutover.sh` has no mode that starts it, the release override is included in every later compose command through the tooling (`guard.sh release` fails if the running application is not the pinned release), and `APP_TAG` in `deploy.env` is deliberately not relied on.

**Post-deployment acceptance (each evidenced, none inferred)**: health and `app_user` role; first signed Paystack delivery (legacy HMAC) is accepted once and processed once; a partial payment allocates, issues one receipt and keeps gross/allocated totals; Resend delivered events for receipts; manual WhatsApp share link opens; zero SMS/paid-messaging provider activity; `guard.sh scheduler` and `release` pass; next 01:30 UTC run produces dump + marker, base backup and the **new** heartbeat; archiver failing = false; inbox dead-letter 0 for 24 h. **No live test payment without separate owner authorisation.** Then, and only then, the owner may merge #563; #564 follows (never before).

## 6. What remains genuinely open
See the delivery message: items that need production, a provider or an owner decision, which no code or hosted job can establish.
