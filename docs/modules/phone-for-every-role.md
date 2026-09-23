# The phone, for every role — bursar, parent, student

**Status:** approved 2026-09-23, with four changes from the maintainer —
see "Approved, with changes" below. Building in the shipping order at the end.
**Asked for:** "finish the bursar app and interface, then the parents and
students. Parents should be able to do everything on the app if they choose
to, students too if possible; if not, link them to the web page like the
owner."

## Where each role stands today

| Role | On the phone now | Gap |
|---|---|---|
| Bursar | Every money screen exists and works (collections, who owes, record a payment, reminders, payment links, expenses, receipts) | No dashboard of their own — they land on a page written for teachers and owners, with no money summary and no "today". Nobody has signed in as a bursar and used the app. |
| Parent | Children, a child's results, their timetable, the school calendar, managing a child's own app access, **fees and paying them** | Small gaps only: no breakdown of what a fee is FOR, and no bank-transfer details. |
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
- **Receipts stay with the school (maintainer, 2026-09-23).** A parent does
  NOT get a receipt from their own dashboard: a receipt is issued by the
  school, and the bursar or admin shares it. The guardian-scoped receipt
  endpoint this plan first proposed is **dropped**, not deferred — it would
  have made the app a second issuing channel, which is exactly the thing the
  receipts module's "issued by bursar or admin" rule exists to prevent. A
  parent who pays in the app sees the payment on the invoice, and asks the
  school for the receipt, which staff can share in two taps.

### D4 — The parent app gets the staff app's design

The same pieces the staff app uses: a home with a greeting, one card per
child, a "needs you" line when fees are outstanding or new results are
released, and the app menu. Each child's page becomes tabs: Results · Fees ·
Timetable · Access.

### D5 — No web handoff for parents

Once fees and paying are in, the app does everything the portal does. A handoff link is therefore **not** included: it would be a link to a
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

## Approved, with changes (2026-09-23)

### C1 — Receipts are the school's to issue

Handled in D3 above: the parent-facing receipt endpoint is dropped.

### C2 — The student AI tutor: where it actually stands

Checked rather than assumed:

