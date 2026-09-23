# Branded payment receipts — web and phone

**Status:** plan-first, awaiting approval (2026-09-22).
**Asked for:** "after a successful payment, a receipt with the school's
branding (name, address, logo, payment details and date etc), which would
only be issued by bursar or admin — on both web and app."

## What exists today, and why it isn't enough

Every successful payment already gets a receipt. `PaymentsService` builds an
HTML page at record time (manual payments and Paystack webhooks both), stores
it in R2 (`payment-receipt` key), and `GET /payments/:id/receipt` returns a
15-minute signed URL. The web invoice page links to it. The phone has nothing.

The receipt itself is not something a school can hand to a parent:

| Today | Problem |
|---|---|
| Heading "Official Receipt" | No school name, logo, address, phone or email |
| `Invoice: 7c1f0f7e-…` | An internal UUID; no student name, admission number or class |
| Date via `toLocaleString` on the server | Rendered in the server's zone (UTC), so a payment at 00:30 in Lagos shows the previous day |
| `RCP-4F2A9C1B` (first 8 hex digits of the payment id) | Not sequential, so a school's auditor can't spot a missing receipt |
| No balance | The parent can't see what is still owed after this payment |
| No "received by" | No one is accountable for cash |

## Who may issue receipts

`payment.read` / `payment.record` are held by owner (`*`), admin and bursar
only; teachers hold neither. So "only bursar or admin" already holds at the
permission layer. This plan adds the service-level role check the codebase
uses for sensitive finance reads (`assertUserActiveAndHasOneOf(["owner",
"admin", "bursar"])`, same as payment links), so a future custom role granted
`payment.read` still can't issue receipts.

**Owner is included.** The owner holds every permission and runs the school;
leaving them out would be surprising. Flagged in case the intent was stricter.

## Decisions

### D1 — What the receipt shows

```
[LOGO]  GREENFIELD ACADEMY
        "Knowledge and Character"                  OFFICIAL RECEIPT
        12 Awolowo Road, Ikeja, Lagos              No. RCP/2026/000123
        0803 123 4567 · accounts@greenfield.ng     22 September 2026, 10:42
───────────────────────────────────────────────────────────────────────
Received from   the parent/guardian of ADAEZE OKAFOR
                Admission no. GFA/2021/041 · JSS2 Blue
For             School fees — First Term 2026/2027
───────────────────────────────────────────────────────────────────────
Amount          ₦50,000.00
                Fifty thousand naira only
Paid by         Bank transfer · Ref. TRF-889213
───────────────────────────────────────────────────────────────────────
Invoice total ₦150,000.00 · Paid to date ₦100,000.00 · Balance ₦50,000.00
───────────────────────────────────────────────────────────────────────
Received by     Ngozi Eze (Bursar)                  [school colour bar]
                         Thank you.
```

- Branding comes from the school's own settings: name, motto, logo, address,
  phone, email and brand colour, all fields that already exist on `School`.
  Missing fields are left out, never shown as blanks.
- Amount in figures **and words**, as on a Nigerian cheque. The same wording
  as the phone's payment confirmation, with the words function moved to
  `@school-kit/types` so the web, API and phone share one copy.
- Balance after this payment, **computed by the server** at issue time.
- "Received by" is the staff member who recorded it. For an online payment it
  reads "Paid online (Paystack)".
- Dates in **Africa/Lagos**, not the server's zone.

### D2 — The receipt is a snapshot, frozen when issued

A receipt is a historic document. If the school changes its logo or address
next term, last term's receipts must still say what they said. So at the
moment a payment succeeds, the server writes the receipt with everything it
shows, including the logo embedded in the file, and stores it, exactly as it
does today, just complete. Nothing on it is recomputed when it's opened later.

Logo embedding: the logo is read from R2 and inlined as a data URI. Logos over
300 KB are left off, with a warning in the log, rather than bloating every
receipt; the upload screen already favours small logos.

### D3 — Sequential receipt numbers per school (recommended)

`RCP/2026/000123`: per school, per calendar year, with no gaps under normal
use. A new `receipt_sequences` table (school_id, year, last_number) is
incremented with a single atomic `UPDATE … RETURNING` inside the payment's own
transaction. If the payment rolls back, the number rolls back with it, so a
failed payment never burns a number.

