# Everyday shortcuts: Add students, Record payment, staff roles

Owner's asks of 2026-10-30. Web only; no database change.

## Add students

- **Before:** the Students page's Add student button opened the one-at-a-time form. The grid, the spreadsheet import and the register scan were behind a small caret most people never opened.
- **Now:** **Add students** opens a chooser listing all four, one line each (`components/students/add-student-chooser.tsx`). The empty roster uses the same chooser.
- **Less text:** the grid page keeps one line ("One row per student. Pick the class below, or place them later."). Its paste tips and the interrupted-upload note sit behind a **?** beside the title (`components/shared/help-tip.tsx`, a small window rather than a tooltip so it works on a phone).
- **One student form:** its intro is one sentence.
- **Scan page:** unchanged. Its notices are the Beta consent and the checking warnings, which must stay on the page.

## Record payment (`/finance/payments/record`)

**Before:** Record Fee (dashboard) and Record payment (finance section row) both went to the bills list, and the bursar had to find the bill first.

**Now both open this page:**

1. **Find the student.** Search by name or admission number, as you type.
2. **See what is owed.** One row per child with unpaid bills, showing what they owe.
3. **Record the payment.** Choose a bill (the oldest is chosen for you), then the amount (**Paid in full** fills in the balance), method, date and reference.
4. **Done.** **Open receipt** or **Record another**.

**Server:**
- `GET /invoices` gains two query parameters:
  - `search` (2–100 characters): matches first, middle or last name or admission number. Every word must match. Capped at 50 students per search.
  - `unpaid=true`: only bills still taking a payment, the statuses in `PAYABLE_INVOICE_STATUSES` (ISSUED, PARTIALLY_PAID, OVERDUE).
- **Access:** both parameters sit under `invoice.read`, so a bursar, who has no `student.read`, can search. The search runs inside the school's tenant, and the specs prove it never reaches another school.
- **Recording** is the existing `POST /payments/manual`, with a per-form idempotency key. FinanceService, the audit row, the receipt and the overpayment refusal are unchanged.
- **Overpayment** is refused on the page too, before sending.

**Not built:**
- One payment split across several bills: record it on each bill in turn.
- The staff app: unchanged.

**Pure logic:** `lib/finance/record-payment.ts` (grouping, oldest first, amount parsing), with a sibling spec.

## Staff page Role filter

**Before:** the filter offered Owner, Administrator and Teacher only.

**Now:**
- It lists every staff role in `packages/db/src/seeds/system-roles.ts`.
- It also adds any other role found on a loaded staff member, so a role added later still appears.
- `GET /users` already returned staff of every role, so the server is unchanged.

## Tests

- **API:** `invoice-generation.service.spec.ts` covers:
  - search by name, admission number and a shared surname;
  - `unpaid`;
  - tenant isolation.
- **Web:**
  - `record-payment.spec.ts`;
  - the finance-row invariant now pins the new route;
  - `dashboard-actions.spec.ts`.
- **e2e:** `everyday-shortcuts.spec.ts` covers:
  - the chooser and the help **?**;
  - every role in the filter;
  - Record payment end to end: Record Fee, search, Paid in full, PAID by the API, then gone from the search.
- **e2e (changed):** `session-end-work-loss.spec.ts` now opens the **?** to find the interrupted-upload note.
