# Shareable payment links (+ WhatsApp share)

Plan-first. **Nothing in this document is built yet.** Approved in principle
2026-08-21 (Arinzechukwu); this doc is the design that must be signed off
before implementation, per the money-touching rigor CLAUDE.md mandates.

## 1. Why this exists

An admin generates an invoice and today has no way to hand a parent a link.
The guardian portal works correctly — a parent with a portal account can find
and pay their own invoice — but that excludes the large majority of parents at
a typical Nigerian private school who have never onboarded to the portal and
never will. The school's real collection channel is a bursar with a phone,
messaging parents one at a time.

The gap is narrow and specific:

- `POST /payments/paystack/init` already returns a real Paystack checkout URL
  ([paystack.controller.ts:44-55](../../apps/api/src/modules/payments/payments.controller.ts)).
- The admin invoice page already calls it —
  [`invoices/[id]/page.tsx:237-241`](../../apps/web/src/app/(admin)/finance/invoices/[id]/page.tsx)
  — and then throws the URL away into `window.location.href`.

So the link exists and is already crossing the wire; it is simply never shown.
That framing is what makes this feature look trivial, and it is **wrong**, for
the reason D1 gives.

## 2. Decisions

### D1 — The link must be durable, so this is Payment Requests, not `transaction/initialize`.

The obvious cheap build is "display the `authorizationUrl` we already have."
Rejected. A `transaction/initialize` URL is a **checkout session** — Paystack
time-bounds it on their end. The entire premise of sharing over WhatsApp is
asynchronous, delayed action: the bursar sends it at 10am, the parent pays
that evening or on Saturday. A link that may be dead by then is worse than no
link, because it fails silently and looks like the school's fault.

Durable links are a different Paystack product: **Payment Requests**
(`POST /paymentrequest`), which return a hosted invoice URL intended to be
sent to a customer and paid later. This is a real, modest expansion of
`PaystackService` — a new endpoint family, new response shapes, and a new
webhook event — not a UI change.

`PaystackService` today wraps `initializeTransaction`, `verifyTransaction`,
`refund`, `resolveAccount`, `createTransferRecipient`, `transfer`,
`checkBalance`, `getSubaccount`
([paystack.service.ts](../../apps/api/src/common/paystack/paystack.service.ts)).
This adds `createPaymentRequest`, `fetchPaymentRequest`, and
`archivePaymentRequest`.

### D2 — **The API surface below is UNVERIFIED and must be confirmed against test keys before any schema is committed.**

This is the single most important line in this document.

