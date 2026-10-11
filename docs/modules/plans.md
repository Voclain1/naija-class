# Plans and student caps

Built 2026-10-11. Owner's instruction: "We are still on early access, full
enforcement can take place later, we can build it now though." So the plan
model, the caps and the place they are checked exist now, and the platform
switch that makes them block stays on warn until the owner changes it.

Not a numbered Phase: it is commercial plumbing, like `earlyAccessGrantedAt`.

## What is published

The marketing site (`schoolkit-landing`, `lib/brand.ts`) is the source of the
plans and prices:

| Plan | Price per term | Students |
|---|---|---|
| Free | ₦0 | up to 100 |
| Starter | ₦45,000 | up to 200 |
| Growth | ₦90,000 | up to 600 |
| Professional | ₦180,000 | up to 1,200 |
| Enterprise | custom | by agreement |

Pioneer offer: the first 50 schools keep Free forever, get one term free on a
paid plan, and keep today's prices for life.

## Decisions

### D1. A plan is a column on the school, and only the operator sets it

`School.plan` (`SchoolPlan` enum: `FREE`, `STARTER`, `GROWTH`, `PROFESSIONAL`,
`ENTERPRISE`), default `FREE`, and `School.studentCapOverride` (nullable int).
Set from the platform admin's Manage dialog
(`PATCH /platform-admin/schools/:schoolId/plan`, audited as
`platform_admin.schools.set-plan`). A school cannot change its own plan: there
is no billing yet, so a plan is what the operator agreed with the school.

The override is for deals: an Enterprise school's agreed size, or a promise
made to a pioneer school. Null means the plan's own cap. Enterprise with no
override has no cap.

Prices are **not** stored in the app. Nothing here bills; the marketing site
stays the one place a price is written. When billing is built it brings
prices in, in kobo.

### D2. What counts toward the cap: students on the roll

Students whose status is `ACTIVE`, `INACTIVE` or `SUSPENDED`. `WITHDRAWN` and
`GRADUATED` do not count, so a school never has to delete old records to stay
inside its plan.

### D3. One platform switch: warn or enforce

`PLAN_ENFORCEMENT` on `school-kit-api`: `warn` (the default, and what
production runs during early access) or `enforce`. Anything else reads as
`warn`.

- **warn:** nothing is blocked. Owners and admins see the plan, the count and
  the cap on Settings → Plan, and a notice on the Students page at 90% of the
  cap and over it.
- **enforce:** adding students past the cap is refused with 403
  `PLAN_STUDENT_LIMIT`, and a message naming the plan and the cap. Checked at
  the three places students are created:
  - adding one student (`POST /students`);
  - committing a CSV import (`POST /imports/:jobId/commit`): the whole
    import's valid rows are checked when the commit is asked for, so an
    import is refused rather than half done;
  - committing a scanned register (`POST /student-scan/:jobId/commit`).

  Existing students, and everything else in the app, keep working. Nothing
  becomes read-only.

The switch is platform-wide and not per school, deliberately: enforcement is
switched on once, when early access ends, for everyone. A school that must be
treated differently gets a cap override (D1), which is visible and audited,
rather than a quiet exemption flag.

The check counts and then inserts without a lock, so two admins adding the
last place at the same moment can both succeed. That is accepted: a cap one
student over is not worth a table lock on every student insert, and the
published terms move a school up "from the following billing period" anyway.

### D4. What is not built

- **Feature limits by plan.** The published plans also differ in features
  (Free has no report cards, parent communication, staff management or
  finance dashboard; API access is Professional; and so on). None of that is
  enforced, and it is a much bigger change, touching most modules. It needs
  its own plan, once the owner confirms the feature list is final.
- **Billing.** No invoices to schools, no Paystack subscription, no free-term
  tracking. The pioneer "one term free" is honoured by the operator.
- **Automatic plan changes.** A school over its cap is shown the notice; the
  operator moves it up.

## Surfaces

| Surface | Who | What |
|---|---|---|
| `GET /schools/me/plan` | owner, admin | `{ plan, label, studentCap, studentsOnRoll, enforcement, status }`, where status is `ok`, `near` or `over` |
| Settings → Plan (`/settings/plan`) | owner, admin | the same, in words |
| Students page notice | owner, admin | at `near` and `over` |
| `PATCH /platform-admin/schools/:schoolId/plan` | platform admin | `{ plan, studentCapOverride }` |
| `platform_admin_list_schools()` | platform admin | adds `plan`, `student_cap_override`, `students_on_roll` |

## Switching enforcement on

1. Make sure every school is on the right plan in the platform admin, with
   overrides for any deals. The roster shows students on the roll against
   each cap.
2. Tell schools that are over, before switching.
3. `flyctl secrets set PLAN_ENFORCEMENT=enforce -a school-kit-api`.
4. To undo: set it back to `warn`. Nothing is stored by the switch.
