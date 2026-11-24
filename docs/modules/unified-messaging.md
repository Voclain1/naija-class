# Unified messaging

The frontend wire types are in
`packages/types/src/messaging/contract.ts`. Monetary amounts are JSON decimal
strings in NGN kobo. A null estimate means the API could not quote the send.

| API under `/api/v1` | Contract |
| --- | --- |
| GET /messaging/overview | Implemented. Readiness, preferences, wallet, connections and templates |
| GET /messaging/deliveries | Implemented for paid notifications. Cursor-paginated delivery history |
| GET /messaging/wallet/transactions | Implemented. Cursor-paginated wallet history, including top-ups when they are wired |
| POST /messaging/wallet/top-ups | Implemented behind a configuration gate. An active school owner submits `MessagingTopUpRequest` and receives `MessagingTopUpCheckout`. |
| PATCH /messaging/preferences | Implemented. Owner-only, audited WhatsApp and wallet-backed SMS opt-in with both flags false by default |
| POST /messaging/whatsapp/signup | Implemented and gated. Start a school-bound Embedded Signup session |
| POST /messaging/whatsapp/signup/complete | Implemented and gated. Exchange the code and independently check WABA and phone ownership |
| POST /messaging/whatsapp/templates | Submit a supported template for the connected school WABA, behind a separate release flag. This does not approve it for dispatch. |
| POST /messaging/whatsapp/connection/register | Register the connected school phone with Meta, behind a separate release flag |
| GET /messaging/whatsapp/conversations/:guardianId | Owner-only encrypted inbound text history, behind school retention configuration |
| GET /messaging/whatsapp/templates | Read the connected WABA’s template IDs, exact languages, categories and provider approval states |
| GET /messaging/whatsapp/connection/health | Check the current school-owned account and phone without exposing credentials |
| DELETE /messaging/whatsapp/connection | Implemented. Disconnect the current school and confirm token revocation |
| GET /platform-admin/messaging/controls | Effective and staged rate versions, release status, and emergency switch revisions |
| POST /platform-admin/messaging/provider-activation | Record the operator’s provider activation decision. The release flags and emergency stop still govern dispatch. |
| GET or POST /platform-admin/messaging/price-catalog | Replace the effective-dated legacy Termii catalogue with an audited revision |
| GET or POST /platform-admin/schools/:id/messaging/price-catalog | Replace the school’s complete effective-dated rate catalogue |
| POST /platform-admin/schools/:id/messaging/templates/:name/review | Record a provider-evidenced variant review. Send `review: null` to suspend it. Live dispatch checks Meta again. |
| POST /platform-admin/messaging/spending-limit | Appends an SMS platform ceiling under the VPS maximum. Use zero to pause or null to restore the VPS ceiling. |
| GET or POST /platform-admin/schools/:id/messaging/spending-limit | Read or append a school cap under its configured maximum |
| POST /platform-admin/messaging/emergency-controls | Appends an audited SMS or WhatsApp stop/resume revision. Resume still requires normal authorization and provider gates. |
| POST /messaging/deliveries/:id/cancel | Cancel a queued paid notification without affecting an in-flight send |
| GET /portal/messaging/whatsapp-consent | Current consent wording, version and grant status |
| POST /portal/messaging/whatsapp-consent/challenge | Request a time-limited link to verify the guardian's current number and grant consent |
| POST /portal/messaging/whatsapp-consent/withdraw | Withdraw consent without sending a message |
| GET /platform-admin/schools/:id/messaging/reconciliation | Reports open and resolved wallet holds, charges, partial releases and recorded discrepancies |
| GET /platform-admin/schools/:id/messaging/wallet | Read school wallet balance and held funds |
| DELETE /platform-admin/schools/:id/messaging/whatsapp | Offboard an account when the school owner cannot access it |
| POST /platform-admin/schools/:id/messaging/deliveries/:deliveryId/reconcile | Audited, provider-evidenced settlement or release of an SMS reservation |
| Existing reminder campaign endpoints | Keep the existing progress and preview DTOs, extending preview with an estimate when wired |

