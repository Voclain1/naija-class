# Revenue trajectory (term collections time-series)

Plan-first. **Nothing in this document is built yet.** Scope approved
2026-09-08 as part of the dashboard redesign initiative; this document covers
only the trajectory aggregation, which is the one genuinely new backend
surface in that scope.

Not a numbered Phase — this belongs to the visual/UX overhaul initiative that
began with the admin dashboard rebuild (CLAUDE.md, "Design system").

## 1. Why this exists

`FinanceDashboardDto` is entirely whole-term scalars: invoiced, collected,
rate, outstanding, expenses, net position. It answers *where did the term end
up*. It cannot answer *how did it get there* — whether collections arrived
steadily, or all in week one, or not until the proprietor started calling
parents in week nine. That shape is the single most actionable thing a
proprietor can see about fee collection, and no surface in the app carries it.

Nothing existing covers this. `collectionByGroup` is a per-level breakdown at
a single instant; the attendance sparkline is a different domain. This is a
new aggregate.

## 2. D1 — Timezone: **UTC**, decided explicitly

This is the decision this document exists to pin down, and it is deliberately
NOT inherited from whichever helper sits nearest in the file.

**The codebase has two documented conventions, and they disagree on purpose:**

- `ai.constants.ts:29-39` picks **UTC** for AI budget periods, reasoning that
  a budget window is *an accounting boundary, not a school-day boundary*.
- `docs/modules/bursar-dashboard.md` D2 picks **Africa/Lagos** for the
  bursar's today-collections view, reasoning that a bursar reconciling a cash
  drawer means *their* day — and explicitly noting the divergence from
  `ai.constants.ts` as considered rather than accidental.

That second decision is approved but **not built** — see §7. So there is no
nearby implementation to inherit from even if inheriting were acceptable.

**Applying the bursar doc's own test to this feature yields UTC.** The test it
sets is: *is this an accounting boundary or a school-day boundary?*

A term revenue trajectory is an accounting artifact. It is keyed to terms and
invoices, its endpoint reconciles against term accounting totals, and nobody
acts on it at a specific hour of a specific day — a proprietor reads it weekly
or monthly to decide whether to chase arrears. It is not a cash drawer being
counted at close of business. Same test as the bursar dashboard applied
honestly, different question, different answer — exactly as the bursar
decision itself diverges from `ai.constants.ts`.

Three reinforcing reasons:

1. **The bucket boundaries are zoneless by construction.** Week buckets derive
   from `Term.startDate`/`endDate`, both `@db.Date` — no time-of-day, no zone,
   per CLAUDE.md's "midnight in which zone?" rule. Converting a zoneless
   calendar date into a Lagos *instant* invents information the row does not
   contain. Zoneless in, zoneless out.
2. **Week alignment must match the attendance trend.** `dashboard.service.ts`'s
   `weekStart()` is UTC and carries a comment stating that local-time mutators
   would be the bug. A Lagos-aligned finance week beside a UTC-aligned
   attendance week would put two charts on sibling dashboards on different
   calendars, with no visible explanation.
3. **Magnitude.** At weekly grain, UTC vs Lagos misassigns only payments
   stamped between 00:00 and 01:00 Lagos on a Monday, and moves them to an
   adjacent bucket rather than producing a wrong total. The bursar's daily
   grain has no such tolerance — a 23:30 Lagos payment landing in "tomorrow"
   breaks a drawer reconciliation, which is precisely why that decision went
   the other way.

**Reuse `weekStart()` from `dashboard.service.ts`; do not write a second one.**
Lift it to a shared util if the trajectory lives outside that file.

**What would reverse this:** adding a daily grain to this chart, or
introducing a per-school timezone field. Both make the school-day boundary the
right one. Neither exists today.

## 3. D2 — The reconciliation gap (the real risk in this feature)

The trajectory's cumulative endpoint will **not** equal
`FinanceDashboardDto.totalCollected` unless this is handled deliberately, and
the divergence hits every school with late payers — i.e. essentially all of
them.

`totalCollected` is `sum(Invoice.totalPaid)` over invoices with
`termId = :termId` and status not in DRAFT/CANCELLED
(`finance.service.ts:196-199`). **It carries no date filter whatsoever.** The
trajectory buckets by `Payment.paidAt`. So a payment settling third-term
arrears during the holidays belongs to the term's `totalCollected` but falls
outside every one of the term's week buckets. Curve ends low; KPI card beside
it reads higher; nothing errors.

