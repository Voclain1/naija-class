# Unified messaging foundations

Started the frontend contract, then hardened the reminder worker and
Paystack payment-link creation. Added a gated Meta delivery webhook, prepaid wallet with verified top-ups,
and scheduled campaigns with optional links for one current invoice.
Tests use local PostgreSQL and fictional provider fixtures. No production credential or rollout switch was configured.

The [rollout runbook](../runbooks/unified-messaging.md) records the pending
integrations and acceptance gates.

## Muse QA continuation

Added school-owned Embedded Signup with tenant-bound encrypted credentials,
verified consent and STOP handling, a signed Termii report inbox, and a
default-off paid payment confirmation worker. Payment confirmation checks
the expected transaction amount in kobo. Provider reclassification blocks
automated Meta sends until reviewed again. Uncertain SMS reservations remain
held for provider-evidenced operator reconciliation.

## Engineering continuation

Added signed central-account Termii routing from exact provider references,
atomic paid event jobs for invoice generation and the academic and guardian
workflows, partial settlement with discrepancy reporting, and budget guards
on legacy SMS. Added append-only platform emergency controls, gated Meta
number registration and template submission, and encrypted inbound history
with configured retention. All changes remain on draft PR #563. See the
rollout runbook for remaining engineering and external checks.

## Remediation continuation

Added Paystack signing-secret rotation and a durable callback inbox, fee-aware
top-up credit and recovery, serialized invoice mutations, exception records,
local validity and archive-race handling, and 24-hour wallet escalations.
Legacy SMS remains subject to the shared spending ceiling and writes a
tenant-scoped authorization event. The original Muse report was unavailable
in the workspace, so audit and acceptance claims are limited to supplied
findings and executed tests.

### Closing sprint

Reviewed the attached Muse criteria against the backend continuation. Added
bounded legacy SMS migration controls, payment time cutoffs and replacement,
operator review and replay, and independently approved email continuation.
The isolated focused run passed 593 tests. Track exact-head CI and unresolved
provider and financial approval gates in the disposition report. Keep PR #563
in draft and leave PR #564 unchanged.