The overview and wallet history require an active school owner or admin with
`notification-preferences.read`. The top-up route requires an active owner
with `messaging-wallet.top-up` and a verified staff email. Wallet transactions
accept an optional opaque `cursor`. An invalid or foreign cursor returns
HTTP 400. In the overview, paid-channel readiness refers to unified sending,
while the SMS preference reflects the existing rail. A null wallet threshold
or template language denotes an unconfigured value. Use the existing campaign
and notification-preference endpoints for their current workflows.
Reminder preparation accepts `options.scheduledFor` as an ISO timestamp with
an offset. The preview includes `smsEstimate`, which counts possible fallback
segments and quotes a ceiling when a rate is configured. A null ceiling means
the cost is unknown. Once confirmed, the campaign waits until the scheduled
time and Lagos quiet hours allow it to proceed. With `options.includeInvoiceLink`,
an email may include an existing locally live Paystack link. The worker
requires exactly one outstanding invoice and checks that link's ownership,
amount, currency and URL at send time. SMS copy is unchanged. For
`options.useWhatsApp`, the mobile slot is explicitly WhatsApp. The preview
includes `whatsappEstimate`, with the number of eligible verified guardians
and an effective-rate cost ceiling. Use delivery history to cancel a WhatsApp
job before the provider worker claims it.

Paid sends require explicit school and platform authorization. A WhatsApp
template requires verified approval for the exact language, account and current
component schema. The owner-supplied template names alone establish no such
approval. Provider credentials remain server-side.


School-owned WhatsApp accounts are the tenant architecture. Internal setup
alerts continue to use the existing SchoolKit account. A school-owned Meta
notification never debits the SchoolKit wallet. Paid confirmation profiles
must select one channel and carry one effective, verified rate for that
provider and category. Missing data or a category change blocks the send.
The application never attempts another channel after an ambiguous provider
result. A partly paid invoice is confirmed using the accepted transaction's
amount in kobo. Its paid delivery jobs commit with the verified payment,
so a restart after commit leaves the jobs available to the worker.

## Remediation additions for frontend PR #564

The existing checkout request and redirect response keep their original fields.
The optional checkout `quote` shows charged amount, estimated processing fee,
and expected net credit as decimal kobo strings. Before initiating checkout,
read `GET /messaging/wallet/top-ups/availability` and
`GET /messaging/wallet/top-ups/quote?amountKobo=...`. Owner-only
`POST /messaging/wallet/top-ups/:reference/recover` checks payment evidence
when the redirect arrives before a webhook. The actual verified fee controls
the credited amount. Repeating the redirect or receiving the callback later
cannot credit the wallet again.

Messaging overview can now include `topUps` and `legacySms` separately from
the wallet-funded SMS provider. A credential alone does not imply an approved
release, a funded authorization, or readiness. Paystack mismatch cases and
unresolved top-ups are available to platform operators through
`/platform-admin/schools/:id/payments/reconciliation` and
`/platform-admin/schools/:id/messaging/top-up-reconciliation`.
Wallet reconciliation adds `escalatedAt`.

Invoice payment-link state can also be `EXPIRED`, `ALREADY_PAID`, or
`INVALIDATION_PENDING`. These states contain no URL or student details.
A `LIVE` link can include `expiresAt`. Existing receipt routes continue to
require the current authenticated staff permission checks.

Successful online payment DTOs can include optional `allocatedKobo` and
`unappliedKobo`. The existing `amount` remains the gross receipt amount.
Only the allocated portion reduces the invoice. Surplus stays visible for
authorized reconciliation and does not trigger a refund. Campaigns now report
`PRICE_APPROVAL_REQUIRED` and `WHATSAPP_REVIEW_REQUIRED` halt reasons.