**Decision: buckets run from `Term.startDate` to `min(Term.endDate, today)`,
with an explicit out-of-term bucket at EACH end** — "before term start" and
"after term end" — each emitted only when rows actually fall there. The
out-of-term buckets are what make the series reconcile, and they are honest:
early payment and late collection are both real things a proprietor wants to
see, not artifacts to hide. A footnote stating the curve reconciles to the KPI
card is part of the deliverable, not optional polish.

**Corrected 2026-09-08, during test design.** This decision originally
specified only a *trailing* bucket. Writing the "term that hasn't started yet"
case in §8 exposed two defects in that formulation:

1. **The range inverts.** When `today < startDate`, `min(endDate, today)` is
   `today`, which is *before* `startDate` — a negative range. The formula
   silently produces a nonsense window rather than an empty one. Degenerate
   range must be handled explicitly: emit zero in-term buckets.
2. **A not-yet-started term can already hold real money.** Schools invoice the
   coming term before it begins and parents pay early — so a future term can
   carry substantial `totalInvoiced` and `totalCollected` while having zero
   in-term week buckets. With only a trailing bucket, every naira of it
   vanishes from the curve and the D2 reconciliation this decision exists to
   guarantee fails hardest in exactly the case the original wording ignored.

A leading bucket is the symmetric fix. Worth recording that the edge case
found the bug, not the other way round.

## 4. D3 — Which payments count

- **`status: "SUCCESS"` only.** Refunds set the payment row to `REVERSED` and
  recompute `Invoice.totalPaid` from remaining SUCCESS rows
  (`refunds.service.ts:148-169`). Filtering SUCCESS keeps the trajectory in
  exact parity with `totalPaid`; omitting it silently breaks D2's
  reconciliation with no error surface.
- **Join through to the invoice and apply the same
  `status notIn [DRAFT, CANCELLED]` filter** the KPI uses. A payment against a
  cancelled invoice is an edge case, but an unfiltered trajectory would count
  money the KPI card does not.
- **A reversal is dated at refund time, not at the original `paidAt`.** The
  historical bucket therefore drops retroactively. This is consistent with
  `totalPaid` and is the correct behaviour; it is also the second reason the
  chart needs the as-of caption in D5.
- **`paidAt` is operator-supplied for manual payments**
  (`payments.service.ts:254,286`), so it is backdatable. A past bucket can
  change after the fact. Correct for a school recording cash late; the chart
  must say so rather than imply an immutable series.

## 5. D4 — The invoiced series

- Bucket on `Invoice.issuedAt`, falling back to `createdAt` when null:
  `issuedAt ?? createdAt`, matching `invoice-arm-backfill.ts:64`. `issuedAt`
  is nullable and older rows have it unset; without the fallback those
  invoices vanish from the curve while remaining in `totalInvoiced`.
- Same `status notIn [DRAFT, CANCELLED]` filter as the KPI.
- Series is **cumulative**, not per-week deltas — the question is "how did the
  gap between billed and collected close", which only reads correctly as two
  cumulative curves.

## 6. D5 — Endpoint shape

A separate `GET /finance/revenue-trajectory?termId=` rather than widening
`FinanceDashboardDto`. Same reasoning the bursar doc's D1 gives for
`/finance/operations`: the term-report KPI load should not pay for a
per-week scan it never renders, and the two are independently changeable.

