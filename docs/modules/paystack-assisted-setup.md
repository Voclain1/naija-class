# Paystack assisted setup

**Status:** plan-first approved 2026-08-15. Not yet implemented.

Cross-cutting initiative, not a numbered Phase — Phase 4 is closed and
Phase 5 is reserved for the AI layer. Permissions get their own
descriptively-named constant (`PAYSTACK_SETUP_PERMISSIONS`) spliced into
`ALL_PERMISSIONS`, per CLAUDE.md's "Permission naming for work that isn't
a numbered Phase".

---

## 1. Why this exists

`School.paystackSubaccountCode` / `paystackPaymentsEnabled` shipped
2026-07-31 (`feat/paystack-subaccount-routing`). That work is correct and
is not being changed here. What it never had was a way for a school to
*obtain* a subaccount code.

Every piece of copy written at the time — the schema comment, the
`PaystackService` header, the settings page help text, and the
`PAYSTACK_SUBACCOUNT_NOT_FOUND` error — tells the school to create a
subaccount in **their own** Paystack dashboard and paste the code. That
is not possible:

- Paystack subaccounts belong to the integration that created them.
- The API authenticates every Paystack call with a single platform-wide
  `PAYSTACK_SECRET_KEY` (`phase-4.md` §8 D4: "single platform key, not
  per-school").
- So a code created under a school's own integration is invisible to
  `GET /subaccount/:code` under ours, and the save-time verification in
  `SchoolsService.patchMe` rejects it with
  `PAYSTACK_SUBACCOUNT_NOT_FOUND` — whose message then tells the school
  to re-check the code "from your Paystack dashboard", sending them back
  round the same loop.

A school following the product's own instructions today cannot turn on
online payments, and has no route out. Manual payment methods (cash,
POS, bank transfer) are unaffected and remain the default for every
school.

The fix is an **assisted setup**: the school submits its banking details
in-app, the platform operator creates the subaccount on SchoolKit's
Paystack integration, and returns the `ACCT_…` code for the school to
paste into the existing settings page.

---

## 2. Decisions

### D1 — Banking details are data-only. They never travel by email.

The notification to `payments@schoolkit.ng` carries **school name,
request id, submitted-at, and a link**. No bank name, no account number,
no contact PII.

`payments@schoolkit.ng` is an ImprovMX *forwarder*, not a mailbox — it
relays to a personal inbox. Banking details sent there would come to rest
indefinitely in an unmanaged consumer mailbox: outside the tenant
boundary, outside `audit_logs`, outside any NDPR control, searchable, and
backed up by a third party. SMTP encryption in transit is opportunistic,
not guaranteed.

**Collection by phone/WhatsApp was considered and rejected.** It is
*less* auditable than the email it would replace, which defeats the
purpose; an account number read aloud and re-keyed is exactly the failure
Paystack rejects on account-name mismatch (and when the mistyped number
happens to be a real account, Paystack accepts it and settles a school's
fees to a stranger); WhatsApp persists the same data on two phones and a
cloud backup; and it adds a human round-trip to every activation.

Structured in-app submission is the same data the school would type into
Paystack's own form if they could. It arrives over TLS, authenticated,
RLS-scoped, and audited.

### D2 — `accountNumber` is stored plaintext, not encrypted.

Precedent decides this. `StaffBankAccount.accountNumber` is plaintext
today (Phase 3 / Slice 12, payroll) — the platform already holds staff
members' *personal* account numbers in the clear. BVN is encrypted
because it is a national identifier, behind `encrypt_bvn`/`decrypt_bvn`.

A school's business account number plus bank name enables paying money
*in*, not taking it out; Nigerian schools routinely print theirs on
invoices for parents. Encrypting a school's own business account while
staff personal accounts sit in plaintext would be inconsistent security
theatre.

If pgcrypto is wanted here, the correct change is to apply it to
`staff_bank_accounts` **and** this table together, as its own PR. Not
blocked on that.

**Required regardless:** the account number is redacted in logs, and
`audit_logs.metadata` stores only the last 4 digits.

### D3 — New table, not columns on `School`.

A request has a lifecycle and can legitimately recur (typo, bank change,
re-submission after rejection), so flat columns on `School` would destroy
history. Same reasoning that gave `NotificationPreference` its own table
(`phase-4.md` §8 D3).

RLS ships inline in the migration, flat `school_id` tenant isolation
(the `grading_schemes` pattern — `packages/db/prisma/policies/` stopped
being maintained after Phase 2).

```prisma
enum PaystackSetupStatus {
  PENDING
  FULFILLED
  REJECTED
}

model PaystackSetupRequest {
  id             String              @id @default(uuid())
  schoolId       String              @map("school_id")
  businessName   String              @map("business_name")
  bankName       String              @map("bank_name")
  accountNumber  String              @map("account_number")
  accountName    String              @map("account_name")
  contactName    String              @map("contact_name")
  contactEmail   String              @map("contact_email")
  contactPhone   String              @map("contact_phone")
  status         PaystackSetupStatus @default(PENDING)
  subaccountCode String?             @map("subaccount_code")
  notes          String?
  submittedBy    String              @map("submitted_by")
  submittedAt    DateTime            @default(now()) @map("submitted_at")
  fulfilledBy    String?             @map("fulfilled_by")
  fulfilledAt    DateTime?           @map("fulfilled_at")

  @@index([schoolId, status])
  @@map("paystack_setup_requests")
}
```

`subaccountCode` is nullable and set at fulfilment (approved
2026-08-15). It records **which code was issued against which request**.
`School.paystackSubaccountCode` remains the operational field the
payment path reads — this is the audit trail of how that value came to
be, not a second source of truth. Nothing reads it to make a decision.

### D4 — Endpoints, and the two-tier read.

**School side** — on the existing schools controller, gated by
`assertUserActiveAndHasOneOf(['owner','admin'])` at the service layer,
matching `patchMe` (that controller has no `PermissionsGuard`; the
Phase-0 retrofit is still deferred).

| Endpoint | Notes |
|---|---|
| `POST /schools/me/paystack-setup-request` | Rejects with `PAYSTACK_SETUP_REQUEST_PENDING` if one is already open (mirrors the "invitation already pending" pattern). Audited `paystack.setup_requested`. |
| `GET /schools/me/paystack-setup-request` | Latest request, so the settings page renders a submitted state instead of an empty form. |

**Platform-admin side** — deliberately split into a browse tier and a
reveal tier.

| Endpoint | Mechanism | Returns |
|---|---|---|
| `GET /platform-admin/paystack-setup-requests` | **SECURITY DEFINER** `platform_admin_list_paystack_setup_requests()` | `request_id, school_id, school_name, business_name, status, submitted_at, contact_name` |
| `GET /platform-admin/paystack-setup-requests/:id/reveal` | `$transaction` + `SET LOCAL app.current_school_id` — **no SD function** | `bankName, accountNumber, accountName, contactEmail, contactPhone`. Audited `paystack-setup.reveal` on **every** call. |
| `PATCH /platform-admin/paystack-setup-requests/:id` | same | FULFILLED/REJECTED + `subaccountCode` + notes. Audited. |

**Why the banking fields are not in the list payload.** The list renders
on page load for every pending request, whether or not the operator is
acting on one. Account numbers there would spray banking data through
server logs, browser memory, and anything visible on screen, on every
visit. A reveal is an intentional act and can be attributed: who looked
at which school's account, when.

This is not a new pattern — it is `BvnService.revealBvn` (Phase 3 /
Slice 12): a separate reveal call, an audit row per invocation, metadata
recording who and for whom but never the value.

### D5 — The subaccount is created by hand in v1.

No `PaystackService.createSubaccount`. The operator has to eyeball the
details anyway; Paystack resolves and displays the account name at
creation, which is a real check that an unattended API call would lose;
and at current volume this is a handful of schools. Adding an automated
write path into a money-routing surface buys no throughput and widens
blast radius.

Revisit when the queue justifies it. Consequence: step 2 of the
onboarding guide is a human action — the school-facing copy already
describes it without claiming a mechanism.

### D6 — Persist first, notify second.

The email goes through `EmailService.send()` (which checks Resend's
`{ error }` and throws — see that file's header for the silent-swallow
bug this replaced). Recipient from
`ConfigService.get("PAYSTACK_SETUP_EMAIL")` with **no silent default**.

If the send fails, or the variable is unset, log an error and **still
return success to the school**. The database row is the source of truth;
a notification failure must never discard a school's submission. The
platform-admin list is the backstop — which is also why the dashboard
view, not the email, is the real notification mechanism (confirmed
2026-08-15). No per-recipient preference or toggle: deliberately
rejected as premature for a single-operator surface.

Subject: `Paystack setup request — <school name>`.

### D7 — Copy corrections shipped in the same PR.

| Location | Fix |
|---|---|
| `apps/web/src/app/(admin)/settings/finance/payments/page.tsx` help text | Replace "Create a subaccount in your own Paystack dashboard" with the request flow |
| `PaystackService.getSubaccount`'s `PAYSTACK_SUBACCOUNT_NOT_FOUND` message | Stop saying "from your Paystack dashboard" |
| `schema.prisma` `paystackSubaccountCode` comment | Asserts the self-serve premise |
| `paystack.service.ts` subaccount-routing header comment | Same |
| `settings/finance/payments/page.tsx` header comment | Same |
| `docs/runbooks/paystack-setup.md` §1 | "under the school's account" → SchoolKit's platform account |

Plus: `PAYSTACK_SETUP_EMAIL` into `.env.example` and CI, and PR #179's
`[payments contact address — TO BE CONFIRMED]` placeholder replaced with
`payments@schoolkit.ng`.

### D8 — Dashboard placement.

The platform-admin UI is a single client component,
`PlatformAdminDashboard`
(`apps/web/src/components/super-admin/platform-admin-dashboard.tsx`),
rendered at `/super-admin/dashboard` — stacked sections, not tabs.

Add a **third stacked section, placed first**, above Schools: *"Pending
Paystack setup requests."* It is the only section representing work
waiting on the operator, and it should be empty most of the time; an
empty state reads as reassurance, not clutter. Schools and Users are
reference tables you browse — this is a queue.

Columns: School · Business name · Contact · Submitted · **Reveal
details** · **Mark fulfilled**. Reveal expands the row in place and
fires the audited call. Fulfilled requests drop out of the default view
behind a "Show fulfilled" toggle.

No new page, no new route, no new nav — extends the component that
already exists, consistent with how early-access and the AI toggle were
added.

---

## 3. SECURITY DEFINER impact

**Count moves 16 → 17.** One new function,
`platform_admin_list_paystack_setup_requests()`.

The cross-tenant list genuinely requires it: `paystack_setup_requests`
is under FORCE RLS, RLS keys off a single `app.current_school_id` GUC,
and one GUC holds one school — "all pending requests across all schools"
is unanswerable as an ordinary `app_user` query. Identical constraint to
`platform_admin_list_schools()` / `platform_admin_list_users()`.

The reveal tier deliberately does **not** get a second function. Once
the list has resolved a school id, a tenant exists, so the GUC works and
RLS governs the read normally — the same division of concerns
`createSchool` already uses (SECURITY DEFINER only for the *pre-tenant*
read).

Inventory row, deliberately omitted column: `account_number`,
`bank_name`, `account_name`, `contact_email`, `contact_phone` — every
field that would turn the browse surface into a banking-data dump.
`business_name` stays: it is the school's own trading name, shown to
parents at Paystack checkout, and is what lets the operator recognise a
request at a glance.

**The "+3" cadence review is done as part of this work.** It has been
flagged as due at 8, then again at 12, 15 and 16 without ever being
carried out. It is not deferred a fifth time.

---

## 4. Tests

- Service specs for submit / duplicate-pending rejection / reveal /
  fulfil.
- **RLS boundary, verified against a live database, not argued:** a
  school cannot read another school's request row under `withTenant`;
  the runtime role cannot read the table without a GUC set; the SD
  function returns rows across tenants while a direct `app_user` select
  returns none.
- `security-definer-inventory.spec.ts` — the new function must appear in
  `SECURITY_DEFINER_FUNCTIONS`, be owned by `school_kit`, pin
  `search_path=public, pg_temp`, and have EXECUTE revoked from PUBLIC.
- `audit-coverage.spec.ts` — registration for `paystack.setup_requested`,
  `paystack-setup.reveal`, `paystack-setup.fulfilled`,
  `paystack-setup.rejected`.
- Audit metadata must never carry the full account number (last 4 only)
  — mirrors `bvn.service.spec.ts`'s equivalent assertion.

---

## 5. Scope

~17–19 files, ~650–850 lines net, plus the overdue SD review. One PR —
a school-side form with no operator surface leaves the same dead end
wearing a nicer hat.

Out of scope, tracked separately: PR #179's live-mode/settlement
confirmation hold is unrelated to this work and is not closed by it.
