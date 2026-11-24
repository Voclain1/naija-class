# Unified messaging foundations

Started the frontend contract, then hardened the reminder worker and
Paystack payment-link creation. Added a gated Meta delivery webhook, prepaid wallet with verified top-ups,
and scheduled campaigns with optional links for one current invoice.
Tests use local PostgreSQL and fictional provider fixtures. No production credential or rollout switch was configured.

The [rollout runbook](../runbooks/unified-messaging.md) records the pending
integrations and acceptance gates.
