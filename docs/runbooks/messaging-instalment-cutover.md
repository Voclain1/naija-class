# Messaging cutover from the instalment release

Production baseline is merged commit `25e54017`. The API, web and guardian
portal use the pinned images in instalment cutover run 45898846922. The render
worker was retained on its own existing image. Use the live Compose project,
instalment overlays and pinned backup scheduler. Keep automatic deployment
disabled and leave the cutover approval variable unset until owner approval.

The baseline's entire migration history is immutable. In particular,
`20270118120000_paystack_reconciliation_cases` contains finance DDL alone.
`20270125120000_messaging_wallet_top_up_recovery` adds the two wallet recovery
columns. The hosted rehearsal compares every baseline migration byte-for-byte
before applying the candidate against PostgreSQL 18.

The recovery API is separately pinned from inbox-aware, instalment-aware
source. The rehearsal sends a signed fictional payment for a later
instalment into the durable inbox, switches images with the event pending,
and asserts target allocation, surplus, receipt and replay protection.
Use the deployed instalment API only for the pre-migration baseline; it
cannot drain the candidate inbox. A separately built recovery image guards
against an image failure. For a code defect shared by both images, keep
ingress closed and fix forward on the migrated schema.

## Acceptance and release sequence

| Gate | Evidence to require before cutover |
| --- | --- |
| Historical data and schema | Exact-head PostgreSQL 18 fresh and baseline-upgrade checks, legacy invoice, guardian, receipt and refund regression suites |
| Payment recovery | Hosted candidate → recovery → candidate switch with pending inbox, later instalment, capped allocation and replay assertions |
| Controlled switch | Hosted maintenance, migration failure, unhealthy candidate, recovery and clean-cutover cases |
| Backup and PITR | Prior independent R2 restore and WAL-G/PITR evidence remains applicable while live PostgreSQL and pinned scheduler identity remain unchanged. Validate the live config and cron read-only |
| Runtime configuration | Candidate checks, live digest check, all new paid/SMS/Termii gates off, authorized Paystack webhook configuration confirmed |
| Frontend | Exact-head stacked CI against the merged backend changes, plus production build proof for the approved frontend source |
| Deployment | Owner approval for the exact manifest, fresh independently verified pre-cutover backup, and healthy services with protected container identities retained |

The hosted workflow publishes the checksummed tools and eligible manifest as
artifacts. It has no deployment or configuration-write step. The generic VPS
workflow stays disabled. Its unused `BACKUP_ENV_FILE` lacks the live heartbeat
key; the scoped procedure uses the existing live backup configuration and never
copies or replaces it from GitHub.

After approval, verify `RELEASE_SHA256SUMS` and the operator package's
`SHA256SUMS` before installing them in the existing VPS project. The
`release/` bundle contains the original backend manifest and frontend override,
plus the exact release pair. Run `cutover.sh stage`, then `cutover.sh verify`.
Confirm the printed image pins and checksums, then record consent from an
interactive terminal using `cutover.sh authorize`. The four-hour authorization
binds both artifact checksums, both frontend digests and the checksummed tools.

With the approval flag set for the command only, `cutover.sh execute` closes the
API, web and portal, drains writers, verifies the off-site backup and migrates.
It verifies backend health and financial integrity, persists
`BACKEND_VERIFIED`, then switches only web and portal to the approved digests.
Both must answer internal health and reach the running backend before the script
records `FRONTEND_VERIFIED`. Ingress stays closed. Review the evidence and use
`cutover.sh reopen` with the per-command approval flag. Reopen rechecks all
four image identities, backend and frontend health, finances, and the protected
infrastructure. There is no separate maintenance-off route.

After an interruption before reopening, inspect the saved phase and use
`cutover.sh execute --resume` after correcting the cause. Recovery uses the
pinned instalment- and inbox-aware API and render images and the same web and
portal gates. Run the gated reopen only after reviewing recovery and inbox state.
For a defect shared by both backend images, keep ingress closed and fix forward.
Preserve the live database and archive.

Production approvals, independent exact-head review, provider approval and
paid-channel activation are separate gates. No production migration or
provider test is performed by the rehearsal workflow.
