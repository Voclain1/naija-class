# Phase 3 — finance + first deploy

The phase where the school starts paying. Phase 3 builds the **finance module**
(school → parent fee collection, plus thin payroll and expenses) AND ships the
**first real deployment**, because ARCHITECTURE §9 defines Phase 3's success as
*"first paying customer"* — and you cannot have a paying customer against a
laptop's Docker. Deploy work and finance build run **in parallel** (decision Q1/Q2).

No parent portal yet (Phase 4), no parent-initiated payments yet (Phase 4), no AI
default-prediction yet (Phase 5). Fee collection is **admin/bursar-operated** in
Phase 3: the school records what parents pay (online via Paystack, or cash/POS/
bank-transfer recorded manually). Parents get receipts; they don't log in.

**Locked scope decisions (this phase):**
- **First deploy is in scope** (Q1). No environment exists today; Phase 3 stands one up.
- **Pilot acquisition is operational, not a build deliverable** (Q2) — but pilot *readiness* (data export, onboarding wizard completeness) is flagged (§12).
- **September 2026 is a real deadline** for full working software including finance (Q3). ~3 calendar months from now; the timeline is tight (see §2, §13).
- **Paystack account + Fly.io/Neon/Vercel/R2** are **user-provisioned prerequisites** (Q4/Q5) — each gates the slice that first needs it, not the whole phase.
- **NDPR / NG-only data residency: deferred** until a pilot demands it (Q6). Default hosting is Fly.io Joburg.
- **SaaS subscription billing (school → us) is deferred to Phase 4+** (Q7). Phase 3 is school→parent fee collection only.
- **Thin payroll is in** (Q8) per §6.10 "basic payroll": per-staff salary, deductions, Paystack transfers, payslip PDF, BVN capture, structured qualifications.
- **Online + offline payments** (Q9): Paystack is the online rail; admin records cash/POS/bank-transfer manually (receipt generated, no portal processing).
- **`bursar` role ships** (Q10): finance.* for bursar; admin gets finance minus `billing.delete`.
- **Auth hardening is a prerequisite slice** (Q11) — 2FA, cookie auth, rate-limiting, password policy land *before* the first finance slice ("before finance goes live", phase-0.md:534).

## Sequencing principle (de-risk early)

Slice order front-loads the unknowns and the irreversible-damage surfaces:
- **Render-memory in a fly.io container** — the biggest unvalidated technical unknown — is the *first* pre-deploy work (slice 1).
- **Auth hardening** lands **before any finance slice** (real money raises the auth bar).
- **Audit-log partitioning** lands **before** finance write-volume hits the table.
- **Paystack webhook + reconciliation** — the riskiest finance surface (real money, async, replay) — comes early in the finance subset with idempotency + signature verification built in from day one, not bolted on.

## Acceptance bar (concrete)

A bursar at a deployed pilot school defines a "Tuition" fee category, adds a
₦150,000 tuition FeeItem scoped to JSS levels for First Term, configures a
10%-off multi-sibling discount rule, issues invoices for an arm (each invoice
**freezes** the current fee + discount snapshot), a parent pays online via
Paystack (webhook confirms idempotently), the bursar records a second parent's
cash payment, both get receipts, the debtor list shows who still owes, and the
school runs a month's payroll with Paystack transfers + payslips — all money math
server-side, all of it in `audit_logs`, none of it visible to another school.

## 2. Estimated time

ARCHITECTURE §9 quotes **"3-4 weeks"** for Phase 3 — that was written before the
finance-flexibility requirements (school-defined categories, scoped fees, curated
discount rules, snapshot-on-issue) and before "Phase 3 includes first deploy."
**It is optimistic by a wide margin.**

Realistic estimate, at Phase-2 observed pace (~1 day/cp average, occasionally 1.5):

| | cps | days |
|---|---|---|
| Pre-deploy + auth hardening + partitioning (slices 1-3) | ~5-6 | ~8-10 |
| Finance build (slices 4-14) | ~18-22 | ~26-34 |
| Phase-3 close-out (slice 15) | ~2 | ~3 |
| **Total** | **~25-32** | **~38-48 build days** |

**Calendar check:** mid-June → mid-September 2026 ≈ **65 weekdays**. A 38-48 build-day
budget fits *only if* the Phase-2 pace holds and the two big unknowns (render-memory,
Paystack reconciliation) don't blow up. The remaining ~17-27 weekdays are the buffer
for surprises + ops + pilot prep. If the buffer erodes, the **late slices are the
deferral valve** (§13): expense tracking, dashboard polish, installment plans.

## 3. Slice breakdown

Sequenced to de-risk early (pre-deploy → auth → partitioning → finance core →
Paystack → the long tail → close). `cps` = checkpoints (per-PR units). Day
estimates assume Phase-2 velocity.

