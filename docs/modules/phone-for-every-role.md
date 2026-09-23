# The phone, for every role — bursar, parent, student

**Status:** plan-first, awaiting approval (2026-09-23).
**Asked for:** "finish the bursar app and interface, then the parents and
students. Parents should be able to do everything on the app if they choose
to, students too if possible; if not, link them to the web page like the
owner."

## Where each role stands today

| Role | On the phone now | Gap |
|---|---|---|
| Bursar | Every money screen exists and works (collections, who owes, record a payment, reminders, payment links, expenses, receipts) | No dashboard of their own — they land on a page written for teachers and owners, with no money summary and no "today". Nobody has signed in as a bursar and used the app. |
| Parent | Children, a child's results, their timetable, the school calendar, and managing a child's own app access | **Cannot see or pay fees.** The parent portal's whole money half is missing from the app: invoices, paying with Paystack, and the school's bank details for a transfer. No receipts. |
| Student | Home, results, attendance, fees, timetable, calendar | Already covers **everything** the student portal does — the student API is read-only. What is missing is polish, not features. |

**The finding that shapes this plan:** the student portal has no write
endpoints at all (`/student-portal/me*` is read-only), so a student app can be
complete without any web handoff. A parent's is nearly as good: every portal
endpoint already has a mobile binding, and only the screens are missing.

## Part 1 — The bursar

### D1 — A money dashboard, not the teacher's

The staff home decides what to show from roles and permissions. A bursar holds
`finance.dashboard.read` but not `dashboard.read`, so today they see a header
and a grid of tiles with no summary at all. They get their own band:

- **Today:** collected today, and how many payments.
- **This term:** collected, outstanding, and the percentage collected (all
  from `GET /finance/dashboard`, which already returns them — no new endpoint).
- **Needs you:** families who owe, with the total outstanding, linking to
  "Who owes".
- **Quick actions, in the order a bursar works:** Record a payment · Who owes ·
  Receipts · Log an expense.

**Record a payment** today starts from "Who owes" → a family → Record. A
bursar with a parent at the counter wants to start from the student's name, so
the dashboard's Record a payment opens a **student search**, then their unpaid
invoice, then the existing payment form. No new endpoints: the debtor list
already carries names, and `GET /payments/receipts` proved the search shape.

### D2 — What a bursar still cannot do on the phone, and why

Issuing invoices for a whole class, fee and discount setup, refunds, payroll
and bank details stay on the website: they are bulk or high-trust work, and
CP9's line has not moved. The bursar's Account menu gets the same "Open the
website" link owners have, which needs `dashboard.read`; for a bursar it opens
the finance section instead of the dashboard.

## Part 2 — Parents

### D3 — Fees and paying, the missing half

- **A child's fees:** each invoice with what it is for, the total, paid and
  balance, and its items — from `GET /portal/students/:id/invoices`.
- **Pay now:** `POST /portal/students/:id/invoices/:invoiceId/pay` returns a
  Paystack checkout URL. The phone opens it in the device browser
  (`expo-web-browser`, which returns control to the app when it closes), then
  **verifies with the server** (`GET /portal/payments/:reference`) — the phone
  never decides that a payment succeeded. If the parent closes the browser
  early, the screen says "Checking…" and offers "I've paid — check again".
- **Bank transfer:** `GET /portal/bank-details` for schools that take
  transfers, with the account shown clearly and a copy button.
- **Receipts for parents:** D7 of the receipts plan deliberately left this
  out. It comes back here, because a parent who pays in the app should be able
  to keep the receipt. It needs **one new endpoint**,
  `GET /portal/students/:id/payments/:paymentId/receipt`, guardian-scoped:
  the guardian must be linked to that student and the payment must belong to
  that student's invoice. Same signed-URL shape as the staff route.

### D4 — The parent app gets the staff app's design

The same pieces the staff app uses: a home with a greeting, one card per
child, a "needs you" line when fees are outstanding or new results are
released, and the app menu. Each child's page becomes tabs: Results · Fees ·
Timetable · Access.

### D5 — No web handoff for parents

Once fees, paying and receipts are in, the app does everything the portal
does. A handoff link is therefore **not** included: it would be a link to a
site with nothing extra on it. (Password reset and the invitation flow stay as
they are — they already work in the app.)

## Part 3 — Students

### D6 — Complete already; finish the look

Every student endpoint is already bound and on a screen. This part is the
design pass: a home that answers "what do I have today" (next lesson from the
timetable, latest result, attendance percentage, fees owed), then the existing
screens restyled to match the staff app, with the app menu.

### D7 — Nothing to hand off, deliberately

The student API is read-only, so there is nothing a student can do on the web
that they cannot do in the app. No handoff link is added. If a student result
PDF is ever wanted, it needs its own guardian/student-scoped endpoint, the
same shape as D3's receipt route.

## What this does NOT include

- Announcements (still unbuilt anywhere).
- Push notifications for new results or receipts.
- Automatic sign-in when the app opens the website (still a plain link).
- Offline reading for families.

## Shipping order

1. **Bursar** — dashboard band, quick actions, student-search payment start.
   Mobile only, no server change. PR.
2. **Parent money** — the guardian receipt endpoint (server, with tests), then
   fees, pay, transfer details and receipts on the phone. Two PRs.
3. **Parent and student redesign** — home screens, tabs, menu. PR.
4. **One APK** at the end, covering this and the receipt screens already
   merged.

## Tests

- `visibleStaffTabs` / `staffDestinations` for a bursar, and the dashboard
  band's own rules (pure), as the staff work already does.
- Payment verification: the phone never marks a payment successful without the
  server saying so; a cancelled checkout leaves the invoice untouched.
- The guardian receipt endpoint: a guardian gets their own child's receipt,
  and is refused another family's (real Postgres, like every other tenant
  boundary test).
- Every new query key stays under the family prefixes, and the staff prefix
  rule is untouched.
