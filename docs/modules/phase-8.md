# Phase 8 — Reports, Timetable, Event Calendar, Exams, Result Checker, AI Tutor

**Status:** plan-first investigation **approved 2026-09-13** and merged
(PR #297). Three rounds of decisions were recorded the same day (§3: D1–D8,
D9–D14, D15–D18). CP0 (doc reconciliation) is in progress. Nothing is built.
Each checkpoint still needs its remaining open questions (§11) answered, and
its own short plan-first appended here, before it starts.

**Scope decision (Arinzechukwu, 2026-09-13):** all six features are in scope.
Five form **Phase 8 (CP0–CP6b)**; the AI Tutor is **Phase 8b (CP7–CP8)**
from the start (D1, D8). This document doesn't re-argue either point. What it does do is calibrate the
size honestly, sequence engineering-only work first, and separate out what is
blocked on decisions that aren't engineering decisions.

---

## 0. Why this document exists in this form

The investigation behind this plan was done in conversation on 2026-09-13 and
approved there. This project has already lost work that way: Phase 7's first
plan-first and vendor comparison existed only in conversation history and had
to be re-derived (`phase-7.md` §0). So this plan is committed **before** any
implementation, and decisions are recorded here as they arrive rather than
reconstructed afterwards.

Every "verified" claim below was checked against the repo at
`refactor/portal-base-url` @ `155c4b0` on 2026-09-13. Anything **not**
verified is labelled as such and collected in §13.

---

## 1. Where the six items come from

The six features are exactly the admin sidebar's "Coming soon" list,
`LATER_PHASE_ITEMS` in `apps/web/src/components/admin/nav-items.ts`:

| Nav label | Route | Origin |
|---|---|---|
| Reports | `/reports` | pre-existing disabled item |
| AI Tutor | `/ai-tutor` | ARCHITECTURE.md §7 "Student tutor" |
| Timetable | `/timetable` | added 2026-07-31 at Arinzechukwu's request |
| Event Calendar | `/events` | added 2026-07-31 |
| Assessments & Exams | `/exams` | added 2026-07-31 |
| Result Checker | `/result-checker` | added 2026-07-31 |

The four items added on 2026-07-31 were labels, not specs. That is why three
of the six needed real clarification, most of which §3 now provides.

`nav-items.spec.ts` asserts that no shipped feature stays under "Coming
soon". Each checkpoint that ships a feature must therefore move its item from
`LATER_PHASE_ITEMS` into `NAV_ITEMS`, gated on a real permission, in the same
PR.

---

## 2. Document conflicts this phase must reconcile

Found during the investigation. **None of these docs are edited by this
plan document itself; CP0 reconciles items 1–3.**

