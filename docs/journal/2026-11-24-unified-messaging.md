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
