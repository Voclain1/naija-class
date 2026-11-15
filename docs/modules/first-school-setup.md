# First-school setup / owner onboarding

Closes audit finding **F-25** — *onboarding does not clearly communicate the
required setup order*.

Shipped 2026-08-29. Scope: what a proprietor or admin is told between
finishing the five-step wizard and having a school that actually runs. Not a
redesign of the admin app, and no change to the wizard itself.

---

## 1. The dependency map

Everything below was established by reading validation rules, service guards,
route guards and existing empty states — not from product intuition. Where the
answer contradicted an assumption, the assumption is recorded as rejected in
§3.

### Done for you at signup — never a step

`packages/db/src/seeds/school-defaults.ts` (`applySchoolDefaults`, called by
both `AuthService.signupOwner` and `PlatformAdminService.createSchool`) seeds
every new school with:

| Seeded | Detail |
|---|---|
| 14 class levels | KG 1 → SSS 3 |
| 14 class arms | one per level, e.g. "JSS 1A" |
| 3 subjects | English Language, Mathematics, Civic Education |
| Grading scheme | WAEC-style: CA1/CA2/Exam at 20/20/60, A1–F9 boundaries |

A school therefore has classes and grading before its owner ever logs in.
These are surfaced as **"already set up for you"**, never as chores.

The seeded catalogue is now an editable starting point, not fourteen rows the
owner must edit individually. **Settings → Academic setup → Class levels**
shows one bulk selector for the levels the school actually runs; **Subjects**
does the same for its catalogue. Saving deactivates unselected rows rather
than deleting them, preserving history and allowing restoration later. At
least one class level and one subject must remain selected.

### Collected by the wizard — normally already done

Onboarding step 5 (`Step5Success`, not skippable since 2026-08-21) collects
the academic year and its three terms, one of which is current.
`CalendarSetupPrompt` is the recovery surface for schools that finished
onboarding before that step existed.

### Required — a core workflow is inert without it

| Step | Evidence |
|---|---|
| **School year + current term** | `EnrollmentsService.create` resolves `academicYearId` from a `Term`; `InvoiceGenerationService.fetchTerm` and `AttendanceService` both require a `termId`; `DashboardService.getAdminDashboard` 404s without one. |
| **Students on the roster** | Nothing downstream has a subject without them. |
| **Students enrolled in the current term** | The register (`AttendanceService`), the arm invoice run, `TeacherScopeService.getMyArmRoster` and the report-card build all read `Enrollment`, never `Student`. |

After the required rows are complete, the checklist offers **Take your first
attendance** as the first operational proof. It links to the existing daily
register; it does not create a second attendance workflow.

**Enrolment is the finding.** Creating a student does not place them in a
class — `apiCreateStudent` and `apiCreateEnrollment` are separate calls, and
the UI has always had them as separate screens. A school that added 400
students and stopped there sees every class, every register and every invoice
run come back empty, all of them "working correctly".

### Recommended — one named workflow is unavailable

| Step | What exactly is blocked |
|---|---|
| **Fee catalog** | With no active `FeeItem`, `GET /invoices/arm/preview` returns `[]` and `POST /invoices/arm/generate` bills nobody — successfully and silently (verified live, 2026-08-29). |
| **Invite teachers** | An owner can do every admin job alone; teachers need accounts before anyone else can mark or score. |
| **Form teachers** | `AttendanceService.assertCanAccessArmAttendance` lets owner/admin mark any arm; a *teacher* may only mark the arm they are form teacher of (403 otherwise). So this blocks teacher-marked attendance, not attendance. |
| **Teacher assignments** | `TeacherScopeService.getMyScope` is built from `TeacherAssignment` rows; an unassigned teacher's gradebook is empty. |

### Optional — nothing is blocked today

| Step | Why it is optional |
|---|---|
| **Class–subject matrix** | See §3 — nothing reads `ClassSubject`. |
| **Guardians / parent portal** | A feature the school opts into. |

---

## 2. What the product does about it

### `GET /schools/me/setup-state`

`SetupStateService` returns the tiered step list, the already-done list, and a
`status` of `setup` / `finishing` / `established`. Owner/admin only — every
action in the list is owner/admin work, so a bursar shown "invite your
teachers" would be handed a button that 403s.

**Every field is a live count.** No `setup_progress` table, no timestamp, no
`localStorage` flag. A school that imported its roster by CSV, or whose bursar
priced fees from another session, is simply already complete on the next read.

### Suppression

