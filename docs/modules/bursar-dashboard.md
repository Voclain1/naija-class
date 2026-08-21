# Bursar dashboard

Plan-first. **Nothing in this document is built yet.** Approved 2026-08-21
(Arinzechukwu), all four items, split into two shipping units.

## 1. Why this exists

A bursar today lands on `/finance/dashboard` — `homeRouteFor()` sends them
there deliberately
([home-route.ts:13-15](../../apps/web/src/lib/auth/home-route.ts)), and the
admin-shell lockout that used to bounce them to `/teacher/dashboard` is fixed
([(admin)/layout.tsx](../../apps/web/src/app/(admin)/layout.tsx)). Their
sidebar filters to exactly one item, Finance
([sidebar.tsx:25-35](../../apps/web/src/components/admin/sidebar.tsx)), over
seven sub-tabs ([sub-nav.tsx:26-33](../../apps/web/src/components/finance/sub-nav.tsx)).

So the role works. The gap is not a missing page — it is that **the page they
land on is the wrong time-grain.**

`FinanceDashboardDto`
([dashboard.dto.ts:12-27](../../packages/types/src/finance/dashboard.dto.ts))
is entirely whole-term aggregates: total invoiced, total collected, collection
rate, outstanding, debtor count, expenses, net position.
`financeDashboardQuerySchema` accepts `termId` **and nothing else** — no date
filter, no notion of recency anywhere in it.

That is a proprietor's view: *how is the term going.* A bursar needs a
cashier's view: *what came in today, what do I chase this afternoon.* Those
are different questions, and the second one currently has no surface anywhere
in the app — payments are only ever listed per-invoice, so there is no
school-wide recent-activity view on any of the seven tabs.

Second, smaller, and more embarrassing: **the page renders nothing on
arrival.** `termId` starts empty and there is no server-side current-term
fallback — the DTO's own header comment says so, deliberately mirroring
`listDebtorsSchema`. So the one role whose home route this is greets them with
*"Select an academic year and term to view the finance dashboard"* and two
dropdowns, on every single login.

## 2. Unit A — default the current term (ship standalone, first)

Approved to ship independently of everything below, on the grounds that it is
cheap and disproportionately impactful. It is a front-door fix, not a feature.

**Change:** resolve the current term client-side on load — the term whose
`[startDate, endDate]` contains today, falling back to the most recent term of
the active year — and pre-select year + term so the dashboard renders real
numbers immediately. The selectors stay, fully functional; this only changes
the initial value.

**Why client-side:** it preserves the deliberate symmetry with
`/finance/debtors`, which resolves "current" the same way. Adding a
server-side fallback to `financeDashboardQuerySchema` would diverge the two
endpoints and contradict the DTO comment's stated intent — a bigger change
than the problem justifies. If a shared "current term" resolver is wanted, it
should be lifted for both pages at once, not bolted onto one.

**Timezone:** "contains today" needs a definition. The only precedent in the
codebase is [ai.constants.ts:29-39](../../apps/api/src/common/ai/ai.constants.ts),
which picks **UTC** for budget periods and explains why (an accounting
boundary, not a school-day boundary). Term boundaries are `@db.Date` — no
zone, per CLAUDE.md's "midnight in which zone?" convention — so a date-only
comparison sidesteps this entirely. Compare dates, not moments.

Bursar already holds `academic-year.read` and `term.read`
([permissions.ts:508-510](../../packages/types/src/permissions.ts)). **No new
grants.**

**Estimate:** hours. Not a slice.

## 3. Unit B — the operations view (items 2-4, one small slice)

### D1 — A separate endpoint, not a wider `FinanceDashboardDto`.

Extending the existing DTO would make every admin's term-report load pay for
day-scoped queries it never displays, and would fuse two genuinely different
questions into one response shape. A separate `GET /finance/operations` keeps
the term report and the day view independently cacheable and independently
changeable.

Reuses `finance.dashboard.read`, which bursar already holds — **no new
permission constant.** (Had one been needed, CLAUDE.md's precedent is a
descriptively-named constant à la `ADMIN_DASHBOARD_PERMISSIONS`, not
force-fitting it into a phase array.)