Reuses the existing `finance.dashboard.read` permission — **no new permission
constant.** Response carries `asOf` (matching `AdminDashboardDto`'s precedent)
because D3 and D4 both make this series retroactively mutable.

Frontend note, not backend scope: there is no charting library in this repo —
`recharts`, `visx`, `chart.js` and `d3` are all absent, and every chart is
hand-rolled SVG. The monotone-spline helpers in
`apps/web/src/components/admin/attendance-sparkline.tsx` are reusable. A
two-series chart with axes and a legend is a materially larger build than that
sparkline; "add a chart dependency" is a live decision, not a default.

## 6a. D6 — Future weeks are `null`, not `0`, and not truncated

**Changed 2026-09-08, after D2/D5 were approved.** The approved plan truncated
the series at `min(endDate, today)` — §8 originally said "no empty future
weeks padding the right-hand side of the chart". That is now reversed: the
**full term** is emitted, and the trailing run of weeks that have not arrived
yet is marked `isFuture: true` with `invoiced` and `collected` set to `null`.

Two reasons the truncation was the weaker choice:

1. **The remaining runway is information.** A proprietor looking at week 4 of
   13 needs to see that nine weeks remain. Truncation renders week 4 as the
   end of the term and hides the gap they still have to close.
2. **It forces the honest distinction into the type.** `null` means "no data
   yet"; `0` means "genuinely nothing collected". A future week rendered as
   `0` plots on the axis and draws a cliff that reads as a collections
   collapse. Truncation dodged that question rather than answering it — and
   the same distinction is what the attendance chart is missing in accuracy
   defect (a), so encoding it here sets the pattern for that fix.

Only the **contiguous trailing run** is nulled, so the cumulative series never
develops a hole in its middle, and the run is suppressed entirely when an
AFTER_TERM bucket exists (rows dated past the term mean the series continues).

## 7. Out of scope

- **The bursar dashboard's Unit B (`/finance/operations`)** and its
  Africa/Lagos day handling. Approved 2026-08-21, still unbuilt. When it
  ships, the codebase will hold both conventions in live code for the first
  time, and CLAUDE.md should gain a short "date boundaries" note recording
  which surface uses which and why. Flagged here, not done here.
- Daily grain, per-school timezones, expense overlay, multi-term comparison.

## 8. Tests

**Harness: real Postgres, mirroring `dashboard.service.spec.ts` exactly** —
`basePrisma` + `withTenant`, one isolated school per test created through
`AuthService.signupOwner` with a `runId` suffix, `afterAll` cleanup deleting
schools by id. No mocked Prisma: this is aggregation logic, and a mock would
assert the query I wrote rather than the rows Postgres returns.

**Date fixtures anchored in UTC, never local time.** `dashboard.service.spec.ts`
carries the reasoning in a comment worth repeating here: a local-time fixture
"would silently agree with a local-time bug in the service under test (both
wrong the same way) and never catch it." Every date in these fixtures is built
with `Date.UTC(...)`.

### Term-boundary cases (§3, D2)

- **Term not yet started** (`startDate > today`): zero in-term buckets, no
  negative range, no crash. **And with an invoice issued plus a payment taken
  before `startDate`, both appear in the leading bucket and the series still
  reconciles** — this is the case that found the D2 bug, so it is a
  regression test, not a hypothetical.
- **Term already ended** (`endDate < today`): full span of in-term buckets,
  plus a trailing bucket holding a payment dated after `endDate`.
- **Term in progress**: the full term is emitted, with the trailing run of
  not-yet-arrived weeks marked `isFuture` and carrying `null` (see D6).
- **Single-day term** and **term where `startDate === endDate`**: one bucket,
  not zero, not two.

### Week-boundary calculations (§2, D1)

- **Term starting mid-week** (e.g. a Wednesday): assert explicitly whether
  week 1 is the Monday-snapped week containing `startDate` (so the bucket
  spans days before the term) or the partial stub. `weekStart()` snaps to
  Monday, so it is the former — the test pins that as intended rather than
  incidental.
- **Term ending mid-week**: final in-term bucket is partial and still counted.
- **Term spanning a UTC month boundary**, and one **spanning a year boundary**
  — `weekStart()` uses `setUTCDate` arithmetic, which is where off-by-one
  rollover bugs live.
- **The D1 assertion, stated as intent:** a payment stamped 00:30 Lagos on a
  Monday (= 23:30 UTC Sunday) lands in the **earlier** week. The test name
  says this is the UTC convention deliberately chosen in D1, so a future
  reader who flips it to Lagos sees a failing test that explains itself
  instead of one that just looks wrong. Lagos is UTC+1 with no DST, so this
  one-hour Sunday-night window is the entire behavioural difference between
  the two conventions at weekly grain.

### Aggregation correctness (§4, §5)

- A `REVERSED` payment is excluded and its bucket drops (D3).
- A payment against a `CANCELLED` invoice is excluded, matching the KPI's
  filter (D3).
- An invoice with null `issuedAt` still appears via the `createdAt` fallback
  (D4).
- Series is cumulative and monotonically non-decreasing within each of the two
  lines.

### The reconciliation test (the important one)

Cumulative final value **including both out-of-term buckets** equals
`getDashboard().totalCollected` for the same term — exercised with a school
carrying an early payment before `startDate`, a normal in-term payment, a
late payment after `endDate`, and one reversal. If this passes, D2 holds; if
it fails, the chart is lying next to a KPI card that is not.

Same assertion for the invoiced line against `totalInvoiced`.

### Tenancy

- Cross-tenant RLS on the new endpoint, per the standing pattern: a school-A
  session sees zero school-B rows in the series.

## 9. Estimate

Backend aggregate + service specs: 1–1.5 days.
Frontend two-series chart: 1.5–2 days (hand-rolled; less with a library).
E2E + doc update: shared with the wider initiative's 1 day.

**Trajectory subtotal: 2.5–3.5 days**, unchanged from the feasibility read.