Existing receipts keep their old `RCP-XXXXXXXX` numbers; only new receipts
are sequential. An auditor can then say "receipts 1 to 412 this year, none
missing".

### D4 — Old receipts can be re-issued in the new design

Payments recorded before this ships have the old bare receipt.
`POST /payments/:id/receipt/reissue` (owner/admin/bursar) regenerates a
payment's receipt in the new design, keeping its original number and date.
Every re-issue is audited (`payment.receipt-reissue`, who and when). Re-issue
never changes the amount, date or number, only the presentation. It's for old
receipts, and for when a school fixes a typo in its address.

### D5 — On the website

- The invoice page's payment rows: **View receipt** opens the branded receipt
  in a new tab, where **Print** gives a paper copy or a PDF.
- Right after recording a payment: a "Receipt ready" prompt with View/Print.
- The page is laid out for A5 and A4 printing, and fits on one page.

### D6 — On the phone

- After **Record a payment** succeeds, the receipt number is already shown
  (CP9b). This adds **Share receipt**: the phone fetches the receipt, turns it
  into a PDF with `expo-print` (already installed; lesson notes use it), and
  opens the share sheet. WhatsApp is the usual choice.
- A new **Receipts** screen in the Money menu: the most recent payments across
  the school (newest first, searchable by student name). Each opens its
  receipt to view, share or re-issue. This is needed because a family that
  has paid in full leaves the "Who owes" list, which is otherwise the only way
  in.
- The PDF is made in the phone's temporary folder and never kept. The
  receipt carries a child's name and a payment, and staff data is never
  persisted on the device (CP2 rule).

### D7 — Not in this plan

- **Parents downloading receipts from the parent app.** The request says
  receipts are issued by the bursar or admin. Parents get them when staff
  share them. Letting parents fetch their own is a sensible later step, with
  its own guardian-scoped endpoint.
- **Emailing or texting receipts automatically.** Sharing is a deliberate act
  by staff for now. Automatic sending adds SMS cost and needs the school's
  opt-in.
- **Receipts for refunds.** Refunds are web-only and have their own records.

## Endpoints

| Method | Path | Gate | Change |
|---|---|---|---|
| GET | `/payments/:id/receipt` | `payment.read` + owner/admin/bursar role | Adds the role check; response unchanged |
| POST | `/payments/:id/receipt/reissue` | `payment.record` + role | **New**, audited |
| GET | `/payments?search=&cursor=` | `payment.read` + role | Recent-payments list for the phone's Receipts screen; adds student name and receipt number to the rows |

## Database

- `receipt_sequences (school_id, year, last_number)`, with RLS and FORCE like
  every tenant table, plus a unique `(school_id, year)`. Additive.
- `payments.received_by_name`: no. The recorder's name is read from `users`
  when the receipt is generated and written into the receipt itself. No new
  column is needed.

This is one additive migration. There is no staging tier, so it runs against
production on deploy, like D37's.

## Tests

- **Receipt content**, from a fixed payment: school name, logo, address,
  student, class, amount in figures and words, method and reference, balance,
  received-by, and the Lagos date across midnight UTC.
- **HTML safety:** every school- and parent-supplied field is escaped (a
  school named `<script>` renders as text).
- **Missing branding** (no logo, no address) produces no blank lines or broken
  images.
- **Oversized logo** is left off, and the receipt still renders.
- **Sequential numbers** against real Postgres: consecutive, a separate
  sequence per school and per year, a rolled-back payment burns no number,
  and concurrent payments get distinct numbers.
- **Re-issue:** keeps the number and date, is audited, and is refused for
  teachers and for another school's payment.
- **Role gate:** a custom role with `payment.read` but no finance role is
  refused.
- **Phone:** the share flow builds the PDF from the fetched receipt. The
  Receipts list keys are staff-prefixed, so they're never persisted.

## Shipping

1. **Server:** receipt design, sequence, re-issue, role gate. Tests against
   real Postgres, then a PR.
2. **Web:** View/Print on the invoice page and after recording. PR.
3. **Phone:** Share receipt after recording, and the Receipts screen. PR, then
   one APK.

