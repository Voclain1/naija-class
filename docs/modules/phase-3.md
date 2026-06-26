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
| 4 | **Fee catalog** — `FeeCategory` (school-defined) + `FeeItem` with optional scope (level / arm / term / year), migration, RLS, admin CRUD UI | The flexible fee skeleton everything hangs off. Demoable: a school names its own fees and scopes them. | 2 | 3 days |
| 5 | **Discount rules** — `DiscountRule` (5 curated rule types, typed jsonb params), per-type server-side eval functions, RLS, admin CRUD UI | Curated flexibility without a DSL. Each rule type tested individually. | 2 | 3 days |
| 6 | **Invoice generation (snapshot-on-issue)** — `Invoice` with denormalized item+discount snapshot, generation by student's (level, arm, term, year), RLS, admin issue/preview UI | The freeze point — invoices stop tracking live fee/discount edits. The core correctness property. | 2 | 3 days |
| 7 | **Manual payment recording + receipts** — `Payment` (cash/POS/bank-transfer), receipt generation (PDF on R2, reusing the slice-5 render pattern), RLS, bursar UI | Schools can collect + receipt money with zero Paystack dependency. Ships before the online rail. | 2 | 3 days |
| 8 | **Paystack integration** — init + redirect + **webhook + reconciliation + idempotency keys + signature verification**, `Payment` online path, sandbox integration tests | The meaty, riskiest finance surface — real money, async, replay-safe. | 3 | 5 days |
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
  receiptNumber     String?  @map("receipt_number")
  receiptUrl        String?  @map("receipt_url")        // R2
  recordedBy        String?  @map("recorded_by")        // set for manual (cash/POS/transfer)
  paidAt            DateTime? @map("paid_at")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")
  invoice           Invoice  @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  @@unique([schoolId, paystackReference])              // webhook idempotency (partial-unique on non-null)
  @@index([schoolId, invoiceId])
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
POST   /payments/manual                  — body: { invoiceId, amount, method, paidAt }
GET    /payments?invoiceId=&studentId=
GET    /payments/:id/receipt             — signed R2 URL

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
