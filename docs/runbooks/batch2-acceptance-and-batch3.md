# Batch 2 acceptance and Batch 3 controlled deployment

Status: written 2026-11-26 against PR #563 head `fa74b19a041698278c271e8e1e41ef95c2307104`.
Companion to `docs/runbooks/unified-messaging.md` (read its "First production cutover" and
"Batch 2 recovery and backup gates" first). **Nothing here authorises a deployment.**
`UNIFIED_MESSAGING_CUTOVER_APPROVED` stays unset, SMS and paid messaging stay off, neither PR is merged.

Evidence labels: **VERIFIED-OWNER** (owner-run on production, reported 25–26 Nov, not re-run),
**VERIFIED-HERE** (run or read by the engineer in this session, with the limits stated),
**PREPARED** (artefact exists, not yet executed), **PENDING** (needs an owner action), **BLOCKED**.

## 1. Batch 2 acceptance matrix

| # | Requirement | Status | Evidence / gap |
|---|---|---|---|
| A1 | Local dump backup + isolated restore | VERIFIED-OWNER | 2.2 MB dump restored in PG 18 / pgvector 0.8.7, 25 Nov |
| A2 | R2 off-site backup, independent checksum, isolated restore | VERIFIED-OWNER | |
| A3 | WAL-G base backup + archived WAL retrieval | VERIFIED-OWNER | |
| A4 | PITR to a named marker | VERIFIED-OWNER | `batch2-backup-recovery.sh activate` |
| A5 | Digest-pinned scheduler, original ops retained, PG identity unchanged | VERIFIED-OWNER | digest `sha256:1c0ac540…429d` |
| A6 | First scheduled nightly (26 Nov 01:30 UTC): dump, marker, base backup, heartbeat, email channel | VERIFIED-OWNER | dump 2,255,306 B; two remote bases |
| A7 | Migration history 172 applied / 1 rolled back / 0 unresolved | VERIFIED-OWNER | |
| A8 | Exact-head CI on `fa74b19` | VERIFIED-HERE | all 9 check runs `success` (build, rehearse, lint+typecheck+test+build, PostgreSQL backup image, e2e, candidate-config, reconcile-production-config, live-metadata, PR title) via the GitHub API. Hosted financial recovery rehearsal = job `rehearse`, success |
| B1 | Retention — daily 15 d / weekly 57 d dump logic | VERIFIED-HERE (fixture) | `scripts/batch2-retention-fixture.sh`: real `prune` text from `backup.sh` against a local rclone **v1.60.1** (the pinned v1.76.0 download was blocked from this sandbox; semantics of `delete --min-age` unchanged but not proven on 1.76.0 or on R2). Passed: nothing >15 d/>57 d survives, newest pair kept, `pre-batch3/` prefix never pruned, missing folder not an error |
| B2 | Marker ↔ dump consistency | VERIFIED-HERE (fixture) + PENDING (prod) | No dump without marker. **Finding:** at the 15/57-day boundary a marker can outlive its dump by up to one night (dump is older than the marker). Cosmetic: `restore-test.sh`/`verify-night` use the newest marker. Production read: `batch2-guard.sh retention` |
| B3 | Heartbeat only after complete success | VERIFIED-HERE (fixture) | real `backup.sh` with stubs: success ⇒ 1 ping; WAL-G failure, read-back mismatch, tiny dump ⇒ non-zero exit, 0 pings |
| B4 | WAL-G `retain FULL 7` | PENDING (prod, non-destructive) | `batch2-guard.sh retention` runs `wal-g delete retain FULL 7` **without `--confirm`** (dry run) plus `wal-verify integrity timeline`. Not exercised with real fixtures here: no WAL-G binary or PG available in the sandbox. Two bases exist, so nothing can be deleted until the 8th |
| C1 | Missed-heartbeat email test (separate check) | PREPARED / PENDING | §2 |
| C2 | Ping-URL rotation | PREPARED / PENDING | §2. The URL was exposed in conversation: treat as disclosed |
| D1 | `backup.env` ↔ `BACKUP_ENV_FILE` reconciliation | PREPARED / PENDING | §3. Cannot be done from here: secrets are write-only and the VPS is unreachable |
| E1 | Scheduler survives later deployments | FINDINGS + PREPARED | §4. Today it survives only because every automated live path is disabled |
| F1 | Batch 3 procedure | PREPARED, **unrehearsed** | §5 |

