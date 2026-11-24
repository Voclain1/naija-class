# Unified messaging remediation

Backend PR #563 continues from audited commit f67b53d9. Frontend PR #564
owns presentation. The audit attachment and original 62 numbered cases were
unavailable in this workspace. No audit-only finding or original case is
marked passed without the source.

| Finding group | Verified against the previous code | Remediation and remaining work |
| --- | --- | --- |
| C1 | A configured credential could coexist with missing financial authorization. Legacy spend was recorded only in the platform aggregate. | Separate credential, release, authorization and readiness fields. Explicit bounded migration mode and atomic school/event attribution for eight callers. Stage and verify the authorized budget before cutover. |
| C2–C5 | Top-ups credited gross funds. Manual and checkout paths did not consistently lock the invoice. Hosted-link confirmation excluded invalidating links. | Deduct verified fees once, report mismatches, disclose fee estimates and recover missing callbacks. Added invoice-first locking and durable closed-invoice and mismatch evidence. New external payments retain the gross receipt with only the outstanding amount applied. Surplus is retained in operator reconciliation. Automated bank settlement import and an operator application workflow remain open. |
| C6, H2, H8, H9, H15 | Unknown outcomes already kept funds held. There was no 24-hour investigation escalation. | Scheduled audited escalation. Existing signed charge evidence can still reconcile eligible holds. The deadline does not retry, settle, release or switch channels. Provider-specific pacing and safe non-acceptance retries remain open. |
| C7, T3, T49, T50, T52 | No local expiry. Invalidation could race confirmation. | Configurable validity, exclusion from reminders, explicit local states, and late verification through invalidation. Original links keep their prior validity behavior. Provider archive acknowledgement does not establish that previously distributed URLs reject payment. Dedicated public paid/receipt experience remains open. |
| C8 | Only legacy raw-body SHA512 was accepted. Callbacks ran inline. The proposed SHA256 conflicts with Paystack’s current specification. | Mode-specific rotation, timestamped raw-body SHA512 and no downgrade. Durable callback capture, bounded backoff and a dead-letter state. |
| H6, H10, H12 | Frequency enforcement could be off. The campaign did not store an approved price at dispatch. | Nonzero overlap protection, approved unit-price ceilings and price/review halt states. WhatsApp handoff rechecks provider category, and SMS egress enforces its authorized unit cap. |
| Other findings | Source audit unavailable. | Meta lifecycle and key rotation, support access, Meta invoice reconciliation, SMS consent, pacing, delivery filters and source-numbered QA remain open. |

## Corrected acceptance criteria

- A paid or zero-balance invoice produces no billable reminder.
- Confirm the actual amount of a verified partial payment.
- School-owned Meta billing never debits the SMS wallet.
- An ambiguous attempt never automatically retries or falls back. Twenty-four
  hours is the investigation SLA.
- A carrier status cannot authorize settlement. Termii’s charge units and
  finality require a verified account contract.
- Enrollment grants no messaging consent. Free-form messaging requires separate
  authorization and a verified customer-service window.
- An archive acknowledgement cannot prove the old hosted URL is unpayable.
- Mocked tests, CI checks and live account validation have separate outcomes.

## Release decision

Keep PR #563 in draft while the original matrix and remaining engineering
items are reviewed. Keep paid sends, top-ups, external onboarding and shared
WhatsApp disabled. The staging and rollback sequence is in the
[unified messaging runbook](../runbooks/unified-messaging.md).

[Paystack webhook specification](https://paystack.com/docs/payments/webhooks/) ·
[Paystack Payment Requests API](https://paystack.com/docs/api/payment-request/)
