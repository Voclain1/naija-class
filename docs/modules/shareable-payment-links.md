# Shareable payment links (+ WhatsApp share)

Plan-first. **Nothing in this document is built yet.** Approved in principle
2026-08-21 (Arinzechukwu); this doc is the design that must be signed off
before implementation, per the money-touching rigor CLAUDE.md mandates.

**UPDATED 2026-08-22 after the verification spike ran against Paystack's live
test API.** D2's gate has been discharged and its findings are now measured
rather than assumed. Three of the four assumptions the original draft rested
on were WRONG, and the correction roughly doubles the scope — see §2A. Read
that section before anything below it; several decisions downstream changed.

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

## 2A. Spike results (2026-08-22) — what is actually true

Run against Paystack's live **test** API with a `sk_test_` key, confirmed by
prefix check before any call. Test artefacts created and then archived:
subaccount `ACCT_6czb2qyorlser2u`, split `SPL_6PbNHcTjf6`, payment requests
`PRQ_d02ejbzyvqo10vz` and `PRQ_2xfhsojnwz4wmzq` (both archived; the second was
paid with a test card to capture a real transaction).

### F1 — `subaccount` + `bearer` are SILENTLY DROPPED by `/paymentrequest`

The single most important finding, and the reason the gate existed.

```
POST /paymentrequest { customer, amount, subaccount: "ACCT_…", bearer: "subaccount" }
  → 200 OK  "Payment request created"

GET /paymentrequest/PRQ_…
  → split_code: null
  → no `subaccount` field stored at all
```

Paystack **accepted the request and discarded the routing fields**. No error,
no warning, a 200 and a working-looking link. Had this shipped on the
third-party SDK's type definitions (which list `subaccount` and `bearer` as
accepted), every shared payment link would have settled into SchoolKit's main
account instead of the school's, silently.

This is the same class of failure as the `CORRECTED 2026-08-15` block in
`paystack.service.ts`, which records the subaccount model being misunderstood
and shipped wrong in the schema, the settings page and the code comments. That
precedent is why the spike was made a blocking gate rather than a detail, and
it has now paid for itself twice.

### F2 — `split_code` works, and the economics are identical to today's

```
POST /split { type: "flat", subaccounts: [{ subaccount: ACCT_…, share: 15000000 }],
              bearer_type: "subaccount", bearer_subaccount: ACCT_… }
  → SPL_6PbNHcTjf6

POST /paymentrequest { …, split_code: "SPL_6PbNHcTjf6" }  → split_code STORED ✓
```

Verified on the **paid** transaction, which is what makes this trustworthy
rather than merely accepted:

```
split.shares = { paystack: 200000,
                 subaccounts: [{ amount: 14800000, subaccount_code: ACCT_… , fees: 200000 }],
                 integration: 0 }
split.formula.bearer_type = "subaccount"
```

`integration: 0` is the load-bearing number — **SchoolKit's main account
receives nothing**, exactly the 0%-cut arrangement `PaystackInitParams.bearer`
documents today, and the school bears Paystack's own fee. So the split route
preserves the business model exactly; it is the plumbing that changes, not the
economics.

### F3 — there is NO `invoice_url`; the customer link is a CONVENTION