**Batch 2 is not fully accepted.** Pending: B2/B4 production reads, C1, C2, D1, and the Sunday 29 Nov
weekly dump (first `weekly/` publish, 01:30 UTC; observe, do not force).

## 2. Monitoring

**Missed-heartbeat test (never touches the production check)**
1. Healthchecks.io → new check `schoolkit-alert-test`, period 1 min, grace 1 min, same email integration.
2. From your laptop, once: `curl -fsS -m 10 "$TEST_URL"` (the test URL only; do not paste it anywhere shared).
3. Stop. After ~2–3 min the check goes *down* and the email must arrive. Record the email timestamp and the check's event log.
4. Optionally ping once more to see the recovery email, then delete the test check.
Proves only the notification path. It does not prove that a failed backup stays silent — that is B3 (fixture).

**Rotate the production ping URL (recommended; it has been exposed)**
Anyone holding it can send a false "success" and hide a failed backup. UUID ping URLs cannot be regenerated, so:
1. Create a new check, same schedule (`30 1 * * *` UTC) and a grace of ~2 h, same email channel. Do not pause the old one yet.
2. In Termius on the VPS: `bash /opt/school-kit/batch2-guard.sh rotate-ping` — hidden prompt, validates `https://hc-ping.com/<uuid>`,
   keeps a 0600 copy in `config-backups/`, changes only that line, recreates **only** `ops-pinned` (the env file is read at container
   creation, so a restart alone would not apply it), refuses inside 01:00–02:30 UTC or while a backup runs, and confirms PostgreSQL is untouched.
3. Update GitHub with the same value without displaying it (§3 step 4).
4. After the 01:30 UTC run confirm the **new** check is green; then pause/delete the old check.
Residual: the `postgres` container also loads `backup.env` and keeps the old URL in its environment until it is next recreated
(not now). After step 4 that URL is dead, so it is harmless.

## 3. Configuration reconciliation (`backup.env` ↔ `BACKUP_ENV_FILE`)

Why it matters: `deploy-vps.yml` writes `backup.env` from the secret (`printf '%s\n' "$BACKUP_ENV_FILE" > out/backup.env`, then tars it over
`/opt/school-kit`). Anything set only on the VPS (e.g. `HEALTHCHECK_PING_URL`) would be lost by the next ship step. The runbook
sentence claiming a required-key check exists was **wrong at this head**: no workflow checks `BACKUP_ENV_FILE` key names (corrected in
`unified-messaging.md`). The workflow is currently rehearsal-only, so this is latent, not live.

1. **Inventory on the VPS** (redacted: names, lengths, mode, duplicates, CRLF, literal quotes): `bash batch2-guard.sh config`.
   Verified here against a fictional file: no value is printed and a duplicate key is detected.
2. **Compare with GitHub** — run `.github/workflows/backup-config-reconcile.yml` (PREPARED; it is gated to PR #563 like the Batch 1
   job, so it must be added to the PR branch, which changes the PR head and requires fresh exact-head CI — your decision, I did not push
   to that branch). It copies the secret to a 0600 file on the VPS, makes protected copies of both files, and prints only
   *only-on-VPS / only-in-GitHub / different-value* **key names** and required-key presence. Fixture-tested here.
3. Decide from the output. Expected: GitHub ⊆ VPS. If any key is **only in GitHub**, stop and merge it by hand first.
4. **Make GitHub match the VPS without displaying anything**, from a trusted laptop that is logged in to `gh`:
   `ssh deploy@<vps> 'cat /opt/school-kit/backup.env' | gh secret set BACKUP_ENV_FILE --repo Voclain1/naija-class`
   The previous secret value cannot be read back, so step 2's key list is the only record of it — do not skip it.