## Status

- **2026-09-22: approved** as written, including both open points: sequential
  numbers (D3), and the owner included in "bursar or admin".
- **Part 1, server: built.** `receipt.ts` (a pure renderer plus the issuer),
  `receipt_sequences` (migration `20260922120000_receipt_sequences`, RLS
  ENABLE + FORCE), both payment paths issue the branded receipt, the
  owner/admin/bursar role gate on open/list/re-issue, `GET /payments/receipts`
  and `POST /payments/:id/receipt/reissue`.
  - Deviation from the endpoint table: the recent-receipts list is its own
    route, `GET /payments/receipts`, rather than new parameters on
    `GET /payments`. That keeps the web's existing paginated `PaymentDto`
    list untouched.
  - A missing student or term (both plain foreign keys) gives a plainer
    receipt, never a refused payment. Only the school and invoice are
    required.
  - The Paystack path now issues the receipt after recomputing the totals,
    so the balance on an online payment's receipt is the balance after it.
- **Part 2, web: built.** The invoice page shows receipt numbers, View opens
  the receipt without being blocked as a pop-up, Re-issue asks for
  confirmation, and a "Receipt ready" banner appears after recording. The
  receipt has a Print button that is hidden in print.
- **Part 3, phone: built.** Share receipt (PDF) and Print appear after
  recording a payment. A new Receipts screen in the Money menu lists receipts
  newest first, with search; each receipt can be shared, printed or
  re-issued. The PDF is made in the phone's cache and deleted after sharing.
  The signed receipt URL is fetched without the bearer token, because the
  signature alone authorises it.

### Fix (2026-09-22, after the first production test)

Two problems appeared in production:

1. **Payment-link payments got no receipt.** `handlePaymentRequestWebhook`
   (a Paystack payment link paid from WhatsApp) records the payment on its own
   path, which never issued a receipt. It now does.
2. **Re-issue failed with a server error.** No production logs could be read
   from here, so the cause is inferred, not observed. The receipt was issued
   inside the payment's 5-second transaction, which included downloading the
   school's logo from storage, and a school with a large logo could run past
   the budget. Local tests have no logo, so they never hit it.

**The design change, on its merits:** receipts are now issued in their own
transaction after the payment commits (`issueReceiptFor`, 20-second budget,
logo fetched beforehand and cached). A receipt problem can no longer refuse a
payment. The receipt is simply missing, and "Issue receipt" makes it later.
Numbers stay gap-free, because the number is drawn in the receipt's own
transaction. Issuance is also exactly-once: the payment row is locked
`FOR UPDATE` and re-checked, so the webhook and the verify-poll cannot both
issue a receipt. A mutation check (lock removed) produced three different
numbers for one payment.

Also: an online payment's receipt now reads "Received by: Paid online
(Paystack)" even when a staff member created the link. On the web, the receipt
is a real **View receipt** button with its number beneath, and a payment with
no receipt shows **Issue receipt**.

### D8 — the premium redesign (2026-09-23)

The first receipt shipped correct but plain. Redesigned as a document a school
is happy to hand over:

- **Type:** Georgia for the school name, amount and closing line; Helvetica /
  Arial for everything else. **Deliberately system fonts, not a web font** —
  this document is also turned into a PDF on a phone and printed in offices
  with poor connections, and a downloaded font that failed to arrive would
  re-flow the whole receipt.
- **Structure:** a brand-coloured band, generous margins, small-caps
  letter-spaced labels, hairline rules instead of table borders, and a
  large tabular-figure amount with the words in a tinted quote panel.
- **Status:** a chip reading "Paid in full" or "₦x outstanding", a
  three-column ledger (invoice total / paid to date / balance), and a
  PAID or PART PAYMENT stamp.
- **Signature line** for the person who received the money, "For <school>",
  and a quiet "computer-generated receipt" note carrying the number again.
- **No logo?** The school's initials in a brand-coloured roundel, so the
  header never has a hole where a crest should be.
- **Print:** A4 with 12mm margins, `print-color-adjust: exact` so the brand
  band and tints survive, and the Print button hidden. Narrow screens get a
  stacked layout.