| # | Slice | Why it ships independently | cps | Size |
|---|---|---|---|---|
| 1 ✓ | **Pre-deploy infra** — `apps/api/Dockerfile` (Chromium provisioning), **in-container PDF memory gate** (40-card batch on 512MB/1GB), prod DB (Neon/Supabase) + RLS roles, prod R2 bucket, Vercel + Fly.io setup, `staging` env, rollback runbook | Nothing else is safe to deploy until the render-memory unknown is settled and an environment exists. The single biggest technical risk. | 2-3 | 4 days |
| 2 | **Auth hardening** — 2FA (owner), password complexity policy, login + invitation rate-limiting, localStorage → httpOnly cookie auth, Better Auth migration per ADR-001 if needed | "Before finance goes live." Real money raises the auth bar; isolate it before any money endpoint exists. | 2 | 3 days |
| 3 | **Audit-log partitioning** — convert `audit_logs` to `PARTITION BY RANGE(created_at)` monthly, with a partition-creation job; includes a **backfill strategy** (existing `audit_logs` rows distributed into the appropriate monthly partitions during migration — runs as part of the migration; acceptable dev downtime, no prod downtime since prod doesn't exist yet) | Land before finance write-volume hits the table (noted since Phase 0; finance forces it). Pure infra, testable alone. | 1 | 2 days |
| 4 ✓ | **Fee catalog** — `FeeCategory` (school-defined) + `FeeItem` with optional scope (level / arm / term / year), migration, RLS, admin CRUD UI | The flexible fee skeleton everything hangs off. Demoable: a school names its own fees and scopes them. | 2 | 3 days |
| 5 ✓ | **Discount rules** — `DiscountRule` (5 curated rule types, typed jsonb params), per-type server-side eval functions, RLS, admin CRUD UI | Curated flexibility without a DSL. Each rule type tested individually. | 2 | 3 days |
| 6 ✓ | **Invoice generation (snapshot-on-issue)** — `Invoice` with denormalized item+discount snapshot, generation by student's (level, arm, term, year), RLS, admin issue/preview UI | The freeze point — invoices stop tracking live fee/discount edits. The core correctness property. | 2 | 3 days |
| 7 ✓ | **Manual payment recording + receipts** — `Payment` (cash/POS/bank-transfer), receipt generation (**HTML on R2**, signed URL via `GET /payments/:id/receipt`), `computeInvoiceStatus` pure fn, RLS, bursar UI embedded in invoice detail page | Schools can collect + receipt money with zero Paystack dependency. Ships before the online rail. | 2 | 3 days |
| 8 ✓ | **Paystack integration** — init + redirect + **webhook + reconciliation + idempotency keys + signature verification**, `Payment` online path, sandbox integration tests | The meaty, riskiest finance surface — real money, async, replay-safe. | 3 | 5 days |
| 9 | **Installment plans + partial payments** — `PaymentPlan` (+ installment rows), partial-payment allocation against an invoice, status transitions | Nigerian schools commonly take fees in tranches. Builds on the invoice + payment base. | 2 | 3 days |
| 10 | **Debtor list + email reminders** — outstanding-balance query, reminder schedule, **email via Resend** (SMS deferred to Phase 4 — guardians aren't users yet) | The "who owes" operational surface. Email-only keeps it inside Phase-3 channels. | 1 | 2 days |
| 11 | **Refunds** — `Refund` with audit trail, Paystack refund path + manual refund recording, owner/admin-gated | Money leaves the school; the highest-trust mutation. Isolated + heavily audited. | 1 | 2 days |
| 12 | **Basic payroll** — `PayrollItem`, salary structure + deductions, **Paystack transfers**, payslip PDF, staff **BVN capture** + structured qualifications | The "basic payroll" §6.10 line. Pulls in BVN + qualification data-model work. | 3 | 4 days |
| 13 | **Expense tracking** — `Expense` (+ categories), CRUD, RLS, admin UI | Completes the P&L inputs. Smallest finance slice; a deferral candidate if the timeline tightens. | 1 | 2 days |
| 14 | **Finance dashboard** — collections vs target, debtor totals, expense totals, basic P&L (all server-computed) | The owner/admin money view. Read-only aggregation; a deferral/trim candidate. | 1 | 2 days |
| 15 | **Phase 3 close** — `PHASE_3_PERMISSIONS` rollup + `bursar` role wire-up + admin/owner grant updates + idempotent role migration; finance audit-coverage; cross-tenant + bursar-scope E2E; finance manual gates | The slice-9 equivalent for Phase 3. Closes the phase; all gates green. | 2 | 3 days |

Total: **~27-30 cps**, **~48 build days** raw before trimming.

> **Slice 1 closed 2026-06-26.** Staging live at `school-kit-api.fly.dev`.
> Key finding: `school_kit` requires `BYPASSRLS` on Neon for SECURITY DEFINER
> pre-tenant auth functions (`auth_lookup_user_for_login`, `auth_resolve_session`,
> `auth_resolve_invitation_by_token_hash`). Without it, FORCE RLS filters every row
> and login / session resolution return zero rows. See `docs/runbooks/neon-prod-setup.md`.
>
> **Slices 2 and 3 deferred.** Auth hardening and audit-log partitioning tracked in
> `docs/deferred.md`.
>
> **Slice 4 closed 2026-06-28.** Fee catalog with kobo discipline, `formatKobo`
> utility, scope-aware FeeItems.
>
> **Slice 5 closed 2026-06-30.** Manual per-student discount assignment, three types
> (PERCENTAGE/FIXED_AMOUNT/FULL_WAIVER), three durations (TERM/SESSION/LIFETIME).
>
> **Slice 6 closed 2026-07-01.** Invoice generation with snapshot-on-issue semantics,
> preview dry-run, idempotent re-generation.
>
> **Slice 7 closed 2026-07-01.** Manual payment recording, receipt HTML on R2,
> invoice status transitions.
>
> **Slice 8 closed 2026-07-04.** Paystack integration, PSK reference encoding,
> webhook handler, constructor resilience fix.

## 4. Data model

All money is `Int` (kobo) in the DB / `bigint` in TS — never `Float`. Every table
carries `school_id` and gets FORCE RLS with a flat `tenant_isolation` policy
(same discipline as Phases 1-2). Plain-FK convention except where a live lookup
earns an enforced relation (`FeeItem.category`).

### Flexibility tables (the substantive refinement)

```prisma
// School-defined fee taxonomy — NOT a hardcoded enum. Schools name their own
// (Tuition, Development, Hostel, Sports, PTA Levy, Bus Fare, …).
model FeeCategory {
  id          String   @id @default(uuid())
  schoolId    String   @map("school_id")
  name        String
  description String?
  active      Boolean  @default(true)
  createdBy   String   @map("created_by")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  feeItems    FeeItem[]
  @@unique([schoolId, name])
  @@index([schoolId])
  @@map("fee_categories")
}

// A fee, optionally scoped. NULL scope fields mean "applies to all". Invoice
// generation queries by the student's (level, arm, term, year); a FeeItem
// matches a student when each non-null scope field equals the student's value.
//   e.g. Hostel fee for JSS3-SSS3 First Term = several FeeItems (one per level)
//        each with { classLevelId: <level>, termId: <first> }.
model FeeItem {
  id             String   @id @default(uuid())
  schoolId       String   @map("school_id")
  categoryId     String   @map("category_id")
  name           String
  amount         Int                                  // kobo
  classLevelId   String?  @map("class_level_id")      // null = all levels
  classArmId     String?  @map("class_arm_id")        // null = all arms
  termId         String?  @map("term_id")             // null = all terms
  academicYearId String?  @map("academic_year_id")    // null = all years
  active         Boolean  @default(true)
  createdBy      String   @map("created_by")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  category       FeeCategory @relation(fields: [categoryId], references: [id], onDelete: Restrict)
  @@index([schoolId])
  @@index([schoolId, classLevelId, termId, academicYearId])  // generation scan
  @@map("fee_items")
}

// Curated rule types (NOT a general DSL). Each ruleType has a dedicated
// server-side eval function: (invoiceContext, parameters) -> discountAmount.
// parameters is typed + schema-validated per ruleType.
enum DiscountRuleType {
  multi_sibling      // "N+ siblings enrolled = X% off total"
  scholarship        // "flagged students = X% off category/total"
  staff_child        // "staff children = X% off"
  early_payment      // "paid before date Y = X% off"
  category_discount  // "X% off a category for a student tag"
}

enum DiscountValueType { percentage; fixed_amount }
enum DiscountAppliesTo { total; category }

model DiscountRule {
  id          String   @id @default(uuid())
  schoolId    String   @map("school_id")
  name        String
  ruleType    DiscountRuleType @map("rule_type")
  parameters  Json                                   // typed per ruleType (Zod-validated)
  discountType DiscountValueType @map("discount_type")
  value       Int                                    // percent (basis points) or kobo
  appliesTo   DiscountAppliesTo @map("applies_to")
  categoryId  String?  @map("category_id")           // when appliesTo = category
  active      Boolean  @default(true)
  createdBy   String   @map("created_by")
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt @map("updated_at")
  @@index([schoolId])
  @@map("discount_rules")
}
```

### Invoice + payment (snapshot-on-issue)

```prisma
enum InvoiceStatus { DRAFT; ISSUED; PARTIALLY_PAID; PAID; OVERDUE; CANCELLED; REFUNDED }

// SNAPSHOT-ON-ISSUE: `items` denormalizes the fee + discount state AT ISSUE TIME.
// FeeItem / DiscountRule can be edited freely afterward; issued invoices are
// unaffected because they carry the frozen snapshot. (Mirrors the slice-6
// released-report-card snapshot-drift pattern.)
model Invoice {
  id             String   @id @default(uuid())
  schoolId       String   @map("school_id")
  studentId      String   @map("student_id")
  termId         String   @map("term_id")
  academicYearId String   @map("academic_year_id")
  status         InvoiceStatus @default(DRAFT)
  items          Json                                 // [{ categoryName, feeName, amount, discountsApplied:[{ruleName, amount}] }]
  totalAmount    Int      @map("total_amount")        // Σ fee amounts (kobo)
  totalDiscount  Int      @map("total_discount")
  totalDue       Int      @map("total_due")           // amount − discount
  totalPaid      Int      @default(0) @map("total_paid")
  dueDate        DateTime? @map("due_date") @db.Date
  issuedAt       DateTime? @map("issued_at")
  issuedBy       String?  @map("issued_by")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")
  payments       Payment[]
  @@unique([schoolId, studentId, termId])             // one issued invoice per student-term
  @@index([schoolId, status])
  @@map("invoices")
}

enum PaymentMethod { PAYSTACK; CASH; POS; BANK_TRANSFER }
enum PaymentStatus { PENDING; SUCCESS; FAILED; REVERSED }

model Payment {
  id                String   @id @default(uuid())
  schoolId          String   @map("school_id")
  invoiceId         String   @map("invoice_id")
  studentId         String   @map("student_id")
  amount            Int                                // kobo
  method            PaymentMethod
  status            PaymentStatus @default(PENDING)
  paystackReference String?  @map("paystack_reference") // idempotency key for the online path
  paystackData      Json?    @map("paystack_data")
  reference         String?                              // bank transfer ref, POS txn ID, cheque no., etc.
  receiptNumber     String?  @map("receipt_number")      // "RCP-<paymentId-first-8-upper>"; human-readable
  receiptUrl        String?  @map("receipt_url")         // R2 canonical path — signed on demand
  recordedBy        String?  @map("recorded_by")         // set for manual; null for Paystack webhook
  paidAt            DateTime? @map("paid_at")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")
  invoice           Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  // Partial unique — Postgres excludes NULL rows, so manual payments (paystackReference = null) can coexist.
  @@unique([schoolId, paystackReference])              // webhook idempotency
  @@index([schoolId, invoiceId])
  @@index([schoolId, studentId])
  @@map("payments")
}

model PaymentPlan {
  id           String   @id @default(uuid())
  schoolId     String   @map("school_id")
  invoiceId    String   @map("invoice_id")
  name         String
  createdBy    String   @map("created_by")
  createdAt    DateTime @default(now()) @map("created_at")
  installments PaymentPlanInstallment[]
  @@index([schoolId, invoiceId])
  @@map("payment_plans")
}

model PaymentPlanInstallment {
  id        String   @id @default(uuid())
  schoolId  String   @map("school_id")
  planId    String   @map("plan_id")
  amount    Int                                        // kobo
  dueDate   DateTime @map("due_date") @db.Date
  paid      Boolean  @default(false)
  plan      PaymentPlan @relation(fields: [planId], references: [id], onDelete: Cascade)
  @@index([schoolId, planId])
  @@map("payment_plan_installments")
}

model Refund {
  id            String   @id @default(uuid())
  schoolId      String   @map("school_id")
  paymentId     String   @map("payment_id")
  amount        Int                                    // kobo
  reason        String
  status        String                                 // REQUESTED / PROCESSED / FAILED
  paystackRefundRef String? @map("paystack_refund_ref")
  processedBy   String   @map("processed_by")
  createdAt     DateTime @default(now()) @map("created_at")
  @@index([schoolId, paymentId])
  @@map("refunds")
}
```

### Payroll + expenses

```prisma
enum PayrollStatus { DRAFT; APPROVED; PAID; FAILED }

model PayrollItem {
  id              String   @id @default(uuid())
  schoolId        String   @map("school_id")
  userId          String   @map("user_id")            // staff
  payPeriod       String   @map("pay_period")         // e.g. "2026-09"
  grossSalary     Int      @map("gross_salary")       // kobo
  deductions      Json                                 // [{ name, amount }] incl. PAYE estimate
  netSalary       Int      @map("net_salary")
  status          PayrollStatus @default(DRAFT)
  paystackTransferRef String? @map("paystack_transfer_ref")
  payslipUrl      String?  @map("payslip_url")         // R2
  processedBy     String   @map("processed_by")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")
  @@unique([schoolId, userId, payPeriod])
  @@index([schoolId, payPeriod])
  @@map("payroll_items")
}

model Expense {
  id          String   @id @default(uuid())
  schoolId    String   @map("school_id")
  category    String                                   // free-text or a small ExpenseCategory table (TBD slice 13)
  amount      Int                                      // kobo
  description String?
  incurredAt  DateTime @map("incurred_at") @db.Date
  receiptUrl  String?  @map("receipt_url")             // R2
  recordedBy  String   @map("recorded_by")
  createdAt   DateTime @default(now()) @map("created_at")
  @@index([schoolId, incurredAt])
  @@map("expenses")
}
```

**Additions to existing models (slice 12 payroll):** `User` (or `TeacherProfile`)
gains an encrypted/redacted **BVN** field; `TeacherProfile.qualifications` moves
from free-text to a structured array (phase-1.md:371,1261). BVN is high-sensitivity
PII — redacted by the logger, never returned in list responses.

## 5. API endpoints (per slice)

Indicative — finalized at each slice's plan-first.

```
# Slice 4 — fee catalog
GET/POST/PATCH/DELETE  /fee-categories[/:id]
GET/POST/PATCH/DELETE  /fee-items[/:id]

# Slice 5 — discount rules
GET/POST/PATCH/DELETE  /discount-rules[/:id]

# Slice 6 — invoices
POST   /invoices/arm/generate            — body: { termId, classArmId } — issue snapshot invoices for an arm
GET    /invoices?termId=&classArmId=&status=
GET    /invoices/:id
POST   /invoices/:id/cancel

# Slice 7 — manual payments + receipts
# Controller declaration order: list → POST /manual (static) → GET /:id → GET /:id/receipt
POST   /payments/manual                  — body: { invoiceId, amount (kobo), method, paidAt, reference? }
GET    /payments?invoiceId=&studentId=&page=&limit=
GET    /payments/:id
GET    /payments/:id/receipt             — → { url: string; expiresAt: Date } (signed R2 URL, 15-min TTL)

# Slice 8 — Paystack
POST   /payments/paystack/init           — body: { invoiceId, amount } → { authorizationUrl, reference }
POST   /payments/paystack/webhook        — Paystack → us; signature-verified, idempotent
GET    /payments/paystack/verify/:reference

# Slice 9 — installments
POST   /payment-plans                    — body: { invoiceId, installments: [...] }
GET    /payment-plans?invoiceId=

# Slice 10 — debtors
GET    /finance/debtors?termId=
POST   /finance/debtors/remind           — body: { studentIds } — email via Resend

# Slice 11 — refunds
POST   /refunds                          — body: { paymentId, amount, reason } (owner/admin)

# Slice 12 — payroll
GET/POST/PATCH  /payroll[/:id]
POST   /payroll/:id/transfer             — Paystack transfer
GET    /payroll/:id/payslip              — signed R2 URL

# Slice 13 — expenses
GET/POST/PATCH/DELETE  /expenses[/:id]

# Slice 14 — dashboard
GET    /finance/dashboard?termId=        — collections vs target, debtors, expenses, P&L
```

## 6. UI screens — web (admin / bursar)

No mobile in Phase 3 (parent app is Phase 4). New screens under `(admin)` and a
new `(bursar)` surface (or a Finance section gated by role).

- `/settings/finance/fees` — fee category + FeeItem editor (with the scope picker: level / arm / term / year).
- `/settings/finance/discounts` — discount-rule builder (pick a curated type, fill typed params).
- `/finance/invoices` — generate per arm, preview the snapshot, issue, cancel; per-invoice detail with the frozen line items.
- `/finance/payments` — record manual payment, view/print receipt; Paystack status.
- `/finance/debtors` — outstanding list + send-reminder action.
- `/finance/payroll` — salary run, deductions, transfer, payslip.
- `/finance/expenses` — expense CRUD.
- `/finance/dashboard` — collections vs target, debtors, expenses, P&L.
- `/settings/security` — 2FA enrolment (slice 2).

States: loading skeletons, empty (no fees defined / no debtors), Paystack-pending,
manual-vs-online payment distinction, snapshot "this invoice reflects fees as of
<issuedAt>" banner.

## 7. Hard rules — Phase 3 specifics

- **Money is `Int` kobo / `bigint` TS, never `Float`.** Format to naira only at the display layer. (CLAUDE.md money rule — the load-bearing one for an entire finance phase.)
- **Never compute fees, discounts, or balances in the frontend.** The API returns the numbers; the UI displays them. Discount evaluation, invoice totals, balances, payroll net — all server-side.
- **Every payment-mutating action goes through a single `FinanceService` and writes to `audit_logs`. No exceptions, including admin overrides and refunds.**
- **Bursar scope leaks within-school, not across.** RLS isolates by school; the bursar role + service-layer gates keep finance reads/writes inside the school. Cross-tenant is structurally impossible (RLS); within-school over-reach is the review surface — every finance endpoint is a security-review target, and slice 15 E2E includes a bursar-scope negative walk.
- **Paystack webhooks are idempotent + signature-verified.** A duplicate or out-of-order webhook never double-credits an invoice; an unsigned/forged webhook is rejected. The `payments.paystack_reference` unique is the idempotency guard.
- **Snapshot-on-issue is inviolable.** An issued invoice never silently changes when a fee or discount rule is later edited.
- **BVN is high-sensitivity PII.** Stored encrypted at rest (column-level encryption or `pgcrypto`), redacted in all log output, never returned in list responses, and only returned to the staff member themselves or to owner+admin on an explicit view. Any access is audited.

- **BVN encryption mechanism (locked).** Symmetric encryption via Postgres
  `pgcrypto` (`pgp_sym_encrypt` / `pgp_sym_decrypt`); plaintext never leaves the
  DB process. The encryption key is a Fly.io secret (`BVN_ENCRYPTION_KEY`), made
  available to the runtime via `SET LOCAL app.bvn_key = '<key>'` per connection
  (same pattern as `app.current_school_id`). Encrypt/decrypt wrapped in two
  SECURITY DEFINER functions (`encrypt_bvn`, `decrypt_bvn`) so `app_user` never
  sees the key directly — the SD inventory grows from 4 → 6 at slice 12, which
  **triggers the deferred SD-inventory refactor** ("If this list grows past 5,
  refactor" — CLAUDE.md). Refactor lands in the same PR as the BVN columns. **Key
  rotation:** a single audited migration tx that decrypts with the old key + re-
  encrypts with the new one. **Key loss = data loss:** BVNs cannot be recovered
  if the key is destroyed; schools re-enter them. Documented trade-off vs paid
  KMS, revisit at Phase 4+ when paying customers absorb the ~$1/month/key.

## 8. RBAC additions

Mirrors the Phase-2 slice-9 rollup machinery (`PHASE_3_PERMISSIONS` flat const +
`PHASE_3_OWNER_ONLY_PERMISSIONS` + seed-data grants + idempotent role migration +
`permissions-coverage` spec).

| Role | Phase 3 grant |
|---|---|
| `owner` | `["*"]` — unchanged; includes `billing.delete`. |
| `admin` | all finance permissions **except** `billing.delete` (the owner-only hard-delete of finance records — refunds/cancels are sensitive but allowed; destructive deletion is owner-only, per ARCHITECTURE "admin.* — all except billing.delete"). |
| **`bursar`** (NEW) | `finance.*` only — fee/discount/invoice/payment/payroll/expense/dashboard read+write, **minus** `billing.delete`. No academic, roster, or settings access. |

Indicative permission strings: `fee-category.*`, `fee-item.*`, `discount-rule.*`,
`invoice.read/issue/cancel`, `payment.read/record`, `payment.refund`,
`payroll.read/process`, `expense.*`, `finance.dashboard.read`, `billing.delete`
(owner-only). `@Permissions` on every finance endpoint (defence-in-depth atop the
service role+scope gate), guarded by `permissions-coverage.spec.ts`.

## 9. Audit additions

- **New actions** (singular-resource.verb): `fee-item.create/update/delete`,
  `fee-category.*`, `discount-rule.*`, `invoice.issue`, `invoice.cancel`,
  `payment.record`, `payment.paystack-confirm` (webhook), `refund.create`,
  `payroll.process`, `payroll.transfer`, `expense.*`. Bulk ops write one row with
  counts. Locked by an extended `audit-coverage.spec.ts` (slice 15).
- **Audit-log partitioning (slice 3):** convert `audit_logs` to
  `PARTITION BY RANGE (created_at)` with monthly partitions + a partition-creation
  job (e.g. a cron creating next month's partition). Noted since Phase 0; finance
  write-volume is what finally forces it. Lands **before** finance writes hit.

## 10. Pre-deploy slice content (slice 1)

The slice-1 deliverable, drawn from `docs/deferred.md` + phase-2.md §Deployment:
- **`apps/api/Dockerfile`** — multi-stage; provisions Chromium + the system libs
  (the exact list in phase-2.md:540) + a font (`fonts-liberation`) for the WAEC
  grid; decides binary source (puppeteer-cached vs distro chromium).
- - **In-container PDF memory gate + fallback decision tree.** Run the 40-card
  batch in-container against successive tiers; commit to the cheapest that
  passes. **Tier 0:** 512MB Fly machine. PASS if peak RSS < 70% of 512MB (358MB).
  **Tier 1:** 1GB Fly machine. PASS if peak RSS < 70% of 1GB (716MB). **Tier 2:**
  separate `school-kit-render-worker` Fly app (2GB, `auto_stop_machines=true`,
  `min_machines_running=0`), consuming the `report-card.render` BullMQ queue
  from the API. Scale-to-zero between batches keeps marginal cost near nil.
  **Tier 3 (deferred, not chosen):** external Chromium-as-a-service (Browserless
  et al.) — only revisit if Tiers 0-2 all fail, which would indicate a Puppeteer
  leak rather than a capacity issue. Decision is mechanical at the gate; the
  pivot to Tier 2 (separate worker) is the only one that changes slice 1b's
  shape (adds the second Fly app + the queue split), so the gate runs FIRST in
  slice 1a.
- **Prod DB** (Neon or Supabase) with the `app_user` / `school_kit` role split + RLS.
- **Prod R2** bucket + credentials; **Vercel** (web) + **Fly.io** (api, Joburg) projects.
- **`staging` environment** (WORKFLOW: staging auto-deploys, soak before main).
- **Prod secrets** via platform (Fly.io secrets / Vercel env); verify `ConfigModule`
  handles no-`.env`-present.
- - **Rollback runbook + smoke test (5-op, auto-rollback on any non-2xx).** Smoke
  test, run by GitHub Actions after each `flyctl deploy`:
  1. `GET /health` → 200 — process up
  2. `GET /health/db` → 200 with `role: "app_user"` — DB up, RLS role correct
     (not accidentally connected as `school_kit`)
  3. `POST /auth/signup-owner` with a timestamp-suffixed email → 201 — full
     signup tx works (School + User + UserRole + Session + audit_log + class-
     level seed + grading-scheme seed commit atomically; signup-uniqueness SD
     function works)
  4. `POST /auth/login` with the new credentials → 200 with access token —
     password verification + session creation + `auth_lookup_user_for_login`
     SD function work
  5. `GET /schools/me` with the bearer token → 200 with the right schoolId —
     post-tenant bearer auth + `withTenant()` + RLS all work; cross-tenant leak
     would surface here
  Any non-2xx triggers `flyctl releases rollback`. Smoke schools accumulate
  with a `smoke-<timestamp>` slug pattern, cleaned by the dev-seed prune task.
  Rollback runbook covers three failure classes: deploy failure (Fly never
  finishes), migration failure (Fly finishes, smoke step 3 fails on a missing
  table), data-corruption failure (smoke passes, manual incident — runbook
  links to backup-restore from Neon's point-in-time recovery).
- **Sentry source-map upload** + `SENTRY_AUTH_TOKEN` in CI.
- **Dev DB cleanup** (~100 accumulated test schools) before any pilot data lands.
- **Email provider** (Resend or alternative) — provisioned during **slice 10**
  (debtor reminders), not slice 1; the account + API key are needed before the
  slice-10 build, not before deploy.

## 11. Auth hardening slice content (slice 2)

"Before finance goes live" (phase-0.md:534). Lands before slice 4.
- **2FA for owners** (TOTP enrolment + verification).
- **Password complexity policy** beyond min-length.
- **Rate-limiting** on `POST /auth/login` (per-IP + per-email lockout) and on
  `GET/POST /invitations/:token`.
- **localStorage → httpOnly cookie auth** (closes the XSS-session-takeover gap;
  unlocks Next.js middleware route protection).
- **Better Auth migration** per ADR-001 — evaluate at the slice's plan-first
  whether to migrate now (the 2FA + cookie work is exactly its "revisit when")
  or to hand-roll TOTP + cookies on the existing bearer surface. ADR to be
  updated with the decision.

## 12. Pilot onboarding considerations (operational — flagged, not built)

Not build deliverables, but kept on radar so they don't surprise the launch:
- **Data export** — a pilot will want their data out; ensure an export path exists
  (or note it as a fast-follow). NDPR data-portability adjacency.
- **Onboarding wizard completeness** — the §6.2 setup wizard (school profile →
  year/terms → levels → subjects → import students → import teachers → **fee
  structure** → done) now has a fee-structure step that Phase 3 makes real.
  Verify the wizard reaches "school can collect a fee" end-to-end.
- **Owner-conversation cadence** — WORKFLOW wants 3 school-owner conversations
  before launch, captured in `docs/customer-conversations/`. Operational, but the
  curated discount-rule set + fee-scope flexibility should be validated against at
  least one real fee sheet before slice 5/6 lock.

## 13. Risks and how slice ordering mitigates them

- **Render-memory in a fly.io container is unvalidated.** Mitigation: it's
  **slice 1** — settled before anything depends on a deploy; external-render
  fallback is the escape hatch.
- **Paystack webhook reliability + reconciliation correctness.** Out-of-order
  delivery, duplicate webhooks, network failure mid-init. Mitigation: idempotency
  keys (`payments.paystack_reference` unique) + signature verification **from day
  one** (slice 8), integration tests against the Paystack **sandbox**, and a
  reconciliation/verify endpoint so a missed webhook self-heals.
- **Audit-log volume from finance writes.** Mitigation: partitioning is **slice 3**,
  before finance writes land.
- **Money correctness across async flows** (webhooks out of order, duplicate
  delivery, partial-payment allocation). Mitigation: all money math server-side +
  audited; the `FinanceService` funnel; status state machines on Invoice/Payment;
  sandbox integration tests.
- **"No pilot signal" risk** — building flexibility nobody asked for. Mitigation:
  curated discount **rule types** (not a DSL) — flexibility ships with *constrained*
  variation; the DSL is deferred until demand is real. **Validate the curated
  discount-rule set against at least one real Nigerian school fee sheet before the
  slice-5 plan-first locks.** The flexibility ships with constrained variation, but
  the variation constraint itself needs one ground-truth check.
- **3-month timeline vs ~30+ build-day scope.** Mitigation: the **late slices are
  deferral valves** — expense tracking (13), dashboard polish (14), installment
  plans (9) can slip past September without blocking "a school collects fees."

## 14. Deferred to later phases

Specific, not vague:
- **Parent portal + parent mobile app** — Phase 4.
- **Parent-initiated payments + parent OTP / parent auth** — Phase 4.
- **SMS payment reminders via Termii** — Phase 4 (guardians aren't users yet; Phase 3 reminders are email-only via Resend).
- **AI default-prediction + auto-drafted reminder tone** — Phase 5.
- **Full discount-rule DSL** — Phase 4+ only if pilot demand emerges; Phase 3 ships the 5 curated types.
- **SaaS subscription billing (school → us; per-student vs flat)** — Phase 4+; needs the pricing-model decision (ARCHITECTURE open-Q #1).
- **Promotion engine** — held until the first school finishes a 3-term year on-platform (not fired).
- **Cumulative position across terms** — same trigger (not fired).
- **Per-school report-card template customization** — held until a pilot rejects the default.
- **Per-level / per-subject grading schemes** — held until a school needs SSS-science weight differences.
- **Bulk export / archiving of report cards (zip)** — held until an end-of-year archive request.
- **Dedicated `principal` role** — held until the first pilot asks (Phase 2 maps to owner+admin).
- **NG-only data residency** — held until a pilot demands it; default is Fly.io Joburg.
- **GPS transport / library / hostel / behaviour** — Phase 7.

## 15. Acceptance criteria — the bar for "Phase 3 done"

1. **Every slice closed via the cp pattern** (plan-first → build → manual gate → commit → PR → merge).
2. **Production deployment live** (or staging-validated and ready for prod), with the rollback runbook + smoke test.
3. **A pilot school can be onboarded** end-to-end (operational readiness: wizard reaches "collect a fee", data export path exists).
4. **All money math is server-side and audited**; money types are `Int` kobo throughout (no float drift) — verified by service unit tests.
5. **Snapshot-on-issue holds** — editing a FeeItem/DiscountRule after issuance does not change an issued invoice (integration test).
6. **School-defined flexibility works** — a school names its own categories, scopes fees by level/arm/term/year, and applies each of the 5 curated discount types (integration tests per rule type).
7. **Paystack webhook handling is idempotent + signature-verified** — duplicate/forged/out-of-order webhooks don't corrupt balances (sandbox integration test).
8. **Manual + online payments both produce receipts**; debtor list reflects outstanding balances.
9. **Basic payroll** runs: salary + deductions → net, Paystack transfer, payslip PDF; BVN captured + redacted in logs.
10. **`audit-coverage.spec.ts` extended for `finance.*`** — every finance mutation writes its row.
11. **Cross-tenant E2E extended for finance** — School B cannot read/write School A finance; **bursar-scope** negative walk passes.
12. **Every finance endpoint carries `@Permissions`**; **`bursar` role grants verified** via `permissions-coverage.spec.ts`; `billing.delete` is owner-only.
13. **Audit-log partitioning live** — `audit_logs` partitioned by month, partition-creation job running.
14. **Render-memory in-container gate passes** (or external-render fallback confirmed working).
15. **Auth hardening complete** — 2FA, cookie auth, password policy, rate-limiting; ADR-001 updated.
16. **SECURITY DEFINER count** accounted for (was 4 at Phase-2 close; any new function triggers the deferred inventory refactor).

---

*Per-slice plan-firsts happen as each slice approaches — this doc is the phase
map, not the slice specs. Slice 1's plan-first is the next planning step.*

## 17. Slice 8 plan-first decisions (locked 2026-07-02)

These decisions were finalized at the plan-first and are building constraints for
CP1/CP2/CP3. Reopen only if a concrete blocker surfaces.

**D1 — Initiation actor: bursar-initiated.**
`POST /payments/paystack/init` is auth-gated (`payment.record`). The bursar clicks
"Pay via Paystack" on the invoice detail page; the API returns `{ authorizationUrl,
reference, paymentId }` and the frontend opens `authorizationUrl` in a new browser
tab. Phase 3 is admin-operated — parents are not users yet (Phase 4). The bursar
can complete the checkout on the school's computer or share the URL with the parent.

**D2 — Customer email for Paystack init: server-resolved, not passed from frontend.**
Paystack's `/transaction/initialize` requires a customer email. The init endpoint
accepts no `customerEmail` field. The service loads the student's primary guardian
email from the DB (within the same `withTenant` context). If no guardian email
exists, synthetic fallback: `noreply-{paymentId.slice(0,8)}@schoolkit.ng`. Keeps
the init DTO minimal; avoids the frontend needing to know the guardian data model.
Auto-populate from guardian is a UX refinement for a later slice once guardian
email capture is standard.

**D3 — Paystack reference format: `PSK-{schoolId}-{paymentId}`.**
Total length: 78 chars (within Paystack's 100-char limit). The payment row is
created FIRST (to obtain `paymentId`), then Paystack is called with this reference.
The webhook handler extracts `schoolId` from the reference string (chars 4–39),
calls `withTenant(schoolId)`, and looks up the payment by `paystackReference` — no
cross-tenant DB lookup, no new SECURITY DEFINER function (count stays at 5). If
the reference cannot be parsed (malformed), the webhook handler returns `200` silently.

**D4 — Webhook endpoint: separate `PaystackController`, no class-level AuthGuard.**
`POST /payments/paystack/webhook` must be public — Paystack has no bearer token.
NestJS method-level `@UseGuards()` ADDS to class-level guards, not replaces them.
A dedicated `PaystackController` at `@Controller("payments/paystack")` has no
class-level guards. The webhook method carries `@UseGuards(PaystackWebhookGuard)`
only. The `init` and `verify` methods carry their own `@UseGuards(AuthGuard,
PermissionsGuard)`. `PaymentsController` is unchanged. `PaystackController` is
registered in `PaymentsModule`.

**D5 — Raw body preservation for webhook signature: `rawBody: true` in bootstrap.**
Paystack computes `x-paystack-signature` as HMAC-SHA512 over the raw request body.
NestJS's JSON middleware destroys the raw bytes before the handler sees them.
Fix: `NestFactory.create(AppModule, { rawBody: true })` in `main.ts`. NestJS 10
exposes `req.rawBody` (Buffer) when this flag is set. `PaystackWebhookGuard` reads
`req.rawBody`, computes HMAC-SHA512 with `PAYSTACK_SECRET_KEY`, and compares to the
header. If `PAYSTACK_SECRET_KEY` is missing or the signature does not match, the
guard throws `UnauthorizedException` — **fail closed**. JSON parsing of `req.body`
is unaffected for all other endpoints.

**D6 — Webhook idempotency: status check before processing.**
When `charge.success` arrives:
1. Parse `schoolId` from reference. If parse fails, return `200` silently.
2. `withTenant(schoolId)`: find payment by `paystackReference`.
3. If not found, return `200` silently (the init might have failed before the row was written).
4. If `payment.status === 'SUCCESS'`, return `200` immediately — idempotent skip.
5. If `payment.status === 'FAILED'`, log a warning, return `200` — do not re-confirm.
6. If `payment.status === 'PENDING'`, apply `applyPaystackSuccess()`.
The `@@unique([schoolId, paystackReference])` DB constraint is the second layer.
Duplicate rows are structurally impossible; the status check handles replay.

**D7 — `charge.failed` handling.**
Update payment to `FAILED`. Do NOT touch invoice `totalPaid` (FAILED rows are
excluded from the recompute aggregate). Audit log: `payment.paystack-failed`. Return
`200 { status: "ok" }` unconditionally — returning non-2xx to Paystack triggers
retries. A failed payment leaves the invoice in its prior state; the bursar can
initiate a new Paystack payment or switch to manual.

**D8 — Verify endpoint: self-heal for missed webhooks.**
`GET /payments/paystack/verify/:reference` — auth-gated (`payment.read`). Calls
Paystack `/transaction/verify/:reference`. If Paystack returns `success` and the
local payment is `PENDING`, the service applies `applyPaystackSuccess()` — the same
helper used by the webhook handler. If Paystack returns `failed`, throws a
`ConflictError`. If already `SUCCESS`, returns the current `PaymentDto` unchanged.
This self-heals the case where the webhook was missed (ngrok not running, network
failure, infra restart during checkout).

**D9 — `paidAt` for Paystack payments.**
Derived from `data.paid_at` in the Paystack webhook event (ISO string). If absent
(Paystack verify path), use `new Date()`. Stored on the payment row; used in the
receipt HTML.

**D10 — Shared success helper: no logic duplication between webhook and verify.**
Both `handleWebhook` (on `charge.success`) and `verifyPaystack` (on remote success)
call a private `applyPaystackSuccess(db, payment, paystackData, paidAt)`. This helper:
1. Updates payment: `status → SUCCESS`, `paystackData`, `paidAt`.
2. Recomputes `totalPaid` via aggregate (identical to `recordManual` pattern, D2 in §16).
3. Computes new invoice status via `computeInvoiceStatus`.
4. Updates invoice.
5. Generates receipt HTML and uploads to R2.
6. Persists `receiptNumber` + `receiptUrl` on payment row.
7. Writes audit log: `payment.paystack-confirm`.
One path, tested once, used twice.

**D11 — New permissions: none.**
`init` uses existing `payment.record`; `verify` uses `payment.read`. The webhook is
public. `payment.paystack-confirm` is an audit action string, not a permission — no
changes to `PHASE_3_PERMISSIONS`.

**No schema migration needed.** `paystackReference`, `paystackData`,
`PaymentMethod.PAYSTACK`, `PaymentStatus.PENDING/FAILED` all exist on the `Payment`
model from slice 7. The `@@unique([schoolId, paystackReference])` index exists.

**CP breakdown:**

- **CP1** — `PaystackService` + `PaystackWebhookGuard` + types (~3 hours):
  - `apps/api/src/common/paystack/paystack.service.ts` — wraps Paystack API with
    native `fetch` (Node 22); methods: `initializeTransaction({ amount, email,
    reference, metadata? })`, `verifyTransaction(reference)`, `verifyWebhookSignature(rawBody: Buffer, signature: string): boolean` (pure HMAC, no network).
  - `apps/api/src/common/paystack/paystack.module.ts`
  - `apps/api/src/common/paystack/paystack-webhook.guard.ts` — reads `req.rawBody`,
    computes HMAC-SHA512, compares to `x-paystack-signature` header; fails closed if
    `PAYSTACK_SECRET_KEY` unset.
  - `main.ts`: add `rawBody: true` to `NestFactory.create()`.
  - `PaystackModule` imported into `AppModule`.
  - New Zod schemas in `packages/types/src/finance/payment.dto.ts`:
    - `initPaystackPaymentSchema` / `InitPaystackPaymentInput`: `{ invoiceId: uuid, amount: int.positive }`
    - `PaystackInitResponseDto`: `{ authorizationUrl: string; reference: string; paymentId: string }`
  - Unit spec `paystack.service.spec.ts`: correct key passes, wrong key fails,
    tampered body fails (3 tests on the pure HMAC path — no network mock needed).

- **CP2** — `PaymentsService` Paystack methods + service spec (~4 hours):
  - `PaymentsModule` imports `PaystackModule`; `PaystackService` injected into `PaymentsService`.
  - Three new public methods:
    - `initPaystack(authCtx, dto)`: validate invoice → overpayment guard → create PENDING
      payment row → resolve customer email (guardian lookup, then synthetic fallback) →
      build reference `PSK-{schoolId}-{paymentId}` → call `paystackService.initializeTransaction()`
      (if Paystack throws, update row to FAILED + rethrow) → update row with `paystackReference`
      → return `PaystackInitResponseDto`.
    - `handleWebhook(event)`: switch on `event.event`; for `charge.success` / `charge.failed`
      parse schoolId, `withTenant`, idempotency check, dispatch to `applyPaystackSuccess` or
      `applyPaystackFailed`. Unknown event types: return silently (Paystack sends many event types).
    - `verifyPaystack(authCtx, reference)`: extract schoolId from reference →
      call `paystackService.verifyTransaction()` → `withTenant` → dispatch to helper or return as-is.
  - Two private helpers: `applyPaystackSuccess(db, payment, paystackData, paidAt)` (the
    recompute-receipt-audit chain) and `applyPaystackFailed(db, payment)` (update + audit).
  - Service spec additions (~15 tests):
    - `initPaystack`: happy path, invoice not found, CANCELLED invoice, overpayment, Paystack API error.
    - `handleWebhook`: unknown event (silent), `charge.success` already SUCCESS (idempotent skip),
      `charge.success` PENDING → SUCCESS, `charge.failed`.
    - `verifyPaystack`: already SUCCESS (return unchanged), PENDING + Paystack success → SUCCESS,
      Paystack failed (throws ConflictError).

- **CP3** — controller + web UI + manual gate (~3 hours):
  - `apps/api/src/modules/payments/paystack.controller.ts`:
    - `@Controller("payments/paystack")`, no class-level guards.
    - `POST /init` — `@UseGuards(AuthGuard, PermissionsGuard)` + `@Permissions("payment.record")`.
    - `POST /webhook` — `@UseGuards(PaystackWebhookGuard)` + `@HttpCode(200)`; always returns
      `{ status: "ok" }`.
    - `GET /verify/:reference` — `@UseGuards(AuthGuard, PermissionsGuard)` + `@Permissions("payment.read")`.
  - `PaystackController` registered in `PaymentsModule`.
  - `permissions-coverage.spec.ts` — add Paystack init + verify block.
  - `packages/types/src/api/payments.ts` — add `initPaystackPayment()`, `verifyPaystackPayment()` API client functions.
  - Web UI — invoice detail page (`apps/web/src/app/(admin)/finance/invoices/[id]/page.tsx`):
    - "Pay via Paystack" button opens `authorizationUrl` in a new tab.
    - "Refresh" / "Verify" button calls `verifyPaystackPayment()` and re-fetches the payment list.
  - New page `apps/web/src/app/(admin)/finance/payments/callback/page.tsx`:
    - Reads `?reference=` query param, calls verify, shows success/failure state + link back to invoice.
    - Paystack redirects here after checkout (configured as `callback_url` in the init payload).
  - Manual gate: sandbox test keys → init → open Paystack test checkout → complete test payment →
    verify webhook delivery (or trigger `GET /verify/:reference`) → confirm invoice transitions
    ISSUED → PARTIALLY_PAID or PAID → receipt URL returns HTML → push + PR.

## 16. Slice 7 plan-first decisions (locked 2026-07-01)

These decisions were finalized at the plan-first and are building constraints for
CP1/CP2. Reopen only if a concrete blocker surfaces.

**D1 — Overpayment: REJECT.**
`POST /payments/manual` returns `ConflictError("PAYMENT_WOULD_EXCEED_BALANCE", ...)` if
`dto.amount > (invoice.totalDue - invoice.totalPaid)`. Overpayment in a Nigerian
school context is almost always a data-entry error; the bursar corrects the amount.
Accepting and crediting a positive balance would require a refund flow (slice 11)
to unwind. PAID = fully settled, no credit balance. Slice 11 handles intentional
overpay if it ever emerges.

**D2 — totalPaid update: RECOMPUTE from aggregate, not atomic increment.**
After each payment write:
```typescript
const { _sum } = await db.payment.aggregate({
  where: { invoiceId, status: "SUCCESS" },
  _sum: { amount: true },
});
const newTotalPaid = _sum.amount ?? 0;
await db.invoice.update({ data: { totalPaid: newTotalPaid, status: computeInvoiceStatus(newTotalPaid, invoice.totalDue) } });
```
Recompute is idempotent: replaying any write produces the correct balance.
Slice 8 (Paystack webhooks) and slice 11 (reversals) use the identical path.

**D3 — Status transition: pure function in service, not DB trigger.**
```typescript
function computeInvoiceStatus(totalPaid: number, totalDue: number): InvoiceStatus {
  if (totalPaid <= 0)        return "ISSUED";
  if (totalPaid < totalDue)  return "PARTIALLY_PAID";
  return "PAID";
}
```
CANCELLED and REFUNDED are terminal — payment recording rejects if invoice is
in either state. OVERDUE is not transitioned by this function (cron/manual, TBD).

**D4 — Receipt format: HTML on R2 (not PDF).**
Receipt generated in-process from a template string, uploaded via
`storageService.put(schoolId, { kind: "payment-receipt", paymentId }, buffer, "text/html")`.
Bursars open the signed URL in a browser and use the print dialog.
PDF via Puppeteer is a fast-follow (swap `put` + content-type, no API contract change).
This decision avoids pulling in the `RenderService` dependency before the receipt
template exists.

**D5 — Manual payment default status: SUCCESS at creation.**
Manual payments are confirmed-in-hand at the moment of recording. `PENDING` is
reserved for Paystack initiation (slice 8), where the payment row is created PENDING
and transitions to SUCCESS on webhook confirmation.

**D6 — `paidAt`: any valid ISO datetime accepted (no backdate limit).**
Bursars record when cash was received, which may be yesterday or last week (late
entry). The audit log records both `paidAt` and `createdAt`; the gap is always
visible. Arbitrary backdate limits add friction without safety benefit.

**D7 — Receipt number: derived from payment ID.**
`receiptNumber = "RCP-" + paymentId.slice(0, 8).toUpperCase()`.
Unique by UUID collision probability; human-readable; no sequence table.

**D8 — `StorageObjectKey` extended with `payment-receipt` kind.**
Added to `packages/types` (or `storage.types.ts`):
```typescript
| { kind: "payment-receipt"; paymentId: string }
```
Path: `schools/${schoolId}/receipts/${paymentId}.html`

**Permissions added to `PHASE_3_PERMISSIONS`:** `payment.read`, `payment.record`.
`payment.refund` lands in slice 11.

**CP breakdown:**
- CP1: Payment model + enums + migrations (DDL + RBAC data migration) +
  `StorageObjectKey` extension + `payment.dto.ts` types + `PaymentsService`
  (`recordManual`, `findAll`, `findById`, `getReceiptUrl`) + `PaymentsModule`
  in `AppModule` + service integration spec (~10 tests including pure-unit
  `computeInvoiceStatus` cases).
- CP2: `PaymentsController` (4 endpoints, correct declaration order, `@Permissions`) +
  `permissions-coverage.spec.ts` payments block + `payments-api.ts` client +
  `/finance/invoices/[id]` updated with payment form + payment history table +
  receipt link + manual gate (partial → PARTIALLY_PAID → remainder → PAID → receipt URL). Push + PR.

## 18. Slice 9 plan-first decisions (locked 2026-07-05)

These decisions were finalized at the plan-first and are building constraints for
CP1/CP2. Reopen only if a concrete blocker surfaces.

---

**D1 — What an installment plan is.**
A `PaymentPlan` is a named schedule of expected payment dates and amounts set by
the bursar after an invoice is issued. Its installments describe *when* the bursar
expects each tranche of money; they do not move money themselves. Payments continue
to flow through the existing `recordManual` / Paystack paths unchanged. The plan
answers the question "of the ₦150,000 owed, when does the school expect each
portion?" — not "how is each payment routed?"

**D2 — Amounts constraint: installments must sum to `totalDue` exactly.**
At plan creation, validate `Σ installment.amount === invoice.totalDue`. Reject
with `ConflictError("INSTALLMENT_SUM_MISMATCH", ...)` if not. Partial-coverage
plans (where installments sum to less than `totalDue`) are disallowed — they
introduce ambiguity about what "paid" means and make allocation undefined. The
bursar must account for the full invoice.

**D3 — One active plan per invoice.**
An invoice can have at most one plan at a time. Before creating, query
`payment_plans` for `invoiceId`. If a plan already exists, reject with
`ConflictError("PLAN_ALREADY_EXISTS", ...)`. To replace a plan, the bursar
deletes and recreates (deletion is only allowed before any payments — D6).

**D4 — Eligible invoice statuses for plan creation: `ISSUED` and `PARTIALLY_PAID`.** *(amended)*
A bursar may set up a payment schedule retroactively after a first payment has been
made. The sum constraint (D2) is against `invoice.totalDue` — not the remaining
balance. The allocation logic (D5) already handles partial coverage correctly since
it walks cumulative sums against `totalPaid`. `PAID`, `CANCELLED`, `OVERDUE`,
`REFUNDED`, and `DRAFT` statuses cannot receive a new plan.

**D5 — Payment allocation: automatic, chronological, threshold-based.**
After every successful payment (both `recordManual` and `applyPaystackSuccess`),
if the invoice has a plan, recompute which installments are covered. No explicit
payment-to-installment link is stored; `paid` on each installment is a materialized
Boolean re-derived from `invoice.totalPaid` after every payment.

Algorithm (pure, testable independently):
1. Sort installments by `dueDate` ASC.
2. Compute cumulative amounts: `cumulative[i] = Σ amount[0..i]`.
3. Mark `paid = true` for installment `i` when `cumulative[i] <= invoice.totalPaid`.

Example — three ₦50,000 installments, totalPaid = ₦80,000:
- Installment 1 cumulative = 50,000 ≤ 80,000 → `paid = true`
- Installment 2 cumulative = 100,000 > 80,000 → `paid = false`
- Installment 3 cumulative = 150,000 > 80,000 → `paid = false`

This is idempotent (rerun gives same result) and consistent (same source of truth
as `totalPaid`, which is itself recomputed from the aggregate of SUCCESS payments).
Allocation is always applied in one direction — recording a payment can only move
installments from unpaid → paid, never the reverse.

**D6 — Plan mutability: create-once, delete-before-first-payment.**
- **No modification endpoint.** Changing installment amounts or dates after creation
  would require re-running allocation retroactively, which is error-prone. Replace =
  delete + create.
- **Deletion:** Allowed only when `invoice.totalPaid === 0`. Once any SUCCESS payment
  exists, `DELETE /payment-plans/:id` returns
  `ConflictError("PLAN_LOCKED_PAYMENTS_EXIST", ...)`. This prevents a plan from being
  removed mid-payment-stream, which would silently orphan the allocation history.

**D7 — Installment "overdue" is computed at read time; Invoice OVERDUE status transition is out of scope.**
Two distinct things:

*Installment-level overdue:* An installment is considered overdue when
`!paid && dueDate < today`. This is computed in the DTO layer (`PaymentPlanInstallmentDto`)
on every `GET /payment-plans?invoiceId=`. Not stored; no cron needed. The frontend
displays a badge ("Overdue", "Due", "Paid") on each installment.

*Invoice OVERDUE status:* The `Invoice.status` field has an `OVERDUE` enum value,
but `computeInvoiceStatus` (the pure function from slice 7) does not transition to
it — it handles only `ISSUED / PARTIALLY_PAID / PAID`. A DB-level OVERDUE transition
requires a scheduled job that scans invoices with `dueDate < today && totalPaid < totalDue`.
That cron belongs in slice 10 (debtor list), not here. Slice 9 does not touch
`computeInvoiceStatus`.

**D8 — Hooking into existing payment flows: `recomputeInstallmentsPaid` injected into `PaymentsService`.**
`PaymentPlanService` exposes a method:
```typescript
async recomputeInstallmentsPaid(
  db: TenantPrismaClient,
  invoiceId: string,
  totalPaid: number,
): Promise<void>
```
It is called at the end of `PaymentsService.recordManual()` and
`PaymentsService.applyPaystackSuccess()`, immediately after the aggregate
recompute that produces `newTotalPaid`. Both methods already have a tenant
`db` client and `newTotalPaid` in scope — no extra DB round-trip to fetch
`totalPaid` is needed. If no plan exists for the invoice, the call is a no-op
(single query, early return).

`PaymentPlanService` is registered in `PaymentsModule` alongside `PaymentsService`.
`PaymentsService` receives it by constructor injection. No circular dependency —
`PaymentPlanService` does not import `PaymentsService`.

**D9 — Schema: `PaymentPlan` and `PaymentPlanInstallment` are NOT yet migrated.**
Both models appear in this doc's §4 spec but were not included in slice 7's
migration (the slice 7 PR added `Payment` and enums only). CP1 runs the migration.

One addition vs the §4 spec: add `paymentPlans PaymentPlan[]` as a relation field
on `Invoice` to enable Prisma eager loading via `include`. This is a Prisma-level
relation; no extra column in the DB (foreign key is on `payment_plans.invoice_id`).

**D10 — Permissions added to `PHASE_3_PERMISSIONS`.**
Three new strings:
- `payment-plan.create` — bursar creates a plan for an ISSUED invoice
- `payment-plan.read` — bursar/admin views the plan for an invoice
- `payment-plan.delete` — bursar deletes a plan (only before first payment)

No `payment-plan.update` — D6 makes modification a delete + create pair.

---

**CP breakdown:**

- **CP1** — schema + service + spec (~3 hours):
  - `packages/db/prisma/schema.prisma` — add `PaymentPlan` + `PaymentPlanInstallment`
    (verbatim from §4) + `Invoice.paymentPlans PaymentPlan[]` relation. Run
    `pnpm db:migrate -- --name add_payment_plans`.
  - RLS policies: add `payment_plans` + `payment_plan_installments` to
    `packages/db/prisma/policies/finance.sql` (same `tenant_isolation` pattern
    as other finance tables).
  - `packages/types/src/finance/payment-plan.dto.ts` — Zod schemas:
    - `createInstallmentSchema`: `{ amount: z.number().int().positive(), dueDate: z.string().date() }`
    - `createPaymentPlanSchema`: `{ invoiceId: z.string().uuid(), name: z.string().min(1).max(100), installments: z.array(createInstallmentSchema).min(1) }`
    - `PaymentPlanInstallmentDto`: `{ id, amount, dueDate, paid, isOverdue }`
    - `PaymentPlanDto`: `{ id, invoiceId, name, createdAt, installments: PaymentPlanInstallmentDto[] }`
  - `PHASE_3_PERMISSIONS` in `packages/types` — add the three new strings.
  - `apps/api/src/modules/payments/payment-plan.service.ts`:
    - `create(authCtx, dto)` — validate invoice status (`ISSUED` only), check no
      existing plan, validate sum === totalDue, create plan + installments in one tx.
    - `findByInvoice(authCtx, invoiceId)` — fetch plan + installments, compute
      `isOverdue` on each row.
    - `delete(authCtx, planId)` — verify totalPaid === 0, cascade delete via Prisma.
    - `recomputeInstallmentsPaid(db, invoiceId, totalPaid)` — internal helper;
      sort installments, compute cumulative sums, bulk-update `paid` booleans.
  - `PaymentPlanService` added to `PaymentsModule` providers; injected into
    `PaymentsService` constructor; `recomputeInstallmentsPaid` called at the end
    of `recordManual` and `applyPaystackSuccess`.
  - `payment-plan.service.spec.ts` — unit tests (~12 tests):
    - `create`: happy path, wrong invoice status, plan already exists, sum mismatch.
    - `delete`: happy path (totalPaid === 0), locked (totalPaid > 0).
    - `recomputeInstallmentsPaid`: three installments — none paid, first paid,
      first+second paid, all paid; non-round allocation (80k against 50k/50k/50k).

- **CP2** — controller + web UI + manual gate (~2 hours):
  - `apps/api/src/modules/payments/payment-plans.controller.ts`:
    - `@Controller("payment-plans")`, class-level `@UseGuards(AuthGuard, PermissionsGuard)`.
    - `POST /` — `@Permissions("payment-plan.create")`.
    - `GET /?invoiceId=` — `@Permissions("payment-plan.read")`.
    - `DELETE /:id` — `@Permissions("payment-plan.delete")`.
  - `PaymentPlansController` registered in `PaymentsModule.controllers`.
  - `permissions-coverage.spec.ts` — add payment-plans block (all three handlers).
  - `packages/types/src/api/payments.ts` — add `createPaymentPlan()`,
    `getPaymentPlan(invoiceId)`, `deletePaymentPlan(id)` API client functions.
  - Web UI — invoice detail page (`apps/web/src/app/(admin)/finance/invoices/[id]/page.tsx`):
    - If invoice is `ISSUED` and no plan exists: "Set up installment plan" panel
      with a dynamic form (add/remove rows of amount + dueDate, sum validated
      client-side against `totalDue` before submit).
    - If plan exists: installment timeline — each row shows amount, dueDate, and
      a badge (`Paid ✓` / `Overdue` / `Due <date>`). Delete plan button (disabled
      if any payment recorded).
  - Manual gate: create ISSUED invoice → set up 3-installment plan → record
    payment covering first installment → verify installment 1 → `paid`, 2 → unpaid
    → record remainder → verify all → `paid` → delete plan fails (payments exist)
    → push + PR.