5. **Verify**: re-run the workflow; accept only "identical" with zero differing keys. Then `batch2-guard.sh config` again (mode 0600, no duplicates).
6. **Do not rotate the R2 access key casually**: the running `postgres` container holds its `WALG_*`/`AWS_*` values from creation and its
   `archive_command` keeps using them. Changing keys without a planned PostgreSQL restart makes archiving fail and WAL pile up on disk.

## 4. Scheduler persistence — review result

Reviewed: `deploy.sh`, `lib.sh`, `deploy-vps.yml`, `docker-compose.yml`, `docker-compose.rehearsal.yml`, `batch2-backup-recovery.sh`.

| Finding | Effect | Control |
|---|---|---|
| `deploy.sh` runs `compose up -d --build --remove-orphans` with `docker-compose.yml` only | would remove `ops-pinned` (not in that file), **start the stopped original `ops`** (two schedulers), and rebuild/recreate `postgres` (the Dockerfile changed in this PR) | `deploy.sh` and `deploy-vps.yml` now refuse anything but `VPS_MODE=rehearsal`. **Verified by reading; never lift the guard.** `batch2-guard.sh scheduler` fails if `deploy.env` says rehearsal on this host |
| Ship step writes `PG_MAJOR=${{ vars.PG_MAJOR \|\| '16' }}` | production is PG 18; a 16 default would point a PG 16 image at an 18 data directory | Batch 3 uses explicit service lists, never that step; `deploy-preflight` fails unless `PG_MAJOR=18` |
| Ship step tars `infra/vps` over `/opt/school-kit` | does **not** overwrite `backup-ops.override.yml` or `.batch2-postgres-identity` (not in the repo) | keep both files; never `rm -rf` the directory |
| `ops-pinned` inherits `restart: unless-stopped`; original `ops` was set to `no` and stopped | survives a VPS reboot, original does not return | `scheduler` mode checks both policies and that only one `cron` runs |
| Retained images | `deploy.sh` and the workflow no longer prune images | `scheduler` mode checks the pinned digest and `schoolkit-ops-fallback:batch2-verified` exist; never run `docker image prune -a` / `system prune` |

**Rules for every Batch 3 compose command**: always `--env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml`; always
name services; always `--no-deps --no-build --pull never`; never `up -d` bare, `--remove-orphans`, `down`, `-v`, `--build`, or
anything naming `postgres`, `redis`, `ops` or `ops-pinned`. Evidence of behaviour on a real reboot or real deploy: **none yet** (reasoned from config).

## 5. Batch 3 — controlled production deployment plan (unrehearsed)

### 5.1 Blockers that must clear before any window
1. **No pinned render-worker image.** `batch2-images` publishes only API candidate, API recovery and the backup image. Compose runs
   `school-kit-render` from `apps/api/Dockerfile.render` at the same tag. A worker must be built and pinned for **both** the candidate and
   the recovery source `93cc9eeb…`, and the recovery pair rehearsed together. Until then recovery is not demonstrated end to end.
2. **Candidate and recovery API digests are not recorded here.** The job log masks them; the `batch2-image-digests` artifact
   (run 45696019198) must be read by the owner and the two digests written into the window record.
3. **Documented `UNIFIED_MESSAGING_CUTOVER_APPROVED` guard does not exist in code** (no script or workflow reads it). The control is
   therefore procedural: the generic workflow is rehearsal-only, `VPS_DEPLOY_ENABLED=false`, and this plan has no automated step.
4. **Paystack legacy review date 2026-12-09** (`PAYSTACK_WEBHOOK_LEGACY_REVIEW_BY`) gates preflight. If the window slips past it,
   re-authorise explicitly and re-run `candidate-config`.
5. **Migration runner not proven for this path.** 33 migration directories exist on the candidate that the baseline `61b5c214` lacks
   (206 vs 173; confirm with `prisma migrate status`). The proven runner is the exact-head checkout + SSH tunnel + `prisma migrate deploy`
   as `school_kit` (the old workflow step). The API image does not obviously contain the Prisma CLI (not verified).