### D2 — Today's collections, split by method.

`sum(Payment.amount)` where `status = SUCCESS` and `paidAt` falls in today,
grouped by `PaymentMethod` (CASH / POS / BANK_TRANSFER / PAYSTACK). New
date-filtered aggregate; nothing existing covers it.

**Timezone matters here and cannot be dodged the way Unit A dodges it.**
`paidAt` is a true moment (`DateTime`, not `@db.Date`), so "today" is a real
window with a real zone. Every school in scope is Nigerian, and a bursar
reconciling their cash drawer means *their* day. **Africa/Lagos, fixed** —
not UTC, and not per-school configurable (no such field exists, and inventing
one for this is scope creep). Note this diverges from `ai.constants.ts`'s UTC
choice **on purpose**: that comment's own reasoning is that a budget period is
an accounting boundary rather than a school-day boundary. This is the school
day. The divergence should be commented at the call site so it reads as
considered rather than inconsistent.

Africa/Lagos is UTC+1 with no DST, so this is a fixed offset — no tz database
dependency needed.

### D3 — Recent payments, school-wide.

Last ~10 across the school: student name, amount, method, time.

`listPaymentsSchema` already permits an invoice-less, paginated query
([payment.dto.ts:68-74](../../packages/types/src/finance/payment.dto.ts)), so
the query itself is nearly free. The catch: `PaymentDto` carries `studentId`,
not a student name, so this needs a join — and **bursar holds no
`student.read`**. That is not a blocker (the name is being served as part of a
finance response the role is authorized for, exactly as `DebtorDto` already
carries `studentName` to the same role) but it must be a deliberate field on
the operations DTO rather than a client-side lookup, which would 403.

### D4 — Pending / overdue, linked into Debtors.

`debtorCount` and `outstandingBalance` already exist on the current dashboard
response. This is re-presenting them as an action — a card that links to
`/finance/debtors` — not a new query. Cheapest item here.

### D5 — Placement.

Unit B renders **on `/finance/dashboard`, above the existing term aggregates**,
not as an eighth sub-nav tab. The bursar's landing page should answer today's
question first and the term question below it; a separate tab would mean the
role's home route still opens on the wrong grain, which is the whole complaint.

Owner/admin see it too. That is fine and arguably right — a proprietor
checking today's takings is a real use — and it avoids role-conditional
rendering inside a shared page.

## 4. Tests

- Current-term resolution: today inside a term selects it; today between terms
  falls back to the most recent term of the active year; a school with no
  terms renders the empty state rather than throwing (Unit A).
- Today's collections group correctly by method and exclude non-`SUCCESS`
  rows.
- Day-boundary correctness at Africa/Lagos edges — a payment at 23:30 Lagos
  counts as today, one at 00:30 does not (D2). This is the test that would
  catch a naive UTC implementation.
- Recent payments are school-wide, name-bearing, and RLS-scoped.
- A bursar can load `/finance/operations` with exactly
  `PHASE_3_BURSAR_PERMISSIONS` — no new grants needed (D1). Worth asserting
  explicitly, since this role has been broken twice before by permission gaps
  discovered only in the browser (the admin-shell lockout, and the
  `grading-scheme.read` gap noted in
  [permissions.ts](../../packages/types/src/permissions.ts)).
- Live verification as an actual bursar, not just as owner. Both prior bursar
  bugs passed CI.

## 5. Scope

**In:** Unit A (default term). Unit B (today's collections, recent payments,
debtors call-to-action) on the existing finance dashboard.

**Out:** anything requiring new permissions. Per-school timezone
configuration. Cash-drawer reconciliation / shift close-out — a real bursar
feature and a plausible next step, but a different, larger thing. Expense
entry from this view. A bursar-scoped product tour (noted as an unbuilt
follow-up in
[topbar.tsx:49-52](../../apps/web/src/components/admin/topbar.tsx)).

**Estimate:** Unit A hours; Unit B one small slice, one endpoint plus one UI
section.

**Sequencing:** independent of
[shareable-payment-links.md](shareable-payment-links.md). Both touch the
finance area but share no code; Unit A can ship immediately.
