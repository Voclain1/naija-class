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
| PATCH /messaging/preferences | Explicit per-school channel opt-in |
| POST /messaging/whatsapp/signup | Implemented and gated. Start a school-bound Embedded Signup session |
| POST /messaging/whatsapp/signup/complete | Implemented and gated. Exchange the code and independently check WABA and phone ownership |
| DELETE /messaging/whatsapp/connection | Implemented. Disconnect the current school and confirm token revocation |
| GET, PATCH /platform-admin/messaging/controls | Platform price and release controls |
| POST /messaging/deliveries/:id/cancel | Cancel a queued paid notification without affecting an in-flight send |
| GET /portal/messaging/whatsapp-consent | Current consent wording, version and grant status |
| POST /portal/messaging/whatsapp-consent/challenge | Request a time-limited link to verify the guardian's current number and grant consent |
| POST /portal/messaging/whatsapp-consent/withdraw | Withdraw consent without sending a message |
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
amount, currency and URL at send time. SMS copy is unchanged.

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
amount in kobo.