6. Live provider facts still unverified: real signed Paystack delivery (legacy HMAC) to the VPS, Termii capacity/DND rates, Resend delivery.
7. Hosted rehearsal proves the fictional-data recovery path; no rehearsal exists of **this** maintenance/Caddy/drain procedure.

### 5.2 Release inputs (record in the window journal)
exact head SHA and 9 green checks · candidate API digest · candidate worker digest · recovery API + worker digests (from `93cc9eeb`) ·
backup digest `1c0ac540…` (already running) · current API tag (`61b5c214…`, confirm with `docker inspect`) · PG 18 · applied-migration count.
Reference every image by `@sha256:`, never by tag.

### 5.3 Pre-window (T-7 … T-1 days) — read-only
- `batch2-guard.sh scheduler`, `retention`, `config`, `deploy-preflight` all PASS; Sunday 29 Nov weekly dump observed.
- Section 2 and 3 done (rotated check green, secrets reconciled). Candidate `api.env` prepared via `scripts/prepare-messaging-api-env.mjs`
  and checked by `check-messaging-cutover.mjs` with: `PAYSTACK_WEBHOOK_MODE=live`, `…REQUIRE_MODERN=off`, `…LEGACY_REVIEW_BY=2026-12-09`,
  `MESSAGING_LEGACY_SMS_MIGRATION_MODE=off`, `MESSAGING_LEGACY_SMS_ENABLED=off`, `MESSAGING_TERMII_REPORTS_ENABLED=off`, `MESSAGING_PAID_ENABLED=off`.
- Schools told; window outside 00:45–02:30 UTC (suggest 03:00 UTC = 04:00 Lagos). `VPS_DEPLOY_ENABLED=false`; Fly auto-deploy disabled.
- Owner sign-off recorded. **Only at this point** does the owner decide whether to set `UNIFIED_MESSAGING_CUTOVER_APPROVED`; this session leaves it unset.

### 5.4 Window (single guarded Termius session; stop on any FAIL)
Use `tmux` and `script -q /opt/school-kit/config-backups/batch3-$(date -u +%Y%m%dT%H%MZ).log`. Never `set -x`; never `cat` an env file.

1. **Gate**: `batch2-guard.sh deploy-preflight` (must be PASS; PG identity recorded) and a read-only count of `payments` rows not in a final state (the pending-reference journal).
2. **Safety snapshot (not `backup.sh`; no heartbeat is sent)**: `pg_dump -Fc` inside `ops-pinned` to a 0700 scratch dir → `pg_restore --list` →
   sha256 → `rclone copyto` to `dumps/pre-batch3/` (a prefix retention never touches) → read-back checksum.
   Then `SELECT pg_create_restore_point('batch3_pre_migration_<UTC>'); SELECT pg_switch_wal();` and record the LSN.
3. **Close ingress with a retryable 503**: keep a copy of `Caddyfile`; replace only the `{$API_HOST}` block with
   `header Retry-After "120"` + `respond "Maintenance in progress" 503`; `compose exec -T caddy caddy reload` (graceful).
   Verify **from outside** (not localhost): `curl -sS -o /dev/null -w '%{http_code}' https://$API_HOST/api/v1/payments/paystack/webhook` = 503 and `/api/v1/health` = 503.
   Web and portal shells stay up (their API calls fail visibly). Paystack retries non-2xx webhooks (confirm retry schedule in its dashboard docs); no synthetic success is ever returned.
4. **Drain**: wait until BullMQ `active` counts are 0 (`redis-cli --scan --pattern 'bull:*:active'` then `LLEN`/`ZCARD` each) and no API request is mid-flight in `docker logs --since 2m`;
   then `compose … stop api render-worker`. Keep `postgres`, `redis`, `ops-pinned`, `caddy` running. Confirm both containers exited.
5. **Migrate** (old binaries are down; maintenance holds): from the exact-head checkout through the SSH tunnel, `prisma migrate status` (expect ~33 pending, 0 failed),
   then `prisma migrate deploy` as `school_kit`. Verify: 0 unresolved, `payments.allocated_kobo` exists, `paystack_webhook_inbox` has FORCE RLS,
   runtime role `app_user` has no SUPERUSER/BYPASSRLS. **If any migration fails: stay in maintenance.** Because ingress was closed and both
   old services stopped, nothing was written since step 2, so the pre-migration marker is a loss-free restore point *at this stage only*.
