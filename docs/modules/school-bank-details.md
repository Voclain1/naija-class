# School bank details — direct transfer as a payment option

Plan-first, now **built and shipped for the admin surfaces** (see §10 for
what is and is not done). Requested 2026-09-11
(Arinzechukwu): *"once the admin fills the account details, and enables it, it
should be visible"* — so parents who prefer a direct transfer to the school's
account have that option alongside Paystack.

Follows the dashboard redesign (#277–#286, all merged). Its immediate trigger
is the per-row WhatsApp share shipped in #285, whose message currently ends
"Please contact the school to settle it" because there is nothing concrete to
offer.

## 1. This is NOT the guarded Paystack account

Two account numbers that are often the same digits and are not the same thing:

| | `PaystackSetupRequest.accountNumber` | This |
|---|---|---|
| Purpose | **Payout** — where SchoolKit routes settlements | **Collection** — where parents transfer |
| Audience | Platform operator | Parents, deliberately |
| Access | Individually-audited reveal, kept out of list surfaces | Displayed on purpose |

CLAUDE.md's SECURITY DEFINER inventory keeps banking detail out of
`platform_admin_list_paystack_setup_requests` because that list renders on
every operator page load. **That guard is unchanged by this work.** What is
added is a separate, school-owned, intentionally-public field. The distinction
is the whole basis for doing this at all, so it should not be collapsed later
into "we already store the school's account number".

## 2. D1 — Four fields, not three

```prisma
bankName           String?  @map("bank_name")
bankAccountName    String?  @map("bank_account_name")
bankAccountNumber  String?  @map("bank_account_number")
bankDetailsEnabled Boolean  @default(false) @map("bank_details_enabled")
```

**The explicit toggle is the safety property, not decoration.** Without it,
"visible once filled" means a half-finished form leaks a wrong or partial
account number to parents the moment someone saves. With it, nothing is shown
until an admin deliberately turns it on.

All three text fields nullable: most schools will never set them, and every
surface must handle absence rather than rendering an empty "pay to:" block.

**D1a — visibility is `bankDetailsEnabled && all three fields present`.** The
toggle alone is not enough; a school that enables it and later blanks the
account number must not show a partial block. Enforce in one shared helper so
the dashboard, the settings preview and the WhatsApp message cannot disagree.

## 3. D2 — The audit gap, verified

`PATCH /schools/me` already audits, and is already owner/admin-only via
`assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"])`. So the gate and the
trail come free.

**But the metadata is field NAMES only:**

```ts
this.updateSchoolWithAudit(authCtx, data, "school.update", reqCtx, {
  changed: Object.keys(data),
});
```

An audit row saying `changed: ["bankAccountNumber"]` records that it changed,
not **from what to what**. For a displayed account number that is not enough:
a fraudulent edit and a legitimate correction produce identical audit rows.

**Decision: capture old → new for the three bank fields specifically.** Not
for every field on the school — `phone` is deliberately omitted from audit
metadata today under the no-PII rule, and widening the whole payload would
reverse that decision as a side effect. A targeted `bankDetailsChange: { from,
to }` entry, added only when one of these three fields is in the patch.

**Why this matters more than it looks.** A displayed account number is a fraud
target with a delayed, quiet failure: change the digits and every parent who
transfers pays an attacker, and nobody notices until reconciliation — by which
point the money is gone and the audit trail says only "the account number was
edited". Old→new is what turns that into an answerable question.

## 4. D3 — Validation

NUBAN account numbers are **exactly 10 digits**. Validate as such rather than
accepting free text: a typo'd account number is money sent to a stranger, and
this is the one field where being strict costs a school nothing.

- `bankAccountNumber`: `/^\d{10}$/`
- `bankName`, `bankAccountName`: trimmed, non-blank when present

**Deliberately NOT doing bank-name resolution against the Paystack banks API.**
It would be nicer, but it adds a live external dependency to a settings save,
and `PaystackSetupRequest` already documents that Paystack verifies account
name against the bank at subaccount-creation time. If the digits are wrong the
transfer fails at the sending bank, which is the same protection a lookup
would give. Worth revisiting if schools report mistyped details in practice.

## 5. D4 — Where it appears

**In scope:**
- **Settings → Finance → Payments** — the form, beside the Paystack config, so
  all payment setup is in one place.
- **Finance dashboard** — a "Pay by transfer" block, shown only when D1a holds.
- **The WhatsApp share message** — as one of the payment options.

**Out of scope for v1: the guardian portal and any public page.** Widening
later is easy; narrowing after parents have seen it is not. The bursar-composed
message and the admin surfaces are enough to answer the original request.

**Widened 2026-09-13: the guardian portal is now in scope** (see §11). Any
public, unauthenticated page remains out of scope.

## 6. D5 — The WhatsApp message's three options

The message currently ends "Please contact the school to settle it". It should
offer what the school actually supports. Each option has a different
readiness, and they are not equally cheap:

| Option | State |
|---|---|
| **Bank transfer** | This document. Available once D1a holds. |
| **Parent portal** | `PORTAL_BASE_URL` is an **API-side env var only** — `apps/web` has no `NEXT_PUBLIC_PORTAL_URL`. See D5a. |
| **Paystack link** | `GET /invoices/:id/payment-link` exists but is **per-invoice and stateful**: `CONNECT_PAYSTACK` / `NOT_CREATED` / `CREATING` / `RETRYABLE_FAILURE` / `LIVE`. See D5b. |

**D5a — expose the portal URL through the API, not a second env var.**
Adding `NEXT_PUBLIC_PORTAL_URL` to `apps/web` duplicates configuration that
already exists server-side, and this project has a documented incident of
exactly that going wrong: recreating the `school-kit-portal` Vercel project
silently dropped every environment variable, and `NEXT_PUBLIC_API_URL` was
missing for five days before a real bug surfaced it. Returning `portalUrl` on
`SchoolMeDto` keeps one source of truth and cannot drift between platforms.

**D5b — fetch the payment link on click, not per row.** The debtor list would
otherwise make one request per row for a link that may not exist. The share
action resolves it at the moment it is needed, and the message simply omits
that line when the state is not `LIVE` — rather than promising a link that
404s.

**D5c — the message stays composed by a person.** It opens WhatsApp with a
draft; the sender picks the conversation and can edit before sending. Nothing
here becomes an automated bulk send. Real bulk WhatsApp needs the WhatsApp
Business API, whose approval state CLAUDE.md still lists as undecided.

## 7. Out of scope

- Bulk WhatsApp (see D5c)
- Bank-name resolution via the Paystack banks API (D3)
- Showing bank details on any public page (D4). The guardian portal was
  brought in on 2026-09-13 — §11.
- Reconciling transfers against invoices — a parent who transfers directly is
  recorded the same way any cash payment is today, through the existing
  Record payment form. **Automatic matching is not part of this.**

## 8. Tests

- **Validation**: a 9-digit and an 11-digit account number are both rejected;
  a 10-digit one is accepted; blank bank name rejected when present.
- **Visibility helper** (D1a): enabled-with-all-three shows; enabled-with-one-
  blank does not; disabled-with-all-three does not. This is the pure function
  worth proving, since three surfaces depend on it agreeing with itself.
- **Audit** (D2), real-Postgres: patching the account number writes an audit
  row containing BOTH the old and new value. Mutation-check it — an assertion
  that only proves a row exists would pass against today's keys-only metadata.
- **Message composition** (D5): omits the Paystack line when the link state is
  not `LIVE`; omits the transfer block when D1a is false; never renders
  "undefined" or a partial account number.
- Repo-wide `pnpm typecheck` and `pnpm lint`, not filtered — a `.js`-extension
  miss in an e2e spec cost a CI cycle on #285 because only the web and api
  workspaces were checked locally.

## 9. Estimate

| Work | Days |
|---|---|
| Migration + DTO + validation + `patchMe` handling | 0.5 |
| Targeted old→new audit (D2) + real-DB test | 0.25 |
| Settings → Finance → Payments form | 0.25 |
| Finance dashboard "Pay by transfer" block + shared visibility helper | 0.25 |
| `portalUrl` on `SchoolMeDto` (D5a) | 0.25 |
| WhatsApp message: three options, on-click link fetch (D5b) | 0.5 |

**Total: ~2 days**, up from the 1–1.5 estimated before D5a and D5b were
investigated — the portal URL and the payment-link state machine are each real
work rather than a string concatenation.

One PR. The migration is additive (four nullable/defaulted columns, no
backfill, no RLS policy change — `schools` is the tenant table and has none),
so it carries none of the "no soak period" risk CLAUDE.md flags for migrations.

## 10. Shipped state (2026-09-11)

**Built:** the migration and four columns; NUBAN validation; the shared
`resolveSchoolBankDetails` visibility helper; the Settings → Finance →
Payments form with its live preview; the finance dashboard "Pay by transfer"
block; targeted old→new auditing on the three bank fields; `portalUrl` on
`SchoolMeDto` (D5a).

**NOT built, and deliberately named here so it is not mistaken for done:**

- ~~**No parent-facing surface exists.**~~ Built 2026-09-13 — see §11.
- **The Paystack link option is not wired into the message.** The builder
  accepts `paymentLinkUrl` and is tested for it, but the debtors page never
  passes one, so D5b's on-click fetch remains unimplemented. Of D5's three
  options, two reach a real message: the portal link and the transfer details.

Both are real, additional scope — tracked as a follow-up, not as polish.

## 11. Guardian portal view (2026-09-13)

**Endpoint: `GET /portal/bank-details`** → `{ bankTransfer: SchoolBankDetails | null }`,
behind `GuardianAuthGuard`. The school id comes from the guardian session;
there is no id in the request to swap.

**D6 — resolved server-side, not in the page.** `SchoolMeDto` carries the raw
four fields because admins edit them. A parent has no such need, so the API
runs `resolveSchoolBankDetails` before responding: a school that has typed an
account number but not switched it on sends `null`, and the digits never
reach the parent's browser — rather than reaching it and being hidden by a
conditional that a future edit could get wrong.

**D7 — its own endpoint, not a field on the invoice list.**
`PortalInvoicesService.listForStudentInTenant` is shared with the student
portal (`StudentPortalService.listFees`), so a field there would have shown
the school's account number to children. The account is also a property of
the school, not of any one child's invoices. The student portal does not get
this endpoint; a student session is refused (401).

**D8 — shown only when something is owed.** The block renders under the
invoices when at least one is `ISSUED`, `PARTIALLY_PAID` or `OVERDUE` — the
status the API returned, so the page does no arithmetic to decide. A failure
on this endpoint hides the block and never the invoices (same treatment as
weekly summaries).

**D9 — the copy says a transfer does not update the invoice.** Card payments
settle automatically; a transfer reaches the ledger only when the school
records it through Record payment (§7: no automatic matching). A parent who
transfers and still sees a balance must have been told that is expected, or
they pay twice. The block also suggests the admission number as the transfer
description, to help the school match it by hand.

**Admin copy corrected in the same PR.** The settings form's preview now reads
"What parents see" and the toggle "Show these details to parents"; the
dashboard's "Pay by transfer" card no longer says there is no portal view.
Those statements were deliberately withheld until this surface existed.

**Tests** (`portal-bank-details.controller.spec.ts`, real Postgres): enabled
and complete returns exactly three fields; disabled and incomplete return
`null` with the stored digits absent from the raw body; no cross-tenant leak;
toggle-off takes effect on the next request; no token and a valid student
token both 401. Leak assertions run before shape assertions so they are the
ones observed failing — proven by a mutation that kept `bankTransfer: null`
while returning the raw row beside it.

**Browser** (`e2e/tests/portal-bank-details.spec.ts`, Chromium, setup through
the real `PATCH /schools/me`): block visible with all three fields and the
admission number beside an `ISSUED` invoice; Copy puts the account number on
the clipboard; after the admin switches it off, a reload shows the invoice
but no block and no digits anywhere in the page HTML; a child whose only
invoice is `PAID` gets no block; the settings page shows the corrected copy.

The settings card also said the Paystack details were "above" it; they render
below. Fixed in the same PR.

**Not covered:** the mobile app's parent screens do not show this yet.
