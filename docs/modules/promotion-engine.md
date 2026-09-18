# Promotion engine

**Status:** built 2026-09-17, verified in a browser 2026-09-18. Branch `phase-4/guardians-roster` (carried in the
same working tree; see "Open before merge" at the bottom).

Move every class up at the start of a new session — Primary 1 into Primary 2,
and so on — in **one screen and one approval**, instead of arm by arm.

## Why this exists

Two separate gaps, closed by one feature.

**1. There was no way to start a new academic year.** The old carry-over wizard
(`/enrollments/bulk`) refused a cross-year roll outright, by design:

> if the target term and the source term are in different academic years, we
> refuse the carry-over outright (Phase 1 has no promotion engine; cross-year
> arm assignment isn't a meaningful default)

That refusal was correct — across a year boundary a straight copy is wrong,
because JSS 1 students belong in JSS 2, not back in JSS 1. But it left schools
with no supported path into a new session at all. A promotion engine has been
deferred in `phase-2.md`, `phase-6.md` §1145/§1533 and `phase-8.md` D12 (where
the report card's promotion status is explicitly *"not a promotion engine"*).
This is that engine.

**2. The within-year carry-over has been switched off since 2026-08-25.** See
`docs/runbooks/carry-over-incident-2026-08-25.md`: one click moved an entire
school's 12 students into a single arm, and the per-term uniqueness rule then
made every other arm's carry-over a silent no-op. The root cause was fixed, but
`CARRY_OVER_ENABLED` was left `false` pending remediation, and nothing has
re-enabled it.

This engine covers both cases, so the old wizard does not need to come back.

## D1 — One operation, two modes, derived from the terms

The admin picks a source term and a target term. The mode follows from them and
is never sent by the client:

| Mode | When | What it proposes |
|---|---|---|
| `YEAR_PROMOTION` | target term is in a **later academic year** | next class level, same arm position |
| `TERM_ROLL` | both terms in the **same academic year** | the student's existing arm, unchanged |

`TERM_ROLL` is the old carry-over, done school-wide in one approval instead of
once per arm. Both modes produce the same row shape and run through the same
commit path; only the proposal differs. Rolling backwards is refused
(`BACKWARD_TERM` / `BACKWARD_YEAR`).

## D2 — The structural fix: candidates come from enrollments, never from students

**Every candidate row is derived from a real enrollment in the source term.
There is no query for "all ACTIVE students" anywhere in this module.**

The August incident came from a third candidate group built on
`listStudents({ status: "ACTIVE" })` — which, at a school onboarded after the
previous term ended, is the entire school, pre-ticked. In this module a student
who was not enrolled in the source term **cannot appear in the list at all**.
The defect is not fixed, it is unexpressible.

The commit enforces the same thing independently: a decision naming a student
with no source-term enrollment is refused with
`"No enrollment in the source term."`, so a stale or hand-crafted payload
cannot enrol someone the preview never showed. Proven by
`promotions.service.spec.ts` → *"refuses a student with no source-term
enrollment"*.

## D3 — Arm mapping is by POSITION, ordered by `code`

Primary 1B → Primary 2B. The mapping is positional, not by name, because arm
names are per-school free text ("Gold"/"Silver", "Alpha"/"Beta") and position is
what every school means when it says its arms are in order.

Ordering is by `ClassArm.code` ascending, and that choice is load-bearing:
`code` is the stable per-(school, level) identifier
(`@@unique([schoolId, classLevelId, code])`) and does not change when an admin
renames an arm. Ordering by `name` would let a rename silently re-shuffle every
future promotion.

Two deliberate asymmetries, both tested in `promotion-mapping.spec.ts`:

- **Retired (inactive) arms still count for the SOURCE position.** If 1B is
  retired, 1C stays at index 2. Closing the gap would shift 1C's children into
  2B — somebody else's class.
- **Retired arms are never offered as a DESTINATION.** `EnrollmentsService`
  rejects an inactive arm anyway, so proposing one would hand the admin a row
  they cannot commit.

Inactive class *levels* are dropped from the ladder entirely, so the next level
up skips a retired one.

## D4 — When the destination arm does not exist

Reported as a **gap per source arm**, not an error per student: "Primary 1B
(7 students) — Primary 2 has no matching arm." The admin has two ways out, both
on screen:

1. **Create it.** The suggested name/code carries the source arm's own suffix
   (`Primary 1 Gold` → `Primary 2 Gold`, `pri2-gold`), so a school's own arm
   vocabulary survives. The create runs through the ordinary
   `POST /class-levels/:levelId/class-arms` endpoint — **this module creates no
   arms itself** — and the page then re-reads the preview, because the server
   owns the mapping.
2. **Send them to an arm that already exists** in the destination level.

Until one is chosen those students sit at `EXCLUDE` with
`blockReason: NO_DESTINATION_ARM`. Nothing is guessed on the admin's behalf.

## D5 — Per-student actions

| Action | Effect |
|---|---|
| `PROMOTE` | target-term enrollment in the chosen arm; source enrollment → `PROMOTED` (year mode) |
| `REPEAT` | target-term enrollment in an arm of the **same level**; source enrollment → `REPEATED` |
| `GRADUATE` | no target enrollment; source enrollment → `GRADUATED`, and `Student.status` → `GRADUATED` |
| `EXCLUDE` | nothing at all is written |

Every new enrollment stamps `promotedFromArmId` with the source arm — the field
has existed on `Enrollment` since Phase 1 for exactly this and had no writer
until now.

A `REPEAT` into a different class level is refused. Repeating means doing the
same class again; a "repeat" into another level is a promotion wearing the wrong
label, and the audit trail would then lie about what happened. (Moving a
repeating child between *arms* of the same level is allowed — that is a real
decision schools make.)

`TERM_ROLL` leaves the source enrollment `ENROLLED`: carrying a child into next
term does not end their standing in this one.

## D6 — Defaults, and what is deliberately NOT defaulted

The server proposes; the client copies that proposal verbatim and never invents
one (`promotion-plan.ts`, tested in `promotion-plan.spec.ts`).

Proposed `EXCLUDE`, in priority order — each is a reason **not** to move a
child, and the first that applies is the one the admin most needs to see:

1. already holds an enrollment in the target term (`ALREADY_ENROLLED`)
2. the student's own status is not `ACTIVE`
3. the source enrollment is not `ENROLLED` (transferred, withdrawn, already rolled)
4. no destination arm (`NO_DESTINATION_ARM`)

These students are still **listed** — an admin must see the whole class — but
never moved by default.

At the top of the ladder there is no next level, so the proposal is `GRADUATE`
(`NO_DESTINATION_LEVEL`).

## D7 — Graduation needs its own confirmation

Graduating writes `Student.status = GRADUATED`, which is the only thing this
endpoint does that reaches outside the two terms being rolled — it takes the
child off the roster everywhere. So `confirmGraduations: true` is required
whenever any decision is `GRADUATE`, surfaced as a separate checkbox in the
approval dialog rather than a row buried in a list of hundreds. Refused
otherwise with `GRADUATIONS_NOT_CONFIRMED`.

This mirrors `StudentsService.graduate`, including its refusal to graduate a
`WITHDRAWN` student — a bulk screen is the wrong place to override that.

## D8 — Permissions

`PROMOTION_PERMISSIONS = ["promotion.read", "promotion.commit"]`. Two, not one,
and the split is the point: **looking at the plan is deliberately cheaper to
hold than applying it.** One commit writes an enrollment for every student in
the school — the largest single write any school-scoped role can make.

Owner (`*`) and admin only; teacher and bursar get neither. Granted in
`system-roles.ts` and in the idempotent data migration
`20260917120000_promotion_permissions`, the
`20260914140100_phase_8_cp3_timetable_permissions` pattern.

Not a numbered phase, so it gets its own descriptively-named constant per
CLAUDE.md's "Permission naming for work that isn't a numbered Phase".

## D9 — Idempotent, by design and as the recovery path

A student already enrolled in the target term is counted in `skipped` and
nothing is written for them. Re-running an interrupted or partially-approved
promotion is therefore safe, and **is** the documented recovery path — which
matters, because the August incident's worst property was being irrecoverable
from the UI.

## Endpoints

```
GET  /promotions/preview?sourceTermId=&targetTermId=   promotion.read
POST /promotions/commit                                promotion.commit
```

`commit` returns `200`, not `201`: the response is a summary of what happened
(`enrolled` / `promoted` / `repeated` / `graduated` / `skipped` / `errors`), not
a created resource with an id.

One audit row per commit, action `promotion.commit`, anchored at the **target
term** — matching `enrollment.bulk-create`, so both roll-forward actions are
found by the same audit query. Metadata carries the mode, both term ids, and
every count.

The commit runs in one `withTenant` transaction with `timeoutMs: 30_000`. It
touches the whole school, and the default 5s interactive-transaction budget is
the one case `withTenant`'s P2028 retry cannot help with (a body timeout just
re-runs the same slow work — see `tenant-client.ts`). Round-trips are held to a
fixed handful: one `createMany`, one `updateMany` per bucket.

## Files

| Path | What |
|---|---|
| `packages/types/src/promotions/` | DTOs + Zod schemas |
| `apps/api/src/modules/promotions/promotion-mapping.ts` | the pure mapping rules (no Prisma, no Nest) |
| `apps/api/src/modules/promotions/promotions.service.ts` | preview + commit |
| `apps/api/src/modules/promotions/promotions.controller.ts` | the two endpoints |
| `apps/web/src/lib/promotions/promotion-plan.ts` | the screen's decision state, pure |
| `apps/web/src/app/(admin)/enrollments/promote/page.tsx` | the screen |
| `packages/db/prisma/migrations/20260917120000_promotion_permissions/` | role grant |

No schema migration: `Enrollment.promotedFromArmId`, `EnrollmentStatus.PROMOTED`
and `.REPEATED` all already existed and were simply unused.

## Tests

| Spec | Runs against | Count |
|---|---|---|
| `promotion-mapping.spec.ts` | pure | 15 |
| `promotions.service.spec.ts` | real DB, real RLS, real audit | 13 |
| `promotion-plan.spec.ts` | pure | 10 |
| `e2e/tests/promotion-engine.spec.ts` | real browser, real API, real DB | 2 |

All passing as of 2026-09-18. Also re-ran green: `permissions-coverage`,
`rbac-two-gate-conformance`, `audit-coverage`, `app-module-boots` (195 tests).

The E2E suite walks the whole feature in Chromium — preview → arm gap → create
the missing class → mark a child repeating → approve → verify what landed in the
database through the API — plus the idempotency case, where a deliberately
partial first run is re-previewed and every already-placed child comes back
excluded.

**Two things only the browser found:**

1. **The success summary wiped itself.** `handleCommit` refreshed the preview so
   rows would come back as "already placed", and `loadPreview` cleared `result`
   — so the "Done" panel vanished in the same tick it appeared. An admin saw the
   list reset with no confirmation anything had happened. Fixed: only a preview
   the ADMIN asks for clears the result.
2. **Term names are not unique.** A school is seeded with its own academic
   calendar at signup, so "Third Term" exists in more than one year. Selecting a
   term by name in the E2E spec picked the wrong year's — and the API correctly
   refused the roll with `BACKWARD_YEAR`. The guard worked; the spec now selects
   by id. Worth knowing for the UI too: the term pickers group options by
   academic year (`<optgroup>`) precisely because the names repeat.

## Open before merge

1. **The 2026-08-25 remediation is still unrecorded.** The kill switch's own
   comment says to flip `CARRY_OVER_ENABLED` only once the affected school's
   placements are corrected and the fix is verified in production; there is no
   record either happened. This module does not depend on that flip — it is a
   separate path with its own permissions — but the affected school's data
   should be confirmed corrected before anyone runs a promotion there.
2. **`/enrollments/bulk` is still present and still kill-switched.** Deleting it
   is a follow-up, not part of this change; the notice on `/enrollments` now
   links here instead of dead-ending.