6. **Start the candidate with paid gates off**: write `batch3-candidate.override.yml` (image `@sha256:` for `api` and `render-worker`; `api.env` already carries the seven off/legacy values) and run
   `docker compose --env-file deploy.env -f docker-compose.yml -f backup-ops.override.yml -f batch3-candidate.override.yml up -d --no-deps --no-build --pull never api render-worker`.
   Ingress is still 503. Check on `127.0.0.1`: health, `app_user` role, `SCHEDULED_JOBS` behaviour as intended, logs free of RLS/permission errors, no outbound SMS (all `MESSAGING_*` gates off). `batch2-guard.sh scheduler` still PASS and the PG start time unchanged.
7. **Reopen ingress**: restore the saved `Caddyfile`, reload, verify 200 from outside.

### 5.5 Rollback and the no-return rule
- **Before step 7** (ingress closed, nothing written): stop candidate, restore from the marker only if migrations failed halfway.
- **After step 7: `61b5c214` is never again a finance-write target.** It sums gross amounts and corrupts balances once any payment records `allocated_kobo ≠ amount`
  (fixture: ₦40 allocated + ₦70 unapplied read as ₦110). Never restore a pre-cutover snapshot over newer transactions.
- Recovery = stop candidate workers first → 503 ingress → keep every table and inbox row → start the **allocation-compatible recovery** API **and** worker by digest
  (blocker 5.1-1) → drain/replay the inbox through the audited endpoint → verify one financial effect and one receipt per event. If any doubt, stay in maintenance and fix forward.
- Do not use `deploy.sh`, `deploy-vps.yml`, `docker image prune`, or any command in the §4 forbidden list during a rollback.

### 5.6 Post-deployment acceptance (all must be evidenced, none inferred)
| Check | How | Pass |
|---|---|---|
| Health, DB role | `/api/v1/health`; `SELECT current_user, rolsuper, rolbypassrls` | healthy; `app_user`, both false |
| Webhook path | owner-authorised signed Paystack event (legacy HMAC) or first real payment; **no live test payment without separate authorisation** | event in inbox, processed once |
| Collection and partial payments | read-only SQL: for each new payment `allocated_kobo ≤ amount`, invoice balance = Σ allocated | zero mismatches |
| Receipts | successful allocated payments have a receipt number; zero-allocation ones do not (`live-metadata` queries) | zero violations |
| Idempotency | duplicate-reference groups = 0; inbox dead-letter = 0 | |
| Email | Resend delivered/bounced webhook events for the new receipts | delivered |
| Manual WhatsApp sharing | UI `wa.me` link opens with the receipt text; **no** Meta/Termii call is made (`MESSAGING_PAID_ENABLED=off`) | link works, zero provider sends |
| SMS and paid messaging | zero rows in provider/wallet ledgers; Termii/Meta logs empty | zero |
| Backups unaffected | next 01:30 UTC: new dump + marker, base backup, heartbeat on the **new** check; `verify-night` | PASS |
| Monitoring window | first 24 h: API error rate, inbox pending/dead-letter, queue depth, disk, `pg_stat_archiver.failed_count` | no growth |
Then and only then: backend PR #563 may be merged **by the owner**, and frontend PR #564 deployed after it (never before: it calls endpoints the old API lacks).

## 6. Owner operations, grouped
| When | Where | What |
|---|---|---|
| Now | Healthchecks | §2 test check; new production check |
| Now | Termius, one session | `scp` the guard script, then `retention`, `config`, `scheduler`, `rotate-ping` (read-only except rotate) |
| Now | laptop | step 3.4 `gh secret set` pipe, then re-run the reconcile job |
| Before window | GitHub | read `batch2-image-digests`; decide on the worker-image build; add the reconcile workflow to the PR branch if wanted |
| Window | Termius | §5.4 |
