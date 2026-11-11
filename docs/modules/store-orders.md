# Store orders

Requested 2026-11-11 by the owner: "a smoother process for running the store. It
can exist on its own; order fees can be added to the fees invoice or billed
separately, as decided by the school." The owner's answers the same day:

1. **"On its own"** means all three: store sales need not wait for the fees
   invoice; a school that does not bill fees in SchoolKit can still run the
   store; and people who are not students (staff, visitors) can buy.
2. **Paying separately:** both. The parent pays at the counter now, or a
   separate store invoice is left for them to pay later, including online.
3. **Who decides:** the school sets a default; it may also let the person
   selling choose the other way on a sale.
4. **Smoother:** a checkout with many items, packs, selling a pack to a whole
   class, and tracking what was paid for but not yet collected.

Builds on the Store (`docs/modules/id-cards-and-store.md` §4). No model call;
nothing here reaches an LLM.

## 1. What changes for a school

- **Sell** (`/store/sell`) is the store's till. Choose the buyer (a student, a
  member of staff, or a walk-in buyer), add items by search or a pack in one
  press, set sizes and quantities, tick **Hand over now** for what leaves the
  counter, and confirm. One order, one number (`SO-000042`), one total.
- **How it is billed:**

  | Buyer | Billing | What happens |
  |---|---|---|
  | Student | Fees invoice | One STORE charge per line, as single sales always did. They ride on the child's fees invoice (or a supplementary one). |
  | Student | Store invoice | The same charges, billed **at once** onto an invoice of their own. The family pays it like any invoice: at the counter now (**The parent is paying now**, recorded through `POST /payments/manual` with a receipt), or later, online included. |
  | Staff, walk-in | Paid at the counter | Cash, POS or transfer, recorded on the order. No invoice, no charge. |

  The school's choice is on the Store page: **How students pay for store items**
  (fees invoice or a separate store invoice) and **Let the person selling choose
  the other way on a sale**. Owner and admins change it; everyone else sees it.
  The default is the fees invoice, as before.
- **Orders** (`/store/orders`) lists every sale; **To collect** shows what is
  still owed. On an order, **Record hand-over** takes the stock out then.
  **Print slip** prints the order for the buyer. **Cancel order** works while
  nothing has been handed over (see §3).