- **Not ready, and not nearly ready.** The tutor is **Phase 7**, together with
  curriculum RAG (`docs/modules/phase-7.md`, "plan-first, not approved,
  nothing built", 2026-09-02). It was moved out of Phase 5 on 2026-08-14 for
  a reason that still holds: it is useless without curriculum grounding.
- **Its blocker is a purchase, not code.** Grounding needs embeddings;
  Anthropic ships no embeddings API, so it needs a **second AI vendor**
  (phase-7 D2 proposes Voyage `voyage-4`), which means a new API key, a new
  NDPR data processor and a new cost line. That decision is the maintainer's
  and has not been made.
- **What DOES exist:** `packages/ai` with a typed prompt registry, the
  budget-enforced Claude client, `AIInteractionLog`, and shipped AI features
  (lesson notes, report comments, insights, parent summaries). `pgvector` is
  enabled in the schema and used by nothing.

**So: make the pathway, do not fake the feature.** This plan adds, on the
student home, an **"Ask about your work"** entry that is honestly labelled
*Coming soon* — matching the website's own sidebar, which already lists AI
Tutor under COMING SOON. It routes to a screen that explains what it will do
and nothing more. No prompt, no model call, no half-tutor: a student asking a
question and getting a generic answer with no curriculum behind it would
teach them the feature is useless.

What this plan DOES commit to, so the tutor is a screen away when Phase 7
lands: the student app gets the same query-key, session and menu structure the
staff AI screens use, so the tutor is a new screen rather than a new
architecture.

### C3 — Announcements, push, auto sign-in, offline: the honest state

The maintainer's note is right that these are core, not extras. Each is
different, so each gets its own answer rather than one blanket "later".

| | State today | This plan |
|---|---|---|
| **Push notifications** | **Already built** for parents and students: `POST /portal/devices` and `/student-portal/devices`, the app registers a token at sign-in (`src/lib/push/register.ts`), and `NotificationDispatchService` prefers push over paid SMS. But **only fee reminders ever send one**, and **staff have no device endpoint at all**. | Wire the events families expect — results released, a payment received, a new school event — and add staff devices, so a teacher can be told their marks are due. Own plan-first, because each notification costs trust when it is wrong. |
| **Announcements** | Deferred by decision three times (`phase-4.md` §8, `phase-8.md` D20/Q4). Nothing exists: no table, no endpoint, no screen. | A real feature, not a screen: a `SchoolAnnouncement` table, who may post, who receives it, and delivery through the push work above. **Own plan-first, next after this one.** |
| **Automatic sign-in to the website** | The app opens a plain link; the person signs in again. | Needs a short-lived, single-use handoff token minted by the API and exchanged by the web app for a session — an auth change, so it gets its own plan-first with its own security review. Not bolted onto a UI PR. |
| **Offline reading** | Staff data is deliberately never persisted (CP2). Family data is persistable and already cached in memory while the app runs. | In scope HERE for families only, at the safe level: the last-loaded results, timetable, fees and calendar readable with no signal, marked "as of <time>", never for staff. |

### C4 — Order, revised

1. **Bursar** — dashboard band, quick actions, student-search payment start.
   Mobile only, no server change.
2. **Parent money** — fees, pay via Paystack with server verification, bank
   transfer details. No parent receipts (C1). Mobile only; no server change.
3. **Parent and student redesign** — home screens, tabs, the app menu, the
   AI "coming soon" pathway (C2), and family offline reading (C3).
4. **One APK**, covering all of the above plus the receipt screens already
   merged.
5. **Then, as their own plan-firsts, in this order:** notifications (wiring
   the events + staff devices) → announcements → automatic web sign-in.
   Each is a real feature with its own decisions; none is a UI tweak.

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

## Corrections found while building (2026-09-23)

Two claims in the table above were wrong when this plan was written. Both were
found by reading the code rather than grepping headings, and both make the
work smaller. Recorded rather than quietly fixed, because a plan that
overstates a gap wastes a build.

1. **Parents could already pay.** `app/students/[id]/index.tsx` has listed
   invoices and offered "Pay ₦x" since Phase 6, through
   `src/lib/payments/checkout.ts` (hosted checkout in an in-app browser) and
   `poll.ts` (the SERVER decides the outcome; the browser closing proves
   nothing). D3's real remainder was therefore only: **what each fee is for**
   (the invoice's own line items) and **bank-transfer details**. Both are now
   on that page. The separate fees screen this plan implied was dropped —
   a second place to pay is a second place to get it wrong.
2. **Family offline reading already exists.** C3 listed it as in scope. In
   fact the family cache is persisted for 7 days (`src/lib/query/client.ts`,
   `persist.ts`) and family screens already carry `FreshnessLabel`'s "as of"
   line, with `useIsOnline` wording the offline case. Nothing to build; the
   redesign keeps both.

**What stands from C3:** notifications (push exists but only fee reminders
send one, and staff have no device endpoint), announcements (nothing exists),
and automatic web sign-in (nothing exists). Those remain sequenced after the
redesign, each with its own plan-first.

### Part 3 status (2026-09-23) — built

- **Parent home:** the staff app's header and menu, a card per child with
  initials, class, and the ONE line worth attention — money owed first
  (`childHighlight`), fresh results otherwise, and **nothing when there is
  nothing**, because a home that always shows a banner teaches people to
  ignore banners. The stray "Sign out" button is gone; it lives in the menu.
- **Student home:** a "Today" band — next lesson from the published
  timetable, attendance, the newest released result, and anything owed — then
  the screens, then the admission number and school code kept where a child
  can find them before they are locked out of a new phone.
- **The AI tutor's pathway (C2):** a "Coming soon" entry and a `/me/tutor`
  screen that says what it will do and why it is not switched on early. No
  prompt, no model call.
- **Shared:** `src/lib/when.ts` (greeting, ISO weekday, long date, minutes of
  day) lifted out of the staff home so both sides read the school's day the
  same way, and `src/lib/family/today.ts` for the home-screen judgements.