Paystack's own documentation (`paystack.com/docs/api/payment-request/`)
returns **HTTP 403 to automated fetching**, so the field list below was
derived from a third-party OpenAPI-generated TypeScript SDK
([alexasomba/paystack-node](https://github.com/alexasomba/paystack-node),
generated from Paystack's spec) cross-checked against web search. Search
results actively conflated the Transaction API with the Payment Request API
on the `subaccount` question — the one question this feature most depends on.

This project has already been burned once by exactly this: the
`CORRECTED 2026-08-15` block in
[paystack.service.ts:104-118](../../apps/api/src/common/paystack/paystack.service.ts)
records that the subaccount model was misunderstood, documented wrongly in the
schema, the settings page **and** this repo's own comments, and shipped that
way. That correction is the precedent for treating unverified Paystack
behaviour as a blocker rather than a detail.

**Required spike, before writing the migration** (half a day, test keys, no
schema, no committed code):

1. `POST /paymentrequest` with `subaccount` + `bearer` set. Confirm the
   response is 200 and the request is actually routed. **If `subaccount` is
   rejected and only `split_code` is accepted, this feature grows a whole new
   concern** — a Transaction Split per school, created and stored at
   assisted-setup time — and the estimate roughly doubles. This is the
   fork in the road.
2. Confirm the response field carrying the hosted URL. The SDK types name it
   `invoice_url`; other sources describe `https://paystack.com/pay/<request_code>`.
   Do not guess — one of these is what we persist.
3. Pay one in test mode. Capture the **exact** webhook event name(s) and the
   full payload, especially whether `charge.success` also fires and what
   `data.reference` looks like. D3 depends entirely on this.
4. Confirm an archive/cancel endpoint exists and its path. D6 depends on it.
5. Confirm whether `metadata` is accepted. The SDK's field list —
   `customer`, `amount`, `description`, `due_date`, `line_items`, `tax`,
   `currency`, `send_notification`, `draft`, `invoice_number`, `split_code`,
   `subaccount`, `bearer` — **does not include `metadata`**, which is what
   forces D4. If metadata *is* supported, D4 gets simpler.

Findings from the spike get written back into this section before the build
starts.

### D3 — The webhook will not correlate. This is the real engineering work.

Today every Paystack payment is correlated by a reference **we mint**:
`PSK-{schoolId}-{paymentId}`, parsed back by `parsePaystackReference`
([payments.service.ts:55-69](../../apps/api/src/modules/payments/payments.service.ts)).
That format is load-bearing for more than lookup — it **carries the tenant**,
which is how a pre-tenant webhook knows which `school_id` to set before
touching an RLS-protected table.

A Payment Request breaks this. The transaction is created when the *parent*
pays, so Paystack generates the reference and we never see it in advance. The
consequence, concretely: a parent pays a shared link, `charge.success` fires,
`parsePaystackReference` returns `null`, and the handler logs
`"Webhook: unrecognized reference format"` and **returns silently**
([payments.service.ts:432-436](../../apps/api/src/modules/payments/payments.service.ts)).

**A parent's money would arrive at the school's Paystack account and the
invoice would stay unpaid in School Kit, with nothing but a warning log.**
That is the failure this feature must be designed around, and it is invisible
in any "just show the link" framing.

The fix is a third branch in the webhook router
([paystack.controller.ts:66-75](../../apps/api/src/modules/payments/paystack.controller.ts)),
alongside the existing `transfer.*` / `charge.*` split:

```
event.startsWith("transfer.")       → PayrollService
event.startsWith("paymentrequest.") → PaymentLinksService   ← new
otherwise                           → PaymentsService
```

correlating on `request_code`, which we stored when we minted the link.

### D4 — Correlating pre-tenant needs SECURITY DEFINER function #21.

The webhook runs before any tenant is known, and the link table will be under
FORCE RLS like every other tenant table. `request_code` → `school_id` is
therefore unanswerable by ordinary `app_user` SQL — the exact chicken-and-egg
problem every function in CLAUDE.md's SECURITY DEFINER inventory exists to
solve.

The existing flow dodges this by packing `schoolId` into the reference string.
We cannot do that here, and per D2 item 5 there appears to be no `metadata`
field to smuggle it through either. (`description` is freeform and echoed, but
encoding a tenant id into human-readable copy that renders on a page shown to
parents is a bad trade — it is displayed text, not a correlation channel.)

So:

```
paystack_resolve_payment_link(p_request_code text)
  → { link_id, school_id, invoice_id }
```

Fits the discipline exactly: one caller (the webhook), opaque ids only, no
PII, no amounts. **Count moves 20 → 21.** Next cadence review stays due at 23
(CLAUDE.md's current standing). Must be added to `SECURITY_DEFINER_FUNCTIONS`
in
[security-definer-inventory.spec.ts](../../apps/api/src/__tests__/security-definer-inventory.spec.ts)
and to CLAUDE.md's table **in the same PR**, or CI fails — which is the gate
working as intended.

### D5 — One live link per invoice. No `PENDING` row is created at all.

Requested behaviour: generate once, re-show the same link on later visits.
Agreed, and it solves more than it was aimed at.

The orphan-row concern from the investigation was that the staff
`initPaystack` has **no in-flight guard** (only the guardian path does — the
30-minute `IN_FLIGHT_WINDOW_MS` at
[portal-payments.service.ts:30](../../apps/api/src/modules/portal-payments/portal-payments.service.ts)),
so every click mints a fresh `PENDING` `Payment` row that nothing ever
transitions to `FAILED` — Paystack only sends `charge.failed` for an
*attempted-and-declined* payment, never for an abandoned checkout.

The clean answer is not to reuse the pending row. **It is not to create one.**

A shared link is not an in-progress checkout; it is a standing request to pay,
and it may sit unpaid for a week or be ignored entirely. Modelling that as a
`PENDING` `Payment` misrepresents it — those rows exist to represent
"a payment is being attempted right now."

So: the link lives in its own table, and a `Payment` row is created **only
when the webhook confirms real money**, written directly as `SUCCESS`, exactly
as manual payments are. Zero `PENDING` rows in this flow, and therefore zero
orphan accumulation, structurally rather than by cleanup.

Idempotency comes from the DB, not from convention: `@@unique([schoolId, invoiceId])`
filtered on live rows, so "one live link per invoice" is a constraint the
database enforces even if a future second caller forgets — the same reasoning
[`auth_resolve_student_invitation`](../../CLAUDE.md) uses for putting liveness
in SQL rather than the service layer.

### D6 — A link is bound to an amount, so a balance change must invalidate it.

A Payment Request carries a fixed `amount`. If the bursar shares a link for
₦150,000 and the parent then pays ₦50,000 in cash at the office, the live link
still demands ₦150,000.

Rule: **any payment recorded against an invoice with a live link archives that
link.** The next admin visit mints a fresh one for the new balance. This is why
`archivePaymentRequest` is in scope (D2 item 4) and not deferred — without it,
"one live link per invoice" degrades into "one permanently wrong link per
invoice."

### D7 — Money that arrives is always recorded, even if it overpays.

`initPaystack` today rejects `amount > remaining` up front
([payments.service.ts:358-364](../../apps/api/src/modules/payments/payments.service.ts)).
That guard cannot apply here: the check would run at link-creation time, but
the payment lands whenever the parent acts, and D6's race is real if two
channels are used at once.

Decision: the webhook **records the payment regardless**, and lets the invoice
go over-paid rather than dropping it. You cannot un-take money that has
already settled in the school's account; refusing to write the row would leave
the school's books disagreeing with their Paystack balance — a far worse
failure than a visible credit. `RefundsService` already exists as the
remedy path.

Overpayment must be surfaced in the UI, not silently absorbed. Flagged as a
follow-up if it needs more than the existing invoice status can express.

### D8 — Idempotency against webhook retries.

Paystack retries on non-2xx. `Payment` already carries a partial unique index
on `(schoolId, paystackReference)` where the reference is non-null
([schema.prisma:1990-1993](../../packages/db/prisma/schema.prisma)). Storing
the real transaction reference from the webhook payload makes duplicate
delivery a constraint violation rather than a double-credit. Handle it as a
no-op, and return 200 — the existing handler's contract.

### D9 — `recordedBy` is the admin who created the link.

`Payment.recordedBy` is non-null and there is no user in a webhook. Setting it
to the admin who generated the link (stored on the link row) is both truthful
and the audit answer to "who put this in motion" — better than a system
sentinel.

### D10 — `wa.me` with no recipient. Not WhatsApp Business API.

Approved. The button builds:

```
https://wa.me/?text=<urlencoded message containing the payment link>
```

No recipient number, so **no DTO change and no widening of bursar's
permissions** — neither `InvoiceDto`
([invoice.dto.ts:41-58](../../packages/types/src/finance/invoice.dto.ts)) nor
`DebtorDto` carries a guardian phone, and `PHASE_3_BURSAR_PERMISSIONS`
([permissions.ts:465-511](../../packages/types/src/permissions.ts)) holds no
`guardian.*` grant. The admin picks the contact inside WhatsApp.

**This does not cash the deferred WhatsApp cheque.** WhatsApp Business API
remains deferred and blocked on external approval —
[phase-4.md](phase-4.md) §8 D1, ARCHITECTURE.md open question #5,
[deferred.md:1268-1274](../deferred.md). A `wa.me` link is a plain hyperlink
that opens the admin's own WhatsApp; it involves no API, no approval, no cost,
and no server-side sending. The deferral note must be amended to say so
explicitly, so a later reader does not conclude WhatsApp integration landed.

Message copy needs the school name, student name, amount and link. Note it is
sent from the **admin's personal WhatsApp**, so it should read as a person
writing, not as a system notification.

### D11 — Paystack-not-enabled is a visible state, never a silent failure.

`initPaystack` hard-rejects with `PAYSTACK_NOT_ENABLED` unless
`paystackPaymentsEnabled && paystackSubaccountCode`
([payments.service.ts:345-351](../../apps/api/src/modules/payments/payments.service.ts)),
and **that is the default for every school** until assisted setup completes
([paystack-assisted-setup.md](paystack-assisted-setup.md)). The same gate
applies here and must be enforced server-side, not just hidden in the UI.

Per instruction: the share control renders a clear **"Connect Paystack to
share payment links"** state pointing at Settings → Payments, rather than
being absent or erroring on click. A missing button reads as a broken feature;
an explanatory state reads as a setup step.

## 3. Data model

New table (name TBD — `payment_links`), FORCE RLS with the standard
`tenant_isolation` policy, declared in the feature migration itself, matching
[the invoices migration](../../packages/db/prisma/migrations/20260630000000_phase_3_slice_6_invoices/migration.sql).

Fields: `id`, `schoolId`, `invoiceId`, `requestCode`, `hostedUrl`,
`amount` (Int, kobo — never Float), `status` (LIVE / PAID / ARCHIVED),
`createdBy`, `createdAt`, `archivedAt`, `paidAt`.

Partial unique index on `(school_id, invoice_id)` where status = LIVE, plus a
unique on `request_code` (the webhook's lookup key).

Rejected: columns on `Invoice`. A link has its own lifecycle (minted,
archived, re-minted per D6), so it is a row, not an attribute — same reasoning
as [D3 in paystack-assisted-setup.md](paystack-assisted-setup.md).

## 4. Endpoints

| Endpoint | Permission | Notes |
|---|---|---|
| `POST /invoices/:id/payment-link` | `payment.record` | Idempotent per D5 — returns the existing live link if one exists. Bursar already holds this. |
| `GET /invoices/:id/payment-link` | `payment.read` | Re-show on page load. |
| webhook `paymentrequest.*` | none (HMAC) | Existing `PaystackWebhookGuard`, new router branch per D3. |

Audit: `payment-link.create` and `payment-link.archive`, following the
`AUDIT_*` const convention in
[payments.service.ts:27-29](../../apps/api/src/modules/payments/payments.service.ts).
Every payment-mutating action writes to `audit_logs` — CLAUDE.md's money rule,
no exceptions.

## 5. Tests

- `parsePaystackReference` must still reject a Payment Request reference — a
  regression guard on D3's whole premise.
- Webhook routes `paymentrequest.success` to the new handler, `charge.*` and
  `transfer.*` unchanged.
- Idempotency: same `request_code` twice → one `Payment` row (D8).
- No `PENDING` row is ever created by the link flow (D5).
- Live-link uniqueness holds under concurrent creation (D5).
- Recording a payment archives a live link (D6).
- Overpayment is recorded, not dropped (D7).
- `PAYSTACK_NOT_ENABLED` rejected server-side, not just UI-hidden (D11).
- RLS: cross-tenant read of `payment_links` returns zero rows; cross-tenant
  insert rejected by `WITH CHECK` **with a valid GUC set**, plus a control
  insert under the correct GUC that succeeds — so the rejection is not passing
  for the wrong reason. Verified as `app_user` against a live DB, per the
  evidence standard the student-portal-auth migration set.
- SECURITY DEFINER conformance spec updated and passing at count 21 (D4).

## 6. Scope

**In:** durable link creation, idempotent re-show, WhatsApp share button,
webhook correlation, archive-on-balance-change, the SD function, RLS, audit.

**Out:** WhatsApp Business API (still deferred). Recipient pre-fill / guardian
phone on finance DTOs. Bulk "share to all debtors" — worth wanting, but it
multiplies every risk above by the size of a class and should follow the
single-invoice path proving itself. Link expiry/reminder scheduling.

**Estimate:** one slice, *conditional on D2*. If `subaccount` works on
`/paymentrequest`, this is a contained piece of work. If only `split_code` is
accepted, add Transaction Split management per school and re-scope.

**Sequencing:** D2's spike is a hard gate. Nothing below it gets written first.

---

## Sources consulted for the Paystack surface

- [Payment Requests API](https://paystack.com/docs/api/payment-request/) — 403 to automated fetch
- [Split Payments](https://paystack.com/docs/payments/split-payments/)
- [Transaction Split API](https://paystack.com/docs/api/split/)
- [PaystackHQ/documentation — split-payments.md](https://github.com/PaystackHQ/documentation/blob/master/receiving-payments/split-payments.md)
- [alexasomba/paystack-node](https://github.com/alexasomba/paystack-node) — OpenAPI-generated types, the field list's actual source
- [Paystack Webhooks](https://paystack.com/docs/payments/webhooks/)
