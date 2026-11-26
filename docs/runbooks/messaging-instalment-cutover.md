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

After approval, stage immutable application and recovery images and preserve
both on the host. Review and install the checked operator tools and manifest,
then verify the live scheduler, migration role, flags and API baseline.
Use the guarded cutover to return retryable 503s, drain writers, capture the
verified backup, apply migrations and start the candidate. Verify the inbox
and financial integrity before reopening ingress. Deploy the approved frontend
by digest with a targeted web/portal switch as applicable, preserving every
other service and its environment. Prior to opening traffic, confirm queued
callbacks can be recovered with the inbox-aware API. Never restore over
new transactions or use an older allocation or attribution implementation.

Production approvals, independent exact-head review, provider approval and
paid-channel activation are separate gates. No production migration or
provider test is performed by the rehearsal workflow.
