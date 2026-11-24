# Unified messaging

The proposed frontend wire types are in
`packages/types/src/messaging/contract.ts`. Monetary amounts are JSON decimal
strings in NGN kobo. A null estimate means the API could not quote the send.

| Proposed API under `/api/v1` | Contract |
| --- | --- |
| GET /messaging/overview | Readiness, preferences, wallet, connections and templates |
| GET /messaging/deliveries | Cursor-paginated delivery history |
| GET /messaging/wallet/transactions | Cursor-paginated wallet and top-up history |
| POST /messaging/wallet/top-ups | Initialize a server-bound payment and return the checkout URL |
| PATCH /messaging/preferences | Explicit per-school channel opt-in |
| POST /messaging/whatsapp/signup | Start a school-bound Embedded Signup session |
| POST /messaging/whatsapp/signup/complete | Exchange an authorization code for the current session |
| DELETE /messaging/whatsapp/connection | Disconnect the current school |
| GET, PATCH /platform-admin/messaging/controls | Platform price and release controls |
| Existing reminder campaign endpoints | Keep the existing progress and preview DTOs, extending preview with an estimate when wired |

These are design contracts. Route availability is tracked in the implementation
report. Use the existing campaign endpoints for running campaigns.

Paid sends require explicit school and platform authorization. A WhatsApp
template requires verified approval for the exact language, account and current
component schema. The owner-supplied template names alone establish no such
approval. Provider credentials remain server-side.