1. **ARCHITECTURE.md §9 assigns Phase 8 to Assignments** ("Phase 8 —
   assignments (3 weeks)"). **Resolved by D14:** Assignments moves to Phase 9.
2. **`docs/deferred.md` places Timetable in Phase 9** ("Timetable, transport,
   library, hostel — Phase 9"). Its own "Timetable generator" entry already
   flags the disagreement with ARCHITECTURE.md §6.5. This plan resolves it in
   favour of Phase 8 for a **manual builder**.
3. **CBT is now explicitly its own future phase** (D5). The "CBT / online
   exams" entries in `docs/deferred.md` should say so, as part of CP0's
   reconciliation.
4. **The NDPR review is still open** (`docs/deferred.md`, "NDPR compliance
   posture for third-party AI / embeddings vendors", captured 2026-09-01).
   The AI Tutor would be its sharpest expansion yet (§6.3).

**Corrections to the brief this investigation started from:**
- Guardian and student results shipped in **Phase 6 slice 4**, under D28 (one
  shared `RELEASED`-gated reader, now `released-results.service.ts`) and D29.
  D42 is Phase 7's teacher decision point.
- Phase 6 was organised as slices; the CP structure used here comes from
  Phase 7.

---

## 3. Decisions recorded — Arinzechukwu, 2026-09-13

Each decision is recorded as given. Where the code shows it changes scope or
raises a follow-up question, that is flagged here and handled in the relevant
section.

**D1 — The phase may split into Phase 8 / 8b.** Not a decision to split now;
it confirms a split is allowed if the full scope runs long, rather than forcing
an artificial single boundary. See §12.3 for the natural split point.

**D2 — Reports include teacher performance views, owner/admin only, never
visible to other teachers.** This reverses the investigation's "out of v1"
recommendation. The access-control design this requires is in §4.4. Adds
**+3–4 days** to CP2.

**D3 — Timetables can be per-term or per-year, and this varies by school and
even by class arm.** A real flexibility requirement, not a simplification.
The data model supports it cleanly (§7.2). The cost is not in the schema but
in conflict detection, which becomes considerably harder. Adds **+4–5 days**
across CP3 and CP4.

**D4 — Event Calendar: seeded national events plus school-admin-added events
on real dates, visible to all users. No RSVP in v1.** Resolves Q2 and Q5. The
interpretation of the remaining event questions (Q3, Q4) is recorded in §8.1
for confirmation rather than assumed silently. Seeded national events need a
**platform-wide, non-tenant** table, which is new ground (§8.3).

**D5 — CBT (online exams) is out of Phase 8, and confirmed as its own separate
future phase.** Deliberately deferred, not silently dropped. Narrows Q15 to
options (i)–(iii) in §9.2.

**D6 — Result Checker scope, confirmed:**
- Once a school publishes results, students and parents go to the **school's
  result-checker page**.
- They enter a Student ID / registration number / secure PIN, **select session
  and term**, and view or download the **full report card**: subjects,
  scores, grades, position, attendance, teacher comments, promotion status.
- **Schools choose per result** whether access is **free via the parent
  portal** or **paid via PIN**. Both are supported.
- Schools **retain control** over releasing and withdrawing results.
- These are SchoolKit's own results — **no integration** with WAEC/NECO
  systems.

This matches the investigation's CP6 shape and resolves Q16 ("school's choice,
both supported"). But the code shows the real scope is **substantially
larger** than the original 6–10 day estimate, for four specific reasons (§10.2).
CP6 is split into CP6a and CP6b.

**D7 — AI Tutor safeguarding is deferred as its own dedicated workstream,
separate from the six features, and nothing is to be implemented yet.** This
replaces Q11 and is recorded in full, with the prohibition stated explicitly,
in §6.4.

**D8 — The AI Tutor is Phase 8b from the start (Arinzechukwu, 2026-09-13,
confirmed after the D1–D7 re-scope).** Safeguarding (D7) already blocks any
student rollout, however fast the engineering goes, so the Tutor (CP7–CP8) is
planned as Phase 8b rather than held as a possible late split. Phase 8 is
CP0–CP6b, and may itself split further after CP4 if it runs long. See §12.3.

### 3.1 Second round — Arinzechukwu and the project lead, 2026-09-13

Recorded after PR #297 merged. Each resolves an open question from §11.2 and
keeps its question number for traceability.

**D9 (Q19) — PINs are sold offline only in v1** (scratch cards, cash, at the
school). **Online purchase through Paystack is deferred** as a clearly scoped
fast follow-on, not built in Phase 8. Consequences:
- No money moves through SchoolKit for results access in v1, so no
  `FinanceService` path, payment webhook or PIN-delivery flow is needed. The
  Money hard rules are not engaged by CP6b.
- The **+5–8 days for online sales is removed** from every estimate (§10.5,
  §12.4).
- **Recorded so the fast follow-on isn't a blank:** when built, every sale
  goes through `FinanceService` with `audit_logs`, via the school's existing
  Paystack subaccount (`paystack-assisted-setup.md`), with a webhook and PIN
  delivery. The +5–8 day estimate stands as its starting point.

**D10 (Q17) — PINs are batch-generated; the school distributes them** in
whatever quantity and grouping it chooses. No per-student purchase or
issuance flow in v1. This implies a PIN is **not bound to a student when it
is generated**. It binds on first successful redemption (§10.3). Two design
points follow that D10 doesn't settle, recorded as **Q29** and **Q30**.

**D11 (Q21) — In paid (PIN) mode, results are locked behind the PIN in both
the guardian portal and student mobile.** The access-mode gate goes in the
shared `RELEASED` reader (Phase 6 D28), so both portals and the public checker
enforce it from one place. Two details for CP6b's plan-first to confirm, with
recommendations in §10.3: where a PIN is entered from inside a portal, and
whether a school can change access mode after release.

**D12 (Q23) — Promotion status is a display field on the report card, set at
principal approval.** Not a promotion engine: it never creates, changes or
reads `Enrollment` rows, and `EnrollmentStatus.PROMOTED` / `REPEATED` are left
exactly as they are. Detail in §10.3 (CP6a).

**D13 (Q18) — A year-wide timetable and a term timetable may coexist for the
same class arm. When a term timetable exists, it replaces the year-wide one
entirely for that term.** No slot-by-slot merging. This is the model §7.2 and
§7.3 already assumed, so **the Timetable estimate does not change**.

**D14 (Q1) — Assignments moves to Phase 9.** CP0 updates ARCHITECTURE.md §9
and `docs/deferred.md` to match (§12.1).

### 3.2 Third round — CP6b design approvals, 2026-09-13

Approved as proposed in §10.3 and §11.2.

**D15 (Q29) — A PIN batch is scoped to one academic year and term, chosen at
generation.** A card sold for "First Term 2026/2027" can't be spent on any
other term.

**D16 (Q30) — PINs are exported once, at generation; storage stays hashed.**
No re-export. A lost export is handled by voiding the batch and generating a
new one. The plaintext PIN exists only at the moment of generation, so a
database leak exposes no usable PINs. The `encrypt_bvn`-style encrypted
alternative was considered and rejected.

**D17 — A PIN redeemed anywhere unlocks that student's result for that term
everywhere:** the public checker, the guardian portal and student mobile. A
family never spends a second use of a card they have already redeemed.

**D18 — Access mode (free / PIN) is fixed at release.** Changing it goes
through the existing owner-only reopen. This closes both failure directions:
free → paid would retract results families have already seen, and paid → free
would silently void cards families have already bought.

**Still open and owned by Arinzechukwu on his own timeline:** Q9 (NDPR for the
tutor) and Q10 (the PII hard rule). **They do not block CP0 or any Phase 8
checkpoint;** they must be resolved before Phase 8b's CP7 begins.

---

## 4. Reports

### 4.1 What already exists (verified)

| Domain | Source tables | Already surfaced |
|---|---|---|
| Enrollment | `Enrollment` (one row per term, history kept) | Admin dashboard: this term's count vs the previous term |
| Attendance | `AttendanceRecord` (daily, universal); `SubjectAttendanceRecord` (opt-in via `School.subjectAttendanceEnabled`) | `GET /attendance/summary` and `GET /subject-attendance/summary`, per class arm per term. **The only UI consumer is the teacher page** `(teacher)/teacher/attendance/summary`; admins have no attendance report. |
| Academic | `Assessment` (student × subject × term: total, letter grade, positions); `ReportCard` | Gradebook, report cards. `InsightsService` computes four AI-routed reports, each capped at 15 rows |
| Finance | `Invoice`, `Payment`, `Expense`, `PayrollItem` | Finance dashboard, debtors, revenue trajectory, collection by level |
| Teacher activity | `TeacherAssignment`; `AttendanceRecord.markedBy`/`markedAt`; `AssessmentScore.enteredBy`/`enteredAt`; `Assessment.subjectSignedOffBy`/`At`; `ReportCard.formReviewedBy`/`At`; `LessonPlan` author | Nothing |

Export today is `apps/web/src/lib/csv-export.ts`: client-side formatting of
data already fetched through permission-guarded endpoints.

### 4.2 v1 scope

Read-only, scoped to one term, with every figure computed by the API.

- **Academic:** class-arm and subject averages, pass rate, grade
  distribution, top and bottom students per arm.
- **Attendance:** whole-school and per-arm term rates. Definitions stay
  identical to the existing endpoint: (PRESENT + LATE) / days marked, in
  integer hundredths, EXCUSED counted as not attended.
- **Enrollment:** counts by class level across terms, plus admissions and
  withdrawals per term.
- **Finance:** link to the existing finance surfaces; don't rebuild them.
- **Teacher performance** (D2): §4.4.
- **Export:** CSV through the existing helper.

**Design rule — one SQL layer.** Reports and `InsightsService` share one
query service, so Insights narrates the *same* figures a Reports page shows.

**Follow the "groups" API shape** (CLAUDE.md, Design system) for per-structure
breakdowns. Money stays `bigint` kobo; averages use integer hundredths,
following `ReportCard.overallAverage`.

### 4.3 Not in v1

PDF or Excel export; custom report builder; cross-year trend reports.

### 4.4 Teacher performance views (D2) — access control and content

**Access control:**

1. **New permission `report.teacher-performance.read`** in its own
   descriptively named constant, following the `ADMIN_DASHBOARD_PERMISSIONS`
   pattern (CLAUDE.md, "Permission naming for work that isn't a numbered
   Phase").
2. **Granted to `admin` explicitly; `owner` holds it through its wildcard.**
   Never granted to `teacher` or `bursar`. Admin's grants are an explicit
   list (`packages/db/src/seeds/system-roles.ts`), so the existing admin role
   row needs a data migration, following
   `20260821000000_admin_dashboard_read_permission`.
3. **Pinned in `permissions-coverage.spec.ts`:** a test asserts the teacher
   and bursar role grants do **not** contain it, so a future grant fails CI
   rather than shipping.
4. **Enforced on the API**, with `@Permissions` on every teacher-performance
   endpoint and a re-fetch of the acting user on every request. Hiding the nav
   item is presentation only, never the boundary.
5. **Separate endpoints from the rest of Reports.** Teacher performance does
   not ride inside a general reports response a wider audience might later be
   granted.
6. **Excluded from Insights.** The shared SQL layer must not expose teacher
   performance as an Insights intent: no staff-performance figures routed to,
   or narrated by, the model. If Arinzechukwu later wants AI narration of
   staff performance, that is its own decision.
7. **Future custom roles.** No endpoint edits role permissions today (verified
   — no `role.create`/`role.update` handler exists in `apps/api`). If a
   custom-role editor is ever built, this permission must not be grantable to
   a role that also holds `teacher`, or D2's "never visible to other
   teachers" would become a school configuration choice. Recorded here so
   that editor inherits the constraint.

**Content — descriptive activity, not a rating.** v1 shows, per teacher, per
term:
- Classes and subjects taught (from `TeacherAssignment`).
- Score-entry completion: components entered vs expected for their
  arm × subject pairs.
- Sign-off timeliness (`subjectSignedOffAt`).
- Daily attendance marking coverage for arms where they are form teacher.
- Lesson plans created.
- **Results of the classes they teach**: arm × subject averages and pass
  rates, labelled as class outcomes.

The last item carries a real interpretive risk, stated in the UI itself.
Class outcomes are shaped by intake, class composition and co-teaching, and
an average is not a measure of a teacher. v1 shows the figures with that
caveat and computes **no composite score, ranking or rating of teachers.**

**Open:** Q26 — may a teacher see their own view? D2 rules out other
teachers; the recommended v1 default is no. Q27 — should reads be
audit-logged, as the BVN reveal is?

### 4.5 Open questions

Q14 (unreleased marks), Q26, Q27. See §11.

### 4.6 Unverified

Whether pilot schools enter attendance and scores on the platform in enough
volume for reports to be useful. No production read was done; CP2 should
start by measuring it.

### 4.7 Size

**9–13 working days:** 6–9 base plus 3–4 for teacher performance (D2).

---

## 5. Section map

Feature sections are not in build order. Build order is §12.

| Feature | Section | Checkpoints |
|---|---|---|
| Reports | §4 | CP2 |
| AI Tutor (and safeguarding) | §6 | CP7, CP8 |
| Timetable | §7 | CP3, CP4 |
| Event Calendar | §8 | CP1 |
| Assessments & Exams | §9 | CP5 |
| Result Checker | §10 | CP6a, CP6b |

---

## 6. AI Tutor

### 6.1 What is already in place (verified)

| Thing | State |
|---|---|
| Curriculum retrieval filtered by (school, subject, class level) in SQL | Shipped, `curriculum-retrieval.service.ts` (Phase 7 D16) |
| Voyage embeddings, heading plus content (D15) | Live in production |
| Curriculum document review gate | Shipped (Phase 7 CP5) |
| Student principal: auth, `student_sessions`, SECURITY DEFINER resolvers | Shipped (Phase 6 slice 3) |
| Student mobile surface (`apps/mobile/app/me/*`) | Shipped (Phase 6) |
| Budget-enforced call path: reserve → call → settle | Shipped, `ai-generation.service.ts` |
| `ai_generations` ledger; `AIInteractionLog.sessionRef` | Shipped; `sessionRef` has never been used for a real conversation |
| Per-school AI kill switch, platform-admin re-enable | Shipped |

### 6.2 Real new engineering work (verified against code)

1. **The Anthropic port handles one turn and does not stream.**
   `AnthropicSdkPort.create` (`packages/ai/src/client.ts`) sends
   `messages: [{ role: "user", ... }]` and returns after the full response. A
   tutor needs message history, streaming, cancellation, and a settle step
   that records true token counts for a stream that ended early or failed —
   with no transaction open while tokens flow.

2. **As wired today, students would bypass the daily cap.** The cap counts
   `ai_generations` rows by `userId`, a staff `users.id`, and calls with no
   `userId` are treated as system calls that skip the cap entirely. Students
   are not users, so a naive tutor would give every child **unlimited**
   calls. Required: a student principal column on `ai_generations`
   (additive), a per-student daily cap, and probably a share of the school's
   monthly budget reserved for students.

3. **Collision with the PII hard rule.** CLAUDE.md forbids sending student PII
   to the model for tutoring, and requires `AIInteractionLog.payload` to stay
   PII-free. The allowlist is one prompt name and must not be generalised. A
   child typing freely **will** include personal details, and no redaction is
   reliable against free text. → **Q10**, a policy decision.

4. **Grounding coverage is near zero.** The only approved curriculum document
   evidenced in the docs is JSS 3 English at Virgo Fidelis (`phase-7.md`
   §17.11). → **Q12**.

5. **The admin "AI Tutor" nav item.** The tutor is for students; the admin
   page would be an oversight console (enablement, usage). Its safeguarding-
   related parts are out of scope under D7.

6. **Session scope.** `phase-6.md` §14 confirmed a `scope` column on
   `student_sessions` is additive and non-breaking. Decided in CP7's
   plan-first.

### 6.3 NDPR

The tutor sends **children's free text** to a processor outside Nigeria,
further than anything currently live. `docs/deferred.md` requires either (a)
the NDPR question addressed, or (b) a deliberate, recorded decision to proceed
despite it. That decision must be recorded **for the tutor specifically**. →
**Q9**.

### 6.4 Safeguarding — UNRESOLVED, HIGH PRIORITY, a separate workstream (D7)

**Status: an unresolved, high-priority product and safeguarding decision.
Deliberately deferred by Arinzechukwu on 2026-09-13 as its own dedicated
workstream, separate from the six Phase 8 features. It has no checkpoint and
no estimate in this plan, because it is not engineering-led work.**

A conversational AI surface in front of children will receive disclosures of
abuse, statements about self-harm, and situations that may need emergency
action. How the product responds is a safeguarding question with legal,
ethical and child-welfare dimensions. It is not a feature to be designed in a
plan-first.

**Nothing is to be implemented. Specifically, none of the following may be
built, prototyped, or approximated in Phase 8:**
- detection or classification of abuse disclosures or self-harm statements;
- responses to such statements, including scripted or templated replies;
- emergency escalation of any kind;
- notification of guardians, school staff or anyone else;
- **system-prompt instructions telling the model how to handle these
  situations** — writing "if the child mentions X, say Y" into a prompt *is*
  implementing handling, just in the least reviewable place.

**No generic "guardrails", content filter, moderation API, classifier, or the
model provider's built-in safety behaviour may ever be treated as satisfying
this requirement — in whole or in part.** Those tools can have a role inside
a properly designed safeguarding process. They are not that process, and
shipping one in its place would give the appearance of safeguarding without
its substance. Any PR, plan or review comment that proposes one as a
substitute should be rejected by pointing at this section.

**Required before the tutor is shipped to any student:**
1. **Research** into how child-facing educational and support services handle
   disclosures, including Nigerian practice and requirements.
2. **Legal input** — including the Child's Rights Act, state-level
   child-protection law, NDPR, and mandatory-reporting obligations as they
   apply to a school and to SchoolKit as a platform.
3. **Defined escalation levels** — what counts as which level, and what each
   one triggers.
4. **Scripted responses** for each level, written and reviewed by qualified
   people, not generated.
5. **Human-review procedures** — who reviews, how quickly, with what
   training, and what happens outside school hours.
6. **Consent and privacy rules** — what is stored, who can see transcripts
   (guardians, school), for how long, and what children and guardians are
   told up front.

**Consequence for sequencing:** the tutor cannot reach any student until this
workstream completes, however far its engineering has progressed. CP7's
engineering foundations may proceed only on Q9 and Q10 (§12.3); CP8's rollout
is blocked on this workstream.

### 6.5 Unverified

Whether `expo/fetch` streams response bodies on Expo SDK 57. Verify with a
spike at the start of CP7.

### 6.6 Not in v1

"Exam practice" mode; a web tutor in `apps/portal`; voice, images and
handwriting photos; mastery tracking (`MasteryRecord`); a shared national
curriculum corpus (`phase-7.md` §11 Q6).

### 6.7 Size

**25–40 working days of engineering** for a minimal text tutor on mobile,
**excluding the safeguarding workstream**, which is unestimated. The tutor's
ship date is the later of CP8 finishing and that workstream completing.

---

## 7. Timetable

### 7.1 Re-confirmed: no data model exists (verified)

No `Timetable`, `Period`, `Schedule`, `Room` or `Lesson` model, and no
`dayOfWeek`, `startTime` or time-of-day field anywhere in `schema.prisma`.

Two existing things are adjacent:
- **`TeacherAssignment`** (teacher × class arm × subject × academic year,
  **optional term: null = whole year**). It records who teaches what, where,
  including co-teaching. It also sets the precedent D3 needs (§7.2).
- **`SubjectAttendanceRecord.period`** is a bare `Int` with no definition
  behind it.

### 7.2 Supporting D3: per-term or per-year, varying by school and by class arm

**Confirmed: the data model supports this cleanly**, using a pattern the
schema already has. Indicative model (names fixed in CP3's plan-first):

| Model | Shape | Purpose |
|---|---|---|
| `BellSchedule` | school, name | A named set of time slots. Different arms may use different schedules |
| `BellSlot` | schedule, order, start time, end time, kind (LESSON / BREAK / ASSEMBLY / OTHER) | One period in a day |
| `Timetable` | school, **class arm**, academic year, **term (nullable)**, bell schedule, school week days | **A header per arm.** `termId` null = applies to the whole year; set = applies to that term only |
| `TimetableEntry` | timetable, day of week, slot, subject | One cell of the grid; unique on (timetable, day, slot) |
| `TimetableEntryTeacher` | entry, teacher | One or more teachers per cell (co-teaching) |

**How D3's variability falls out of this:**
- **No mode flag, at school or arm level.** Whether an arm is "per-year" or
  "per-term" is simply which `Timetable` headers exist for it. School A can
  run every arm year-wide; school B can run JSS year-wide and SSS per term;
  one arm can switch mid-year. A stored mode flag would be a second source of
  truth that could disagree with the rows.
- **This mirrors `TeacherAssignment.termId`** (null = whole year), so the
  convention is already familiar in this codebase.
- **It inherits that model's uniqueness caveat.** Postgres treats NULLs as
  distinct in a unique index, so "one year-wide timetable per arm per year"
  needs a **partial unique index** (`WHERE term_id IS NULL`), plus a second
  one for (arm, term) `WHERE term_id IS NOT NULL`. Both go in migration raw
  SQL, as the academic-year `is_current` indexes already do. The service
  also enforces that the term belongs to the stated academic year, following
  `Enrollment`'s precedent.
- **Effective timetable** for (arm, term) = the term-specific header if one
  exists, otherwise the year-wide one. **Decided (D13):** the two may
  coexist, and a term timetable replaces the year-wide one **entirely** for
  that term — never merged slot by slot, which would make "why is this period
  here?" unanswerable for an admin reading the grid.

### 7.3 Where the real cost of D3 lands: conflict detection

The schema is the easy part. Conflict detection is where D3's flexibility
costs real time:

1. **Conflicts can't be a database constraint.** "Teacher double-booked"
   depends on *effective* timetables, which are derived. A year-wide entry
   for arm A conflicts with a term-2 override for arm B, but not if arm A
   also has a term-2 override. So it must be computed in the service.
2. **Conflicts are about time ranges, not slot numbers.** Different arms can
   use different bell schedules, so "slot 3" in a primary arm and "slot 3" in
   an SSS arm may not overlap at all, and slots 3 and 4 in different schedules
   may partly overlap. Two assignments clash when they share a teacher, a
   day, and **overlapping time intervals**.
3. **A year-wide change is checked against every term.** Saving an entry in a
   year-wide timetable means checking all of that year's terms, each against
   the effective timetables of every other arm in that term.
4. **Concurrency.** Two admins editing different arms can create a clash
   neither save sees. Saves take a per-school transaction-scoped advisory lock
   (`pg_advisory_xact_lock`) inside `withTenant`, so conflict checks serialise
   per school.
5. **`TeacherAssignment` validity per term.** A year-wide entry whose teacher
   holds only a term-specific assignment is valid in some terms and not
   others. Recommendation for CP3's plan-first: block the save if no effective
   term is covered, warn when only some are.

### 7.4 Other constraints and surfaces

- **New convention: time of day.** Nothing in the schema stores one yet. CP3
  picks `@db.Time` or integer minutes since midnight (school-local, WAT, with
  no timezone stored), inspects the generated SQL, and adds the choice to
  CLAUDE.md's "Prisma column types in raw SQL" section in the same PR.
- **Tenancy:** every new table carries its own `school_id` with flat, direct
  RLS and an RLS spec. No SECURITY DEFINER function is expected.
- **Subject periods per week against a target:** a soft warning, not a block.
- **Admin surfaces (CP3):** bell-schedule editor; per-arm grid editor with a
  "whole year / this term only" choice; conflict display.
- **Lifecycle (CP4):** fork a year-wide timetable into a term override; copy a
  timetable forward to the next term or year; deleting an override restores
  the year-wide timetable as effective.
- **Read surfaces (CP4)**, all resolving the effective timetable: teacher "my
  timetable" (the union across arms in the current term); student mobile;
  guardian portal.

### 7.5 Not in v1

Rooms and room conflicts; **automatic generation or optimisation**;
linking `SubjectAttendanceRecord.period` to slots (a known gap that touches
existing data); substitution and cover management.

### 7.6 Open questions

Q7 (bell schedule per school or per stage, double periods — partly softened
by D3, since schedules now attach per timetable), Q8 (manual builder vs
generator — recommendation: manual). Q18 is resolved by D13.

### 7.7 Size — D3 changes the estimate

| | Before D3 | After D3 |
|---|---|---|
| CP3 — model, schedules, grid builder, conflict detection | 8–12 | **11–16** |
| CP4 — lifecycle and read surfaces | 4–6 | **5–7** |
| **Timetable total** | 12–18 | **16–23 working days** |

The increase is almost entirely §7.3: effective-timetable resolution,
time-interval clash detection across mixed schedules, all-terms checking for
year-wide saves, serialisation, and a test matrix covering year × term ×
mixed-schedule combinations.

---

## 8. Event Calendar

### 8.1 Decided scope (D4) and how the remaining questions are interpreted

**Decided:** seeded national events plus school-admin-added events, on real
dates, visible to all users, no RSVP in v1.

D4 was given as resolving the calendar questions. The ones it doesn't address
word for word are recorded here as **interpretations for Arinzechukwu to
confirm**, not assumed silently:

| Question | Interpretation |
|---|---|
| Q2 RSVP | **Resolved — none in v1** |
| Q3 Reminders and notifications | **No scheduled reminders and no push on publish in v1.** "Visible to all users" is read as a calendar people look at, not a notification channel |
| Q4 Announcement board | **Stays separate and deferred** (`phase-4.md` §8) |
| Q5 Holiday source; effect on attendance | **Resolved — national events seeded by the platform; schools add their own.** Holidays are **informational only** in v1: they don't block attendance marking or change day counts |
| Audience targeting (level / arm / staff-only) | **None in v1.** "Visible to all users" means every school event is visible to every principal in that school |

"All users" means, within a school: staff (web), guardians (portal web and
mobile), and students (mobile). National events are visible in every school.
**School events never cross tenants.**

### 8.2 What exists (verified)

- `AcademicYear` and `Term` with `@db.Date` dates, plus the academic-calendar
  bootstrap endpoint.
- Notification delivery (push, Termii SMS, Resend email) — unused by v1 per
  the Q3 interpretation.
- **Not present:** holidays, breaks, any events table, `Announcement`
  (deferred from Phase 4), or a school-day calendar.

### 8.3 National events are platform data — the first non-tenant content table

Every content table in this schema is tenant-scoped. The only precedent for
shared rows is `roles`, where system roles carry `school_id = NULL`. Seeded
national events need a decision on shape:

- **(a) Separate platform table** (e.g. `national_events`), with no
  `school_id`. `app_user` gets SELECT only. Writes come only from the
  platform-admin surface or seeds. School events live in a separate
  tenant-scoped, FORCE-RLS table. **Recommended.**
- **(b) One table with nullable `school_id`**, and a policy of
  `school_id IS NULL OR school_id = current school`. Rejected: that is
  exactly the shape where one bug in a write path produces a row visible to
  every school on the platform. Keeping the two in separate tables makes a
  school's event becoming "national" **structurally impossible**, not merely
  prevented — the same reasoning the SECURITY DEFINER review used to refuse
  merging the session resolvers.

**"Real dates" is harder than it sounds for Nigerian public holidays:**

| Kind | Examples | Seeding |
|---|---|---|
| Fixed date | New Year's Day, Workers' Day, Democracy Day (12 June), Independence Day, Christmas, Boxing Day | Seedable years ahead |
| Computable | Good Friday, Easter Monday | Computable years ahead |
| Lunar, declared by the Federal Government | Eid al-Fitr, Eid al-Adha, Eid-el-Maulud | **Can only be estimated in advance.** FG typically confirms days before, and dates can shift by a day |
| Ad hoc | Holidays declared at short notice | Cannot be seeded at all |

So v1 needs:
- a **`date_confirmed` flag**, shown to users as "expected" until confirmed;
- a **platform-admin endpoint to add and correct national events** without a
  deploy, audited. Whether `audit_logs` (monthly-partitioned, school-scoped)
  can hold a platform-level row with no school is **not verified** and is a
  CP1 plan-first item.

**Open:** Q25 — may a school hide or annotate a national event (e.g. "school
open on Democracy Day")? Recommended v1: no hiding. A school can add its own
event on the same date.

### 8.4 v1 scope

- Platform `national_events` table, seed script, platform-admin maintenance.
- Tenant-scoped school events table: title, category (holiday, break, exam
  period, meeting, event, resumption, other), start and end date
  (`@db.Date`, all-day), optional description.
- Admin CRUD on web.
- One merged read endpoint per principal (school events plus national
  events), rendered in the staff web app, the guardian portal (web and
  mobile), and student mobile.

### 8.5 Size

**6–9 working days** (was 5–8). The national-events platform table, seeding,
the maintenance endpoint and lunar-date handling are added. Audience
targeting and push-on-publish are removed.

---

## 9. Assessments & Exams

### 9.1 What exists, stated precisely (verified)

- `GradingScheme` and `GradingComponent`: one scheme per school, weights
  summing to exactly 100.
- `GradeBoundary`: the WAEC scale.
- `AssessmentScore`: a raw mark, **already weighted**, with
  `score ∈ [0, component.weight]`.
- `Assessment`: the materialised student × subject × term rollup, with
  positions.
- `ReportCard`: the sign-off → form review → principal approval → release
  workflow; PDFs from the render worker (wake path fixed, PR #177).

This records and processes marks that already exist. It has no concept of a
question, an exam sitting, or a student doing anything. **Naming trap:** the
`Assessment` model is a term rollup, not a test; new models must not reuse
the word for something else.

### 9.2 Scope options — CBT removed (D5)

| # | Meaning | Relation to existing code | Size |
|---|---|---|---|
| (i) | **Enter marks out of any total** and scale into component weight, with a teacher-visible preview before scores land | Grading extension; integer rounding policy needed | 3–5 days |
| (ii) | **Cumulative results across terms** — third-term cumulative position and average | Grading extension; deferred in `phase-2.md`, triggered by the first school finishing a full year | 3–5 days |
| (iii) | **Question bank plus AI-generated printable papers** with mark schemes, teacher approval, curriculum grounding | New models; reuses Phase 7 retrieval | 8–12 days |
| ~~(iv)~~ | ~~CBT / online exams~~ | **Out of Phase 8 — its own future phase (D5)** | — |

### 9.3 Recommendation

**v1 = (i) + (ii)**, with exam periods shown on the Event Calendar. (iii) is a
sensible later addition. → **Q15**, narrowed by D5 but still open.

(ii) is also closely tied to D6's **promotion status**, since Nigerian schools
typically decide promotion on the cumulative average. §10.3 places promotion
status in CP6a, right after this checkpoint.

### 9.4 Size

**6–10 working days** for the recommendation.

---

## 10. Result Checker

### 10.1 Confirmed scope (D6) against the investigation's CP6

**Shape matches.** The investigation scoped a public, school-scoped page with
PIN access to `RELEASED` results only: a pre-login SECURITY DEFINER lookup,
enumeration throttling, hashed PINs, audit, and a PDF through a short-lived
presigned URL. D6 confirms that, and confirms these are SchoolKit's own
results, with no WAEC/NECO integration.

**Q16 is resolved:** "school's choice, both supported".

### 10.2 Why the real scope is larger than the original 6–10 days

Four findings from the code, each a direct consequence of D6:

1. **"Free via portal OR paid via PIN" changes a shipped gate.** Today, a
   `RELEASED` card is visible in the guardian portal and student mobile, with
   no further condition (Phase 6 D28, `released-results.service.ts`). If a
   school chooses PIN access, portals showing the card for free would defeat
   the payment. So the shared reader needs an **access-mode gate**:
   - in PIN mode, the portals show a locked state with a "use a PIN" prompt;
   - redeeming a PIN unlocks that student's result for that term.

   Because D28 put the gate in one helper, this is one change, not two. But
   it modifies shipped, security-relevant code and its specs. **Decided
   (D11): results lock in both portals in PIN mode.**

2. **The report card doesn't carry what D6 lists.** Verified against
   `report-card-template.ts`, `ReportCard` and the family DTO:

   | D6 item | Current state |
   |---|---|
   | Subjects, scores, grades | Present |
   | Teacher comments | Present (subject, form teacher, principal note). The family DTO omits `principalNote`, a trivial fix |
   | **Position** | Present on the PDF, but **deliberately hidden from families**: `FAMILY_VISIBLE_POSITION = false`. The comment says it belongs to a missing **school-level setting**, and that the PDF and portal should move together when it lands. D6 makes that setting necessary. → **Q24** (default) |
   | **Attendance** | **Absent.** No attendance anywhere on `ReportCard` or its template. Needs a term attendance summary **snapshotted at build time**, like the rest of the frozen rollup, not recomputed live |
   | **Promotion status** | **Absent.** The only related data is `EnrollmentStatus.PROMOTED` / `REPEATED`, reachable by manual PATCH; the promotion engine is deferred (`phase-2.md`). **Decided (D12): a display field set at principal approval, no engine** |

3. **Paid PINs raise how payment happens.** If PINs are sold offline (printed
   cards, cash at the school), SchoolKit only generates, exports and redeems
   them. If parents buy online, every sale goes through `FinanceService` with
   `audit_logs` (Money hard rules), via the school's Paystack subaccount, with
   a webhook and PIN delivery. **Decided (D9): offline only in v1**; online
   sales are a deferred fast follow-on.

4. **Withdrawing exists, but only as a full reopen.** `reopen` (owner-only,
   `report-card-workflow.service.ts`) rolls an arm × term back to `DRAFT` and
   clears the workflow timestamps, forcing a full re-walk. It deliberately
   **keeps** the PDF at its deterministic R2 path. D6's "retain control over
   withdrawing" is therefore satisfied without new work. However:
   - any presigned PDF URL already issued stays valid until it expires, so
     checker URLs must use a **short TTL**;
   - a lighter "unpublish without re-walking the workflow" does not exist.
     → **Q28**.

### 10.3 Scope, split into two checkpoints

**CP6a — Report card completeness** (benefits the portals too, not only the
checker):
- School-level position-visibility setting, replacing
  `FAMILY_VISIBLE_POSITION`, applied to the PDF and portals together.
- Term attendance summary snapshotted onto `ReportCard` at build and rendered
  on the PDF and portals.
- **Promotion status (D12):** a display field on `ReportCard` (e.g.
  PROMOTED / REPEAT / PROMOTED_ON_TRIAL; exact values fixed in CP6a's
  plan-first). Set per student during the principal-approval step, on cards
  for the **final term of the academic year** (highest `Term.sequence` in that
  year). Recommended: approval of those arms is blocked until every card has a
  status. Frozen by `released-guard.ts` once released, like the rest of the
  card. Never touches `Enrollment`.
- `principalNote` added to the family DTO.

**CP6b — Result Checker:**
- **Access mode per release** (free / PIN), set by the school at the
  granularity decided in **Q20** (recommendation: per arm × term, matching the
  existing release granularity), enforced in the shared reader for both
  portals and the checker (D11, §10.2 item 1).
  - **Decided (D18):** access mode is fixed at release. Changing it goes
    through the existing reopen. Switching free → paid after families have
    already seen results would be a retraction; paid → free silently voids
    PINs families have already bought.
  - **Decided (D17):** a PIN redeemed anywhere (public checker or either
    portal's "enter PIN" prompt) unlocks that student's result for that term
    everywhere. A parent never spends a second use of a scratch card they
    already redeemed.
- **PINs (D9, D10) — batch-generated, sold offline by the school:**
  - high-entropy generation, stored **hashed**;
  - generated in a batch of a school-chosen size, scoped to one academic
    year and term (D15);
  - **unbound at generation; binds to a student and term on first successful
    redemption**, after which only that student's result opens with it;
  - a use limit per PIN (school-configurable, recommended default 5);
  - **export for printing** (CSV for a print shop, plus a printable sheet),
    **once, at generation**, with a clear warning (D16);
  - voiding a whole batch or a single PIN (for lost or stolen cards);
  - generation, export, voiding and every redemption audited.
- **Public page** at a per-school URL in `apps/portal` (school slugs are
  already public): enter identifier(s) and PIN (**Q22**), select session
  (academic year) and term, view the structured card, download the PDF through
  a short-TTL presigned URL.
- **Pre-login lookup:** at least one new SECURITY DEFINER function, **moving
  the count 22 → 23 and triggering the scheduled review due at 23.** Full
  discipline applies: owner `school_kit`, pinned `search_path`, EXECUTE for
  `app_user` only, narrowest return shape, header comment, inventory row, and
  the conformance spec.
- **Enumeration defence:** admission numbers are sequential and slugs public —
  the student-login threat model. Reuse its per-(school, admission number)
  slow-down (`phase-6.md` §14.13 Q1: slow down, never lock out) plus
  per-IP throttling. The session/term selector must not reveal anything about
  a student before the PIN validates.
- **Only `RELEASED` cards,** read through the shared helper, never a second
  query against `report_cards`.
- **Not in CP6b (D9):** online PIN purchase. Its recorded shape is in D9.

### 10.4 Open questions

Q20, Q22, Q24, Q28. See §11. (Q17, Q19, Q21, Q23 resolved by D9–D12; Q29,
Q30 by D15, D16.)

### 10.5 Size — D6 changed the estimate; D9 confirmed CP6b's

| | Estimate |
|---|---|
| Original CP6 | 6–10 days |
| **CP6a** — report card completeness | **5–8 days** |
| **CP6b** — access-mode gate, offline batch PINs, public checker, SD function and review | **9–14 days — confirmed** |
| ~~Online PIN sales via Paystack~~ | ~~+5–8 days~~ — **removed by D9**; deferred fast follow-on |
| **Result Checker total** | **14–22 days** |

**Why CP6b stays at 9–14 rather than shrinking.** The 9–14 figure never
included online sales, which were always the separate +5–8, so D9 removes
that line without touching this one. D10's batch model then trades one piece
of work for another of about the same size: it removes per-student issuance,
but adds bind-on-first-redemption, batch voiding and print export. D11 was
already costed in: the portal lock was §10.2's first finding.

---

## 11. Open questions

### 11.1 Resolved 2026-09-13

| # | Question | Resolution |
|---|---|---|
| Q2 | Event Calendar: RSVP? | None in v1 (D4) |
| Q3 | Event reminders? | Interpreted: none, no push on publish (§8.1) — **confirm** |
| Q4 | Absorb Announcement board? | Interpreted: separate, stays deferred (§8.1) — **confirm** |
| Q5 | Holiday source; attendance effect | Seeded national + school-added (D4); informational only (§8.1) — **confirm the attendance half** |
| Q6 | Timetable per term or per year? | Both, varying by school and class arm (D3) |
| Q11 | Tutor safeguarding | Replaced by a dedicated workstream (D7, §6.4) |
| Q13 | Teacher performance in Reports? | Included, owner/admin only (D2) |
| Q16 | Result Checker: sold or free? | School's choice, both supported (D6) |
| Q1 | Assignments → Phase 9? | Yes; docs reconciled in CP0 (D14) |
| Q17 | PINs per student per term, or batches? | Batches, distributed by the school (D10) |
| Q18 | Year-wide and term timetables coexist? | Yes; term replaces year entirely (D13) |
| Q19 | PIN sales channel | Offline only in v1; online deferred as a fast follow-on (D9) |
| Q21 | Results locked in portals in PIN mode? | Yes, in both portals (D11) |
| Q23 | Promotion status: field or engine? | Display field set at principal approval (D12) |
| Q29 | PIN batch scope | One academic year + term, chosen at generation (D15) |
| Q30 | Re-export PINs after generation? | No: export once, hashed storage, void and regenerate if lost (D16) |

### 11.2 Still open

| # | Question | Blocks | Recommendation |
|---|---|---|---|
| **Q7** | Bell schedules: one per school, per stage, or free-form? Double periods? | CP3 | Free-form named schedules attached per timetable; double periods as consecutive slots |
| **Q8** | Manual builder vs automatic generator? | CP3 | Manual builder with conflict detection |
| **Q9** | NDPR: recorded proceed-anyway decision **for the tutor specifically**? | CP7 | — (legal/business call) |
| **Q10** | PII hard rule vs a child's free text | CP7 | — (policy call) |
| **Q12** | Tutor behaviour with no approved curriculum document | CP8 | Refuse politely, naming the subject |
| **Q14** | Reports: include unreleased marks? | CP2 | Yes for admins, clearly labelled |
| **Q15** | Assessments & Exams: which of (i)–(iii)? | CP5 | (i) + (ii) |
| **Q20** | "Per result" access mode: per school × term, per arm × term, or per student? | CP6b | Per arm × term, matching release |
| **Q22** | Checker identifiers: admission number **and** PIN, or either? | CP6b | Both required |
| **Q24** | Default of the new school-level position-visibility setting? | CP6a | Hidden (today's behaviour) until a school turns it on |
| **Q25** | May a school hide a national event? | CP1 | No; a school may add its own event on that date |
| **Q26** | May a teacher see their own performance view? | CP2 | No in v1 |
| **Q27** | Audit-log reads of teacher performance? | CP2 | Yes |
| **Q28** | Is a lighter "unpublish" needed, beyond the existing owner-only reopen to DRAFT? | CP6b | Not in v1 |

Q9 and Q10 are **not engineering decisions** and must not be closed by one.
Neither is the safeguarding workstream (§6.4).

---

## 12. Checkpoints, sequencing and estimate

### 12.1 Revised checkpoints

| CP | Content | Estimate | Changed by | Needs decided first |
|---|---|---|---|---|
| **CP0** | This plan committed (**done**, PR #297) plus D9–D14 recorded; ARCHITECTURE.md §9 and `docs/deferred.md` reconciled per D14 (Assignments → Phase 9, CBT → own phase, Timetable no longer Phase 9, Tutor → Phase 8b, the relevant "Future feature ideas" entries pointed here); Q9/Q10 and the safeguarding workstream recorded as Arinzechukwu-owned | 2–3 days | D14 | **Nothing — ready** |
| **CP1** | Event Calendar v1 incl. national events (§8.4) | 6–9 days | D4 (+1) | Q25; confirm Q3–Q5 interpretations |
| **CP2** | Reports v1 incl. teacher performance and its access control | 9–13 days | D2 (+3–4) | Q14, Q26, Q27 |
| **CP3** | Timetable: model, time-of-day convention, bell schedules, grid builder, effective-timetable resolution, time-interval conflict detection, RLS spec | 11–16 days | D3 (+3–4); D13 confirms, no change | Q7, Q8 |
| **CP4** | Timetable: fork/override, copy-forward, teacher / student / guardian read surfaces | 5–7 days | D3 (+1) | — |
| **CP5** | Assessments & Exams v1: any-total marks with scaling, cumulative results | 6–10 days | D5 (scope narrowed) | Q15 |
| **CP6a** | Report card completeness: position setting, attendance snapshot, promotion status display field | 5–8 days | D6 (new); D12 | Q24 |
| **CP6b** | Result Checker: access-mode gate in both portals, offline batch PINs, public page, SD function and review at 23 | **9–14 days** | D6; D9 removed online sales; D10, D11, D15–D18 | Q20, Q22, Q28 |
| **CP7** | Tutor engineering foundations: `expo/fetch` spike, multi-turn streaming port, per-student ledger column and cap, eval harness for conversations. **No safeguarding handling of any kind (§6.4)** | 12–18 days | — | **Q9, Q10** |
| **CP8** | Tutor mobile screen, admin console (non-safeguarding parts), rollout | 13–22 days | D7 | Q12; **rollout blocked on the safeguarding workstream** |

### 12.2 Why this order (unchanged in logic)

- **Calendar first:** small, and exam periods on the calendar support CP5.
- **Reports second:** no new data needed, and it tests early whether pilot
  data is complete enough to report on.
- **Timetable third:** the largest foundational build, after two quick wins.
- **Exams, then report card completeness, then the checker:** cumulative
  results inform promotion status, and the checker should show the complete
  card, not a surface that needs reworking.
- **Tutor last:** the only work blocked on non-engineering decisions.

### 12.3 The Phase 8 / 8b split point (D1)

**Decided (D8): the split is made now, at CP6b.**
- **Phase 8 = CP0–CP6b.** All engineering-led, with ordinary product
  questions.
- **Phase 8b = CP7–CP8 (AI Tutor).** CP7 can start only when Q9 and Q10 are
  recorded; CP8's rollout can happen only when the safeguarding workstream
  (§6.4) completes.

This replaces the investigation's earlier fallback ("close Phase 8 at CP6 if
the Tutor's decisions haven't landed"). D7 settled that question: the tutor
cannot ship until work with no engineering estimate is done.

**Further split, allowed but not decided:** if Phase 8 runs long, it may split
again after CP4 — see §12.4.

### 12.4 Revised estimate

| | Before decisions | After decisions |
|---|---|---|
| **Phase 8** — CP0–CP6b (engineering-led) | 37–58 days | **53–80 days** |
| **Phase 8b** — CP7–CP8 (Tutor engineering) | 25–40 days | **25–40 days**, plus the unestimated safeguarding workstream |
| **Total engineering** | 62–98 days | **78–120 working days, ~16–24 calendar weeks** |

**Where the growth comes from:** D6 (+8–12), D3 (+4–5), D2 (+3–4), D4 (+1).
D5 changes no estimate — CBT was never inside the recommended scope — but it
closes the risk of it entering by accident. **D9 removed the optional +5–8
days for online PIN sales**, so the "58–88" and "83–128" upper variants no
longer exist. D10–D13 are scope-neutral (§7.7, §10.5).

At 53–80 days, **Phase 8 alone (CP0–CP6b) is ~11–16 weeks**, three to four
times ARCHITECTURE.md's nominal phase. If it needs to split further, the next
natural boundary is after CP4 (Calendar, Reports, Timetable) with CP5–CP6b
(Exams, report card completeness, Result Checker) as a coherent "results"
group.

---

## 13. Not verified by this investigation

1. **Production data volume** — whether pilot schools actually record
   attendance and scores on the platform (§4.6).
2. **`expo/fetch` streaming on Expo SDK 57** (§6.5).
3. **Curriculum coverage in production** beyond the one document evidenced in
   `phase-7.md` §17.11.
4. **Whether `audit_logs` can hold a platform-level row with no school** for
   national-event maintenance (§8.3).
5. **The Nigerian scratch-card result-checker pattern** comes from market
   knowledge. D6 confirmed the product intent and D9/D10 the commercial model
   (offline batch cards); the recommended default use limit of 5 (§10.3) is
   not sourced from any school.
6. **Nigerian public-holiday rules** (§8.3) — the fixed / computable / lunar /
   ad hoc categories are general knowledge and should be checked against an
   authoritative source before the seed is written.

---

## 14. What must be true before implementation starts

1. ~~This plan-first is committed~~ — **done**, PR #297 (2026-09-13).
2. ~~Q1 is answered~~ — **done** (D14). ARCHITECTURE.md §9 and
   `docs/deferred.md` are reconciled with it in CP0, including recording CBT
   as its own future phase (D5) and the Tutor as Phase 8b (D8).
3. For each checkpoint, its "needs decided first" questions in §12.1 are
   answered and recorded here before its plan-first is written.
4. CP7 does not begin without Q9 and Q10 recorded.
5. **No part of the AI Tutor reaches any student before the safeguarding
   workstream (§6.4) completes, and nothing in §6.4's prohibited list is
   implemented in the meantime.**