The SDK types promised `invoice_url` ("a hosted URL where the customer can
view and pay"). **It does not exist.** Neither the create nor the fetch
response contains any URL field (`pdf_url` is null).

The link that works, confirmed by loading it in a real browser:

```
https://paystack.com/pay/PRQ_2xfhsojnwz4wmzq   → 200
    "Hey spike-parent@example.com, Schoolkit has requested a payment of NGN 150,000"
```

The `PRQ_` prefix is REQUIRED — without it the URL 404s and redirects to
`paystack.shop`, which is the separate Payment Pages product. Note `curl`
returns 403 for all of these (Cloudflare, not 404), so this was only
resolvable with a headed browser; automated probing gives a misleading answer.

**Risk to state plainly in any build: we would be hard-coding a URL Paystack
never returned to us.** If they change the format, every link already sitting
in parents' WhatsApp threads dies, and we find out from a parent, not from an
API error.

**Second-order privacy finding:** that page displays the customer's EMAIL
ADDRESS and the integration name. A link forwarded on WhatsApp discloses the
payer's email to whoever receives it. That interacts directly with D10's
no-recipient `wa.me` choice. D10 closes it with a synthetic, non-parent email.

### F4 — the transaction reference is Paystack's, and D3's failure is REAL

The paid transaction:

```
reference   = "T673056755756172"        ← Paystack-generated, "T" + 15 digits
metadata    = { referrer: "https://paystack.shop/pay/PRQ_…" }
subaccount  = {}                        (routing lives under `split`, not here)
```

`parsePaystackReference` requires `PSK-{uuid}-{uuid}` (77 chars) and returns
`null` for anything else. `T673056755756172` therefore hits the
`"Webhook: unrecognized reference format"` branch and the handler RETURNS.
**D3's predicted silent-money-loss path is confirmed against a real
transaction, not inferred.**

### F5 — `metadata` round-trips on the REQUEST but does NOT reach the TRANSACTION

This one cuts both ways and corrects the spike's own first reading.

```
payment request metadata  = { schoolId: "1111…", invoiceId: "2222…" }   ✓ persisted
transaction   metadata    = { referrer: "https://paystack.shop/pay/PRQ_…" }  ✗ ours absent
```

So metadata is a usable correlation channel **only for `paymentrequest.*`
events**, whose payload is the payment request. It is NOT available on
`charge.success`, whose payload is the transaction.

Two other correlation keys observed:
- the payment request's embedded transaction carries `payment_request: 24150967`
  — the request's NUMERIC id, not its `request_code`, so both must be stored;
- the verified transaction carries `split.split_code` — which, if each school
  has its own split, identifies the school.

### F6 — archive works exactly as D6 assumed

```
POST /paymentrequest/archive/PRQ_…  → 200 "Payment request has been archived"
GET  → archived: true
```

Confirmed on both an unpaid and a paid request. D6 (archive-on-balance-change)
is implementable as written.

### F7 — one `percentage: 100` split is reusable across invoice amounts

**Resolved 2026-08-22 against the live test API; this closes the last open
technical question.** One split, `SPL_TJ5TvoYt9w`, was created with:

```
type                 = percentage
subaccount share     = 100
bearer_type          = subaccount
bearer_subaccount    = ACCT_6czb2qyorlser2u
```

The same split code was accepted by two Payment Requests with different fixed
amounts — 123,400 kobo (`PRQ_1ssx0bvkm37h1n4`) and 987,600 kobo
(`PRQ_tvcvuzpf8as7fh0`). Because the hosted checkout could not be driven in
this session, settlement was proved separately with two successful test-mode
`charge_authorization` transactions using that exact split:

| Gross | Reference | Paystack fee | School subaccount | Integration |
|---:|---|---:|---:|---:|
| 123,400 kobo | `SK-SPLIT-REUSE-1787409489695-1` | 1,851 kobo | 121,549 kobo | 0 |
| 987,600 kobo | `SK-SPLIT-REUSE-1787409490571-2` | 24,814 kobo | 962,786 kobo | 0 |

In both verified transaction payloads, `split.formula.type` was `percentage`,
`share` was 100, and `original_share` equalled the transaction's different
gross amount. This is direct evidence that the split is amount-independent:
**create one percentage split per school and reuse it for every invoice.** A
flat split per invoice amount is rejected.

Cleanup was also verified: both temporary Payment Requests are archived and
the temporary split has zero subaccounts. The two successful test transactions
remain in Paystack's immutable test ledger as the evidence trail.

---

### D1 — The link must be durable, so this is Payment Requests, not `transaction/initialize`.

The obvious cheap build is "display the `authorizationUrl` we already have."
Rejected. A `transaction/initialize` URL is a **checkout session** — Paystack
time-bounds it on their end. The entire premise of sharing over WhatsApp is
asynchronous, delayed action: the bursar sends it at 10am, the parent pays
that evening or on Saturday. A link that may be dead by then is worse than no
link, because it fails silently and looks like the school's fault.

Durable links are a different Paystack product: **Payment Requests**
(`POST /paymentrequest`). Paystack does not return a URL (F3); the verified
customer URL is derived as `https://paystack.com/pay/<request_code>` and is
persisted so the exact shared value is durable and auditable. This is a real,
modest expansion of
`PaystackService` — a new endpoint family, new response shapes, and a new
webhook event — not a UI change.

`PaystackService` today wraps `initializeTransaction`, `verifyTransaction`,
`refund`, `resolveAccount`, `createTransferRecipient`, `transfer`,
`checkBalance`, `getSubaccount`
([paystack.service.ts](../../apps/api/src/common/paystack/paystack.service.ts)).
This adds `createPaymentRequest`, `fetchPaymentRequest`, and
`archivePaymentRequest`.

### D2 — ~~UNVERIFIED~~ **DISCHARGED 2026-08-22. The spike ran; see §2A.**

**Outcome: the expensive branch. `subaccount` does not work; `split_code` does,
which means a Transaction Split per school — see D12.** The five questions
this gate posed are all now answered by F1–F6. The original text is kept below
because the reasoning for gating still applies to the next Paystack surface we
touch, and because three of its five assumptions turned out wrong, which is
the evidence that gating was correct.

#### Original gate text (retained)

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

### D3 — CONFIRMED against a real transaction. The webhook will not correlate.

**Status 2026-08-22: no longer a prediction.** F4 measured it — a real paid
payment request produced reference `T673056755756172`, which
`parsePaystackReference` rejects, so the handler logs and returns while the
school's money sits in their Paystack balance.

**The design, now that the payload shapes are known (F5):**

Handle **`paymentrequest.success`**, whose `data` IS the payment request and
therefore carries our opaque `metadata.schoolKitPaymentLinkId` and
`metadata.schoolId` intact. The payload is HMAC-verified by the existing
`PaystackWebhookGuard`, which is the same trust model the current reference
string already relies on (that string is equally attacker-supplied and equally
protected by the signature).

After entering `withTenant(metadata.schoolId)`, the handler must find the link
by `(id, schoolId)`, require its stored `requestCode` to equal the signed
event's `request_code`, and require the invoice/amount/currency to match before
recording money. Metadata selects the tenant; it is not trusted as the
financial record. The transaction reference in the success payload is then
verified through Paystack before the `Payment` row is written.

There is deliberately no `split_code → school_id` fallback in this first
build. That would need a pre-tenant SECURITY DEFINER lookup, while the measured
`paymentrequest.success` path does not. An unparseable `charge.success` remains
a non-mutating event, but changes from a low-signal warning to an actionable
structured alert carrying only non-PII identifiers. Add a fallback only if
production evidence shows the signed `paymentrequest.success` event is absent.

Router gains a third branch alongside the existing `transfer.*` / `charge.*`
split:

```
event.startsWith("transfer.")       → PayrollService
event.startsWith("paymentrequest.") → PaymentLinksService   ← new
otherwise                           → PaymentsService (unchanged)
```



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

### D4 — ~~needs SECURITY DEFINER #21~~ **WITHDRAWN. No new SD function.**

**Corrected 2026-08-22 by F5.** This decision rested on the SDK's field list
omitting `metadata`, which made a pre-tenant DB lookup the only way to resolve
`request_code → school_id`. The spike shows `metadata` IS accepted and DOES
persist on the payment request, and `paymentrequest.success` carries the
payment request — so the webhook reads a signed `schoolId` directly and never
needs to query before a tenant exists.

**SECURITY DEFINER count stays at 20. Next cadence review stays due at 23.**
No change to `security-definer-inventory.spec.ts` or CLAUDE.md's table.

The fallback path (F5, `split.split_code` on a bare `charge.success`) DOES
need a pre-tenant read, and if it is built it reintroduces the SD function.
Recommendation: build the primary path first and treat an unparseable
`charge.success` as a logged alert rather than a silent return, then add the
fallback only if real traffic shows those events actually arrive. That keeps
the count at 20 unless evidence demands otherwise.

#### Original text (retained — the reasoning was sound given wrong inputs)

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

Idempotency comes from the DB, not from convention: a migration-owned partial
unique index on `(school_id, invoice_id) WHERE status = 'LIVE'`, so "one live
link per invoice" is a constraint the
database enforces even if a future second caller forgets — the same reasoning
[`auth_resolve_student_invitation`](../../CLAUDE.md) uses for putting liveness
in SQL rather than the service layer.

### D6 — A link is bound to an amount, so a balance change must invalidate it.

**Confirmed 2026-08-22 (F6): the archive endpoint exists and works** —
`POST /paymentrequest/archive/:code` → 200, `archived: true`, verified on both
an unpaid and a paid request. This decision is implementable as written.

A Payment Request carries a fixed `amount`. If the bursar shares a link for
₦150,000 and the parent then pays ₦50,000 in cash at the office, the live link
still demands ₦150,000.

Rule: **every committed mutation that changes an invoice's outstanding
balance archives its live link.** That includes manual payments, ordinary
Paystack payments, payment-link payments, refunds/reversals, and future
adjustments that change `totalDue` or `totalPaid`; it is not limited to the new
webhook. The next admin visit mints a fresh one for the new balance. This is why
`archivePaymentRequest` is in scope (D2 item 4) and not deferred — without it,
"one live link per invoice" degrades into "one permanently wrong link per
invoice."

The local row is marked `ARCHIVE_PENDING` in the same database transaction as
the balance mutation. The Paystack archive call happens after commit and is
retryable/idempotent. Until Paystack confirms it, the row remains visibly
`ARCHIVE_PENDING` and its URL is never returned by GET or shared by the UI.
This closes the local stale-link window without pretending an external HTTP
call can participate in the database transaction. A payment that wins the
unavoidable external race is still recorded under D7.

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

**Decision closed 2026-08-22: use a synthetic customer email for every shared
link.** The hosted
payment page displays the CUSTOMER'S EMAIL ADDRESS ("Hey
spike-parent@example.com, Schoolkit has requested…"). A link forwarded through
a WhatsApp group therefore discloses that parent's email to everyone who sees
it — and `PaymentsService.initPaystack` resolves that email from the PRIMARY
GUARDIAN, so it is a real parent's real address, not a synthetic one.

The server generates the link row id first and creates a Paystack customer as
`noreply-payment-<opaque-link-id>@schoolkit.ng`; it never reads or sends the
guardian's email for this flow. `send_notification` is false. Store the
returned Paystack `customer_code` on the link for reconciliation. The address
shown on a forwarded page is therefore non-deliverable and contains no parent
PII; the ordinary guardian-portal payment flow remains unchanged.

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

### D12 — one reusable Transaction Split per school

Forced by F1/F2. `split_code` is the only routing mechanism `/paymentrequest`
honours, and a split is a first-class Paystack object that must be created and
stored, exactly as the subaccount already is.

What this adds, none of which the original estimate contained:

1. Add nullable `School.paystackSplitCode String? @map("paystack_split_code")`.
   It stays nullable through rollout so the schema migration is deploy-safe.
   Link creation requires all three values: enabled flag, subaccount code, and
   split code.
2. Add `PaystackService.createSplit()` and `fetchSplit()`. Creation is fixed:
   `type: percentage`, NGN, one subaccount at share 100, and that subaccount as
   fee bearer. Fetch verification requires active/test-or-live domain parity,
   the expected subaccount, share 100, bearer, and currency before persisting.
3. At assisted-setup fulfilment, the operator supplies the approved
   subaccount code as today. The server verifies it, creates and verifies the
   split, then atomically stores `paystackSubaccountCode`,
   `paystackSplitCode`, `paystackPaymentsEnabled=true`, and fulfilment audit
   state. If the Paystack call fails, nothing is enabled. Retry first searches
   for the deterministic split name/metadata and reconciles it before creating
   another, so an HTTP timeout cannot multiply splits.
4. Existing onboarded schools are handled by a separate idempotent backfill,
   never by SQL migration: dry-run by default; predicate
   `paystackPaymentsEnabled=true AND paystackSubaccountCode IS NOT NULL AND
   paystackSplitCode IS NULL`; one tenant at a time; create/fetch/verify then
   persist and audit. `--apply --school-id` is always required; an explicit
   operator-reviewed school-id manifest drives a batch rather than teaching
   an `app_user` script to bypass RLS for global discovery. A separate
   read-only migration-role census proves the manifest is complete before and
   after rollout. Reruns skip verified rows and reconcile deterministic-name
   remote objects left by a crash. Report counts and opaque ids, never
   bank/customer PII.
5. Replacing or clearing a subaccount also clears/disables its split. A new
   verified split must be created before payments can be re-enabled. The
   assisted-setup runbook and settings validation are updated in this PR so
   drift cannot leave a school apparently connected.

F7 rejects flat splits and proves there is no per-invoice split lifecycle.
The split is school configuration; Payment Requests are invoice lifecycle.

F7 closes the only remaining behavioural unknown. Item 5 is the ongoing
operational cost that does not show up in the happy-path estimate and is why
the drift rule and runbook are part of the build, not a follow-up.

## 3. Data model

New table (name TBD — `payment_links`), FORCE RLS with the standard
`tenant_isolation` policy, declared in the feature migration itself, matching
[the invoices migration](../../packages/db/prisma/migrations/20260630000000_phase_3_slice_6_invoices/migration.sql).

Fields: `id`, `schoolId`, `invoiceId`, `requestId` (Paystack numeric id),
`requestCode`, `hostedUrl`, `paystackCustomerCode`, `amount` (Int, kobo —
never Float), `currency` (`NGN`), `status` (`CREATING` / `LIVE` / `PAID` /
`ARCHIVE_PENDING` / `ARCHIVED` / `CREATE_FAILED`), `createdBy`, `createdAt`,
`archivedAt`, `paidAt`, and bounded non-PII failure/retry timestamps.

`CREATING` is a short-lived reservation created before the Paystack customer
and request calls; it supplies the opaque id used in synthetic email and
metadata and serializes concurrent clicks. A retry reconciles by stored
request/customer ids where present rather than minting another live request.

Partial unique index on `(school_id, invoice_id)` where status = LIVE, plus a
unique on `request_code` (the webhook's lookup key).

Rejected: columns on `Invoice`. A link has its own lifecycle (minted,
archived, re-minted per D6), so it is a row, not an attribute — same reasoning
as [D3 in paystack-assisted-setup.md](paystack-assisted-setup.md).

## 4. Endpoints

| Endpoint | Permission | Notes |
|---|---|---|
| `POST /invoices/:id/payment-link` | `payment.record` | Server computes the current bigint balance; no amount/email accepted. Idempotent per D5. |
| `GET /invoices/:id/payment-link` | `payment.read` | Returns a discriminated state: `LIVE`, `NOT_CREATED`, `CONNECT_PAYSTACK`, or retryable failure; never exposes an archive-pending URL. |
| webhook `paymentrequest.*` | none (HMAC) | Existing `PaystackWebhookGuard`, new router branch per D3. |

Audit: `payment-link.create` and `payment-link.archive`, following the
`AUDIT_*` const convention in
[payments.service.ts:27-29](../../apps/api/src/modules/payments/payments.service.ts).
Every payment-mutating action writes to `audit_logs` — CLAUDE.md's money rule,
no exceptions.

## 5. Admin invoice page

The existing Paystack "pay now" action is left alone. The admin invoice page
adds a separate **Payment link** panel driven entirely by the GET state:

- connected + no link: **Create payment link**;
- live link: read-only URL, Copy, and **Share on WhatsApp**;
- not configured: visible **Connect Paystack first** state linking to
  Settings → Payments (bursars see the instruction even if only an owner/admin
  can complete setup);
- archive pending or retryable failure: explain that the old link is disabled
  and offer a safe retry, never display stale checkout data.

The WhatsApp button opens
`https://wa.me/?text=<encodeURIComponent(server-supplied message fields + URL)>`.
There is no recipient and no guardian phone/email in the API DTO. The server
supplies school name, student display name, exact balance in kobo, and URL;
the client only formats the already-computed amount and message for display.

## 6. Webhook and balance-change transaction shape

`paymentrequest.success` is routed before the existing transfer/charge paths.
After signature validation, metadata selects the tenant; the stored link,
request code, invoice, amount and currency must all agree, and the referenced
transaction is verified with Paystack. In one `FinanceService` transaction:

1. insert `Payment(status=SUCCESS)` with Paystack's transaction reference and
   `recordedBy=link.createdBy`;
2. recompute invoice totals/status using existing money helpers;
3. mark the link `PAID` and archive any other live link defensively;
4. write payment and payment-link audit records.

The existing partial unique Paystack-reference index makes webhook retries a
200 no-op. An amount mismatch, unknown link, wrong request code/currency, or
failed verification records no money and emits a structured alert.

All balance-changing paths call one finance-layer invalidation helper inside
their transaction. After commit, a retryable worker/service archives the
remote Payment Request and advances `ARCHIVE_PENDING → ARCHIVED`. This keeps
the money mutation atomic and external cleanup observable.

## 7. Verification matrix

- `parsePaystackReference` must still reject a Payment Request reference — a
  regression guard on D3's whole premise.
- Webhook routes `paymentrequest.success` to the new handler, `charge.*` and
  `transfer.*` unchanged.
- Idempotency: same `request_code` twice → one `Payment` row (D8).
- No `PENDING` row is ever created by the link flow (D5).
- Live-link uniqueness holds under concurrent creation (D5).
- Every balance-changing path marks a live link archive-pending; successful,
  failed, and retried Paystack archives reach the correct local state (D6).
- Overpayment is recorded, not dropped (D7).
- Missing enabled/subaccount/split configuration is rejected server-side and
  maps to the visible connect state, not just UI-hidden (D11/D12).
- Split unit/contract tests pin percentage 100, the expected sole subaccount,
  subaccount fee bearer, idempotent reconciliation, and no per-invoice split.
- Assisted fulfilment cannot enable payments unless split verification passes;
  subaccount replacement disables/clears the old split.
- Backfill is dry-run by default, narrow, tenant-scoped, audited, idempotent,
  and reconciles a remote object after a simulated crash.
- Synthetic customer tests prove guardian email is never read or sent,
  `send_notification=false`, and metadata contains only correlation ids.
- Webhook rejects cross-tenant/mismatched metadata, request code, amount,
  currency, and unsuccessful verified transactions; a retry writes once.
- Frontend tests pin all four GET states, copy, no-recipient `wa.me`, URL
  encoding, and absence of guardian contact fields.
- RLS: cross-tenant read of `payment_links` returns zero rows; cross-tenant
  insert rejected by `WITH CHECK` **with a valid GUC set**, plus a control
  insert under the correct GUC that succeeds — so the rejection is not passing
  for the wrong reason. Verified as `app_user` against a live DB, per the
  evidence standard the student-portal-auth migration set.
- SECURITY DEFINER inventory stays unchanged at 20 (D4); the standing
  conformance spec proves no undocumented function was introduced.

## 8. Implementation checkpoints (review before code)

**CP1 — school split configuration and rollout seam.** Schema column +
migration; Paystack split create/fetch verification; assisted-setup atomic
creation; settings drift rules; dry-run/idempotent backfill and runbook. Gate:
test mode proves a newly fulfilled school and one existing-school backfill
both persist a verified percentage-100 split before link work can use it.

**CP2 — durable link domain and API.** FORCE-RLS `PaymentLink`, partial live
uniqueness, create/fetch/archive wrappers, synthetic customer, metadata,
idempotent POST and discriminated GET. Gate: real test-mode Payment Request at
two balances routes through the school's persisted split; no parent PII and no
`PENDING Payment` row.

**CP3 — webhook and finance invalidation.** `paymentrequest.*` router,
metadata/Paystack verification, SUCCESS payment transaction, audit,
idempotency, overpayment handling, centralized archive-pending transition and
remote retry. Gate: signed fixture plus test-mode event replay credits exactly
once; all balance-change paths invalidate the old amount.

**CP4 — admin invoice UX.** Durable display, copy, no-recipient WhatsApp share,
and visible connect/retry states. Gate: role/browser tests for owner, admin and
bursar; no contact-data permission widening.

**CP5 — rollout.** Apply migration; deploy API before web; run one-school
backfill and reconcile in Paystack; then all eligible schools; smoke create,
reload, share, test pay, webhook, invoice update and archive. Stop rollout on
any split mismatch, duplicate credit, or unarchived stale amount.

These are checkpoints within one payment-links module PR unless review finds a
reason to split deployment. No checkpoint may expose UI before its server and
money-path gate is green.

## 9. Scope and revised estimate

**In:** one verified percentage split per school, assisted-setup creation and
existing-school backfill, durable link creation/idempotent re-show, synthetic
customer identity, WhatsApp share, paymentrequest webhook correlation,
archive-on-every-balance-change, RLS, audit, retry visibility and rollout.

**Out:** WhatsApp Business API (still deferred). Recipient pre-fill / guardian
phone on finance DTOs. Bulk "share to all debtors" — worth wanting, but it
multiplies every risk above by the size of a class and should follow the
single-invoice path proving itself. Link expiry/reminder scheduling.

**Final estimate — 5 checkpoints, approximately 4–6 focused engineering days
plus deployment observation.** F1/F2 landed on the larger split-management
branch, but F7 removes the per-invoice-split multiplier: creation/backfill is
one external object per school, not one per amount or invoice. The range is
now stable enough to review; no technical estimate fork remains.

**Superseded estimate text:** one slice, *conditional on D2*. If `subaccount` works on
`/paymentrequest`, this is a contained piece of work. If only `split_code` is
accepted, add Transaction Split management per school and re-scope.

**Sequencing:** the spike gates are discharged. Implementation still waits for
explicit approval of this final plan-first.

---

## Superseded re-sequencing recommendation (historical record)

Stated as a recommendation, not a decision.

**What changed:** the feature is no longer "show a link we already generate."
It is a Payment Request integration, a Transaction Split per school with its
own column/migration/backfill/runbook entry, a third webhook branch, and one
untested question (D12 item 4). The economics survive intact (F2), and no new
SECURITY DEFINER function is needed (D4 withdrawn), so the news is not all
bad — but the honest estimate is roughly double the original.

**Against that, the RBAC follow-up is now the common root of three of four
recurring role bugs**, with the fourth its mirror image, and twice in this
sequence one fix has uncovered the next. That work is bounded (~20 call sites
of one helper), touches no external API, and removes a class of bug rather
than adding a surface.

**Recommendation: do the RBAC work first.** Not because payment links are
unimportant — the WhatsApp share is the collection channel Nigerian schools
actually use — but because this spike converted payment links from a
"probably a slice" into a genuinely-sized piece of work with what was then an
open question, while the RBAC work went the other way, from a tidy-up into
something with four bugs of evidence behind it. Doing the bounded, evidence-
backed thing before the newly-doubled, externally-dependent thing is the
lower-variance order.

Payment links now proceed after the RBAC gate landed in PR #204. D12 item 4 is
closed by F7, so this recommendation has served its purpose and no open gate
remains.

## Sources — measured, not consulted

Everything in §2A was observed directly against Paystack's test API on
2026-08-22 with a `sk_test_` key, including one real card payment. The
documentation links below were the ORIGINAL basis for this plan and are
retained only to show where the wrong assumptions came from: Paystack's own
docs 403 automated fetching, so the field lists came from a third-party
OpenAPI-generated SDK, and three of its claims (`subaccount` accepted,
`bearer` accepted, `invoice_url` returned) did not survive contact with the
API.

### Original sources

- [Payment Requests API](https://paystack.com/docs/api/payment-request/) — 403 to automated fetch
- [Split Payments](https://paystack.com/docs/payments/split-payments/)
- [Transaction Split API](https://paystack.com/docs/api/split/)
- [PaystackHQ/documentation — split-payments.md](https://github.com/PaystackHQ/documentation/blob/master/receiving-payments/split-payments.md)
- [alexasomba/paystack-node](https://github.com/alexasomba/paystack-node) — OpenAPI-generated types, the field list's actual source
- [Paystack Webhooks](https://paystack.com/docs/payments/webhooks/)
