# Unified messaging

The frontend wire types are in
`packages/types/src/messaging/contract.ts`. Monetary amounts are JSON decimal
strings in NGN kobo. A null estimate means the API could not quote the send.

| API under `/api/v1` | Contract |
| --- | --- |
| GET /messaging/overview | Implemented. Readiness, preferences, wallet, connections and templates |
| GET /messaging/deliveries | Cursor-paginated delivery history |
| GET /messaging/wallet/transactions | Implemented. Cursor-paginated wallet history, including top-ups when they are wired |
| POST /messaging/wallet/top-ups | Implemented behind a configuration gate. An active school owner submits `MessagingTopUpRequest` and receives `MessagingTopUpCheckout`. |
| PATCH /messaging/preferences | Explicit per-school channel opt-in |
| POST /messaging/whatsapp/signup | Start a school-bound Embedded Signup session |
| POST /messaging/whatsapp/signup/complete | Exchange an authorization code for the current session |
| DELETE /messaging/whatsapp/connection | Disconnect the current school |
| GET, PATCH /platform-admin/messaging/controls | Platform price and release controls |
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