- **Packs** (`/store/packs`): saved lists of items and quantities ("JSS1 starter
  pack"). Sizes are chosen per child at the sale.
- **Sell a pack to a class** (`/store/class-sale`): a class and a pack; every
  enrolled child is listed, children who already have that pack are unticked,
  sizes are set per child (or for everyone at once), and one press makes an
  order for each child, billed as the school decided, everything waiting to
  be collected.
- **Reports** gain **Orders by how they were paid**: fees invoice, store
  invoice (with how much has been paid on them), and counter takings by
  method, for any dates.
- The item page shows **To collect** per size, and each hand-over in its
  history links to its order.

## 2. Decisions

- **D1. Stock leaves at hand-over, not at sale.** A line handed over now and a
  line collected later are the same SELL movement, written when the item goes
  over the counter and tied to its line (`store_movements.order_line_id`). So
  the ledger is still exactly what is on the shelf, and a school can take
  orders for uniforms not yet delivered. A line cannot be handed over beyond
  what is in stock (`NOT_ENOUGH_STOCK`), and never beyond what was ordered.
- **D2. A store invoice is a supplementary invoice issued at the sale.** It is
  made by `InvoiceGenerationService.issueChargesInvoiceInTransaction`, the same
  code "bill waiting charges" now uses, so it is audited `invoice.issue`, its
  charges are BILLED on it in the same transaction, and everything that works
  on invoices (payments, receipts, Paystack links, the portal, debtors) works
  on it. It takes the student's next sequence for the term; sequence 0 stays
  the term invoice's, so a store invoice may come first and the fees invoice
  generated later does not carry it. No fees setup is needed, which is what
  lets a school run the store on its own. A term must exist (`NO_TERM`).
- **D3. Paying now is the ordinary payment path.** The till records the
  payment with `POST /payments/manual` for the invoice's amount as the API
  returned it, using the checkout form's key as its idempotency key. If that
  call fails, the order and its invoice stand and the page says so; the
  payment is recorded on the invoice afterwards. The person needs
  `payment.record` (owner, admin, bursar); others see the invoice left for the
  bursar.
- **D4. Counter takings for staff and walk-in buyers are recorded on the
  order, not as fee payments** (method, optional reference, audited
  `store.order.create`). There is no invoice to pay: a walk-in has no student
  record. **For the owner to confirm:** CLAUDE.md's money rule says every
  payment-mutating action goes through FinanceService. This is the store's
  cash, kept apart from fees, and it appears only in the store's takings
  report. If the owner wants it in Bursary too, the next step is an
  income/receipt record in the finance module.
- **D5. Prices come from the server only.** The till asks
  `POST /store/orders/preview` for each line's price, any problem in words and
  the total, and shows that; it adds nothing up itself. The order is priced
  again when it is written, under a lock on the variants.
- **D6. One order per checkout form.** Each form carries an idempotency key;
  order writes run under a per-school advisory lock that also numbers the
  order, so a form sent twice (a double press, a lost reply) returns the first
  order. A class sale uses its key as the `class_sale_id` the same way.
- **D7. Cancelling undoes the bill, never a hand-over.** Only an order with
  nothing handed over can be cancelled, with a reason.
  - Fees invoice: its OPEN charges are voided. Once a charge is on an invoice
    the cancel is refused (`ORDER_INVOICED`); the bursar cancels that invoice
    first.
  - Store invoice: if unpaid, it is cancelled in the same transaction
    (`cancelInTransaction`, the code the Bursary's cancel uses) and its charges
    voided; with a payment, refused (`ORDER_PAID`).
  - Counter: allowed; the person gives the money back, and the order keeps the
    reason.
  Items already handed over come back as a RETURN on the item's page, and any
  money owed is sorted out under Bursary, as before.
- **D8. Packs hold items, not sizes.** A pack line with one live size needs no
  choice; an item with sizes needs one per child. The pack's price is shown
  only when it does not depend on sizes (`fixedTotal`).
- **D9. Who may.**

  | Action | Permission |
  |---|---|
  | Sell, preview, cancel, sell to a class | `store.sell` (owner, admin, bursar) |
  | See orders and packs | `store.read` or `store.sell` |
  | Hand over | `store.manage` or `store.sell` (the storekeeper hands over; selling stays with the bursar) |
  | Make and change packs | `store.manage` |
  | Billing settings | owner, admin (as the price list) |

  No new permission or role.
- **D10. Limits.** 100 lines per order, 1,000 of a line, ₦10,000,000 per line
  and per order (one charge's ceiling), 200 children per class sale.

## 3. As built

**Data.** Migration `20261211120000_store_orders`:
- `store_orders`, `store_order_lines`, `store_packs`, `store_pack_items`, all
  under FORCE RLS `tenant_isolation`; children reference `(school_id, id)` of
  their parent.
- CHECKs: the buyer matches its columns; students are billed and everyone else
  pays at the counter; `invoice_id` exactly for store invoices; a counter
  method exactly for counter orders, never PAYSTACK; a cancelled order has a
  time and a reason; a line's amount is quantity × price; collected stays
  between 0 and the quantity.
- `schools.store_billing_default` (FEES_INVOICE or STORE_INVOICE) and
  `schools.store_billing_seller_choice` (false).
- `store_movements.order_line_id`; the sale CHECK now accepts a SELL with a
  price and either a student or an order line.
- No SECURITY DEFINER function; count stays 23.

**Charges.** One per student line: kind `STORE`, `sourceModule`
`store-order`, `sourceId` the line id, description
`"<item> (<size>) × <n> (SO-000042)"`.

**Routes** (under `/api/v1/store`):

| Route | Guard (service check) |
|---|---|
| `GET checkout` | `store.sell` |
| `POST orders/preview` | `store.sell` |
| `POST orders` | `store.sell` |
| `GET orders` (`?toCollect=&q=&from=&to=&studentId=&classSaleId=`), `GET orders/:id` | `store.read` (read or sell) |
| `POST orders/:id/collect` | `store.read` (manage or sell) |
| `POST orders/:id/cancel` | `store.sell` |
| `GET packs`, `GET packs/:id` | `store.read` (read or sell) |
| `POST packs`, `PUT packs/:id` | `store.manage` |
| `POST class-sales/preview`, `POST class-sales` | `store.sell` |
| `GET reports/takings` | `store.read` |
| `PUT settings` now also takes `billingDefault`, `sellerMayChooseBilling` | owner, admin |

**Audit.** `store.order.create`, `store.order.collect`, `store.order.cancel`,
`store.movement.sell` (with the order id), `store.pack.create|update`,
`store.class-sale.create`, and the existing `charge.*` and `invoice.issue|cancel`.

**Tests.** `apps/api/src/modules/store/store-orders.service.spec.ts`, against
real Postgres.

## 4. Not in this change

- Parents ordering from the portal (`docs/deferred.md`, unchanged).
- Partial cancellation of an order, and refunds from the Store (Bursary's).
- Taking a payment for a fees-invoice order at the counter (pay the fees
  invoice in Bursary as usual).
- The staff app stays read-only for the store.