```
requiredRemaining > 0                        → "setup"       (always shown)
else !hasRealActivity && recommended > 0     → "finishing"   (shown)
else                                         → "established" (nothing renders)
```

`hasRealActivity` is true once the school has marked a register, issued an
invoice, or entered a score — three different workflows, any one of which is
enough. That, not a dismiss button, is what stops the checklist becoming
permanent furniture for a school that has deliberately skipped fees. A missing
**required** step overrides it: a busy school with no current term still gets
told.

### `SetupChecklist` (dashboard)

Replaced the lone "Get started by adding your first student" card. That card
was not wrong, it was alone — it named the second of three required steps and
said nothing about the third.

**Why a checklist and not a wizard.** The wizard already covers the part of
setup that must happen in one sitting and one order, and is deliberately not
skippable. Everything after it is days-long, delegable work done from
different screens and sometimes by CSV. A second wizard would have to be
abandonable to be usable, and an abandonable wizard is a checklist with worse
ergonomics.

The dashboard does not render the separate logo reminder beside this card.
Logo remains optional and editable in Settings. The first-login orientation is
five cards at most (welcome, Students, Attendance, Fees & payments, finish),
not a tour of every module.

### Daily task discovery (2026-11-15)

Attendance is the same `/teacher/attendance` workflow for owners, admins and
teachers. It is reachable from the main menu, dashboard action bar, attendance
metric, command palette and this checklist. Both “attendance” and “class
register” are search terms. The other dashboard launchers are Record payment,
Add student and Enter scores; early Insights is no longer a first-use shortcut.

### A short menu for a new school (2026-11-15)

New schools begin with five useful areas rather than the entire product
catalogue: Students, Fees & payments, Attendance, Results & report cards, and
Parent communication. **Settings → School modules** lets the owner reveal
Homework, CBT, Health, Transport, Hostel, Library, Store and Insights later.
This only changes navigation and shortcuts; it never deletes existing data or
weakens permission checks. Schools created before this change retain their
full menu until they save an explicit selection. See
`docs/modules/school-module-preferences.md`.

### `PrerequisiteNotice` (workflow screens)

Explains, above the screen's own content, why a workflow would do nothing yet.
Currently on:

| Screen | Missing step | Prevented dead end |
|---|---|---|
| `/enrollments` | students | 14 classes reading "No enrollments yet" |
| `/students` | enrollments (only once a roster exists) | a roster that is in no class |
| `/finance/invoices` | fee-catalog, enrollments | Generate completing with 0 invoices |
| `/report-cards` | enrollments | a board that builds 0 cards |

**It is not a route guard.** Every screen stays reachable and fully
interactive — an owner heading to `/enrollments` to fix the very thing must
not be bounced out of it.

---

## 3. Findings confirmed and rejected

**Confirmed.** F-25 itself; and the specific dead ends above, each reproduced
against a real fresh school.

**Rejected — the gradebook does not need the class–subject matrix.** Grepping
every consumer on 2026-08-29 found `ClassSubject` read by its own CRUD module
and by nothing else in `apps/` or `packages/`. It does not gate the gradebook,
report cards, or teacher assignment (`TeacherAssignmentsService` validates that
the subject is *active*, never that it is linked to the level).
`docs/onboarding-guide.md` lists it at stage 6, which reads as a prerequisite;
it is not one, and this module says so rather than repeating the implication.

**Rejected — "the enrollments page shows 'No terms yet'".** Observed on a
first pass and traced to the term dropdown's async load, not a real state. Re-
checked with a longer settle: terms populate correctly.

**Rejected — "the fresh dashboard renders an empty `<main>`".** An artefact of
sampling the page while the first-login tour overlay was mounting.

---

## 4. Known gaps

- **Teacher-side screens have no prerequisite notices.** `GET /schools/me/setup-state`
  is owner/admin only, deliberately, so a teacher landing on an empty gradebook
  still gets only the screen's own empty state. Telling them *why* would need
  a separate, teacher-safe read; not built.
- **`/settings/academic/class-subjects` has no notice**, because nothing it
  gates is real yet (§3). If a workflow ever starts reading `ClassSubject`,
  the step must be re-tiered and a notice added.
- **The checklist does not detect a school that undoes a step** beyond what the
  counts show — e.g. deactivating every fee item flips `fee-catalog` back to
  outstanding, which is correct, but a `finishing` school could reappear after
  looking established if its only invoice were cancelled. Cancelled invoices
  still count as activity, so this is a narrow case and left as-is.
