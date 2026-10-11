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

- **Other feature limits by plan.** The published plans also differ in
  parent communication, staff management, the finance dashboard, API access
  and so on. Only report cards (D5) are limited; the rest needs its own plan,
  once the owner confirms the feature list is final.
- **Billing.** No invoices to schools, no Paystack subscription, no free-term
  tracking. The pioneer "one term free" is honoured by the operator.
- **Automatic plan changes.** A school over its cap is shown the notice; the
  operator moves it up.

### D5. Report cards on Free: a real card, with three extras on paid plans

Owner's decision, 2026-10-11 (options A + B + C). Every plan gets report
cards: scores, grades, typed comments, attendance, the approval workflow and a
printable PDF. Three things are for Starter and up:

| Feature key | What Free gets instead | Where it is applied |
|---|---|---|
| `reportCardBranding` | SchoolKit's template: SchoolKit's colour, no logo, a "Report card by SchoolKit · schoolkit.ng" footer. The school's name and motto stay. | `ReportCardService.getRenderData` and the template |
| `aiReportComments` | Teachers type comments. Drafting is refused with 403 `PLAN_FEATURE_UNAVAILABLE` before anything is queued. | the subject and form-teacher `enqueueBatch` |
| `reportCardPositions` | No class or subject position and no cumulative (year) results, on the PDF or anywhere families see results. | `getRenderData` and `ReleasedResultsService.getForStudent`, the one reader for the portal, the app and the result checker |

Like the caps, they apply only under `PLAN_ENFORCEMENT=enforce`; under warn
every school has all three, and Settings → Plan lists them as "Free during
early access". The school's own position switches keep working on paid plans;
on Free the report-card settings page says the plan leaves positions off.

Staff screens (the report-card board, the gradebook) still show positions on
every plan: they are computed anyway, and they are the school's own working
data, not what goes to families.

**PDFs are frozen when rendered**, so a plan change shows on cards rendered
afterwards. The render worker is a separate app; each render job carries the
API's `PLAN_ENFORCEMENT`, so the secret is set once, on `school-kit-api`.

**Found while building this:** report-card PDFs had never shown a school's
logo. The template was given the stored path, which a page loaded with no base
URL cannot fetch. It now gets the logo as a data URI, as receipts do, and uses
the school's own colour (`primaryColor`), which it also never read.

## Surfaces

| Surface | Who | What |
|---|---|---|
| `GET /schools/me/plan` | owner, admin | `{ plan, label, studentCap, studentsOnRoll, enforcement, status, features }`, where status is `ok`, `near` or `over`, and each feature says whether the plan includes it and whether the school has it now |
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
