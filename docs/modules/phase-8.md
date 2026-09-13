# Phase 8 — Reports, Timetable, Event Calendar, Exams, Result Checker, AI Tutor

**Status:** plan-first investigation **approved 2026-09-13** and merged
(PR #297). Three rounds of decisions were recorded the same day (§3: D1–D8,
D9–D14, D15–D18), and a fourth closed CP1's questions (D19–D20).
**CP0 is done** (§12.1). **CP1's plan-first is written (§15) and awaiting
review.** Nothing is built.
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
points follow that D10 doesn't settle, recorded as **Q29** and **Q30** and
resolved by D15 and D16 (§3.2).

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

### 3.3 Fourth round — CP1 (Event Calendar), Arinzechukwu, 2026-09-13

**D19 (Q25) — A school may hide a national (seeded) event from its own
calendar.** This **reverses** the investigation's "no hiding" recommendation.
Consequences:
- Hiding is **per school, per national event**. It hides the event from
  every user of that school (staff, guardians, students) — "its own calendar
  view" is the school's calendar, not one person's. It never affects any
  other school, and never alters the platform `national_events` row.
- It needs a small **tenant-scoped** record of which national events a
  school has hidden (FORCE RLS, like every tenant table), an admin
  hide/unhide action, audit rows, and a filter in the merged read.
- A hidden event stays visible to the school's admins in the management view,
  so it can be unhidden. The read-only calendar views omit it.
- Adds **about 1 day**: CP1 moves from 6–9 to **7–10 days** (§8.5, §12).

**D20 (Q3, Q4, Q5) — The §8.1 interpretations are confirmed as read:**
- **Q3:** no scheduled reminders in v1, and no push notification on
  publish. The calendar is something people look at, not a notification
  channel.
- **Q4:** the announcement board stays a separate feature, still deferred
  (`phase-4.md` §8), and is not merged into the calendar.
- **Q5:** holidays are purely informational. They don't block attendance
  marking and don't change attendance day counts.

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

D4 was given as resolving the calendar questions. The ones it didn't address
word for word were recorded here as interpretations, and **D20 confirmed all
of them as read**:

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
- a way to add and correct national events. This section originally proposed
  a platform-admin endpoint; **CP1's plan-first (§15, D22) proposes
  migration-only writes instead**, so runtime code can never write platform
  data. (The audit question raised here is answered in §15.1: `audit_logs`
  already holds NULL-school platform rows, and such rows are readable by
  every tenant. Under D22 no national-event audit row is written at all; git
  is the trail.)

**Decided (D19):** a school may hide a national event from its own calendar.
Recorded as a hide, not an edit: the platform row is never changed per school.
A school can still add its own event on the same date (e.g. "school open on
Democracy Day").

### 8.4 v1 scope

- Platform `national_events` table, seed, maintenance by migration (§15 D22,
  proposed).
- Per-school hiding of national events (D19).
- Tenant-scoped school events table: title, category (holiday, break, exam
  period, meeting, event, resumption, other), start and end date
  (`@db.Date`, all-day), optional description.
- Admin CRUD on web.
- One merged read endpoint per principal (school events plus national
  events), rendered in the staff web app, the guardian portal (web and
  mobile), and student mobile.

### 8.5 Size

**7–10 working days** (was 5–8, then 6–9). The national-events platform
table, seeding, the maintenance endpoint and lunar-date handling are added
(D4), and per-school hiding (D19, +1). Audience targeting and push-on-publish
are removed.

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
| Q3 | Event reminders? | None in v1, no push on publish (D20) |
| Q4 | Absorb Announcement board? | No; separate, stays deferred (D20) |
| Q5 | Holiday source; attendance effect | Seeded national + school-added (D4); informational only (D20) |
| Q25 | May a school hide a national event? | Yes, from its own calendar (D19) |
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
| **CP0** | **Done 2026-09-13.** Plan committed (PR #297); D9–D18 recorded; ARCHITECTURE.md §9 and `docs/deferred.md` reconciled per D14 (Assignments → Phase 9, CBT → own phase, Timetable out of the Phase 9 list, Tutor → Phase 8b, Phase 7's stale "not started" status corrected, and the Timetable generator, exam management, result checker, AI study assistant, event calendar and smart-timetable entries pointed here); Q9/Q10 and the safeguarding workstream recorded as Arinzechukwu-owned. Older module docs (`phase-4.md`, `phase-5.md`, `phase-6.md`) that say "Phase 8 owns assignments" were **left as historical record**, not rewritten | 2–3 days (took well under) | D14 | — |
| **CP1** | Event Calendar v1 incl. national events and per-school hiding (§8.4; plan-first §15) | 7–10 days | D4 (+1), D19 (+1) | **Nothing — ready** (D19, D20) |
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
| **Phase 8** — CP0–CP6b (engineering-led) | 37–58 days | **54–81 days** |
| **Phase 8b** — CP7–CP8 (Tutor engineering) | 25–40 days | **25–40 days**, plus the unestimated safeguarding workstream |
| **Total engineering** | 62–98 days | **79–121 working days, ~16–24 calendar weeks** |

**Where the growth comes from:** D6 (+8–12), D3 (+4–5), D2 (+3–4), D4 (+1), D19 (+1).
D5 changes no estimate — CBT was never inside the recommended scope — but it
closes the risk of it entering by accident. **D9 removed the optional +5–8
days for online PIN sales**, so the "58–88" and "83–128" upper variants no
longer exist. D10–D13 are scope-neutral (§7.7, §10.5).

At 54–81 days, **Phase 8 alone (CP0–CP6b) is ~11–16 weeks**, three to four
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
4. ~~Whether `audit_logs` can hold a platform-level row with no school~~ —
   **verified in CP1's plan-first** (§15.1): it can, and platform-admin already
   does it.
5. **The Nigerian scratch-card result-checker pattern** comes from market
   knowledge. D6 confirmed the product intent and D9/D10 the commercial model
   (offline batch cards); the recommended default use limit of 5 (§10.3) is
   not sourced from any school.
6. ~~Nigerian public-holiday rules~~ — **researched in CP1's plan-first**
   (§15.1, with sources). Every seeded date is still checked against an
   official source before its migration merges (§15 D24).

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

---

## 15. CP1 plan-first — Event Calendar

Written 2026-09-13, after D19–D20 closed CP1's product questions. **Status:
approved in full 2026-09-13 (§15.6); built 2026-09-13 (§15.9), PR #299.**

**Scope:** seeded national events, school-added events, per-school hiding of
national events, and one calendar read for every principal (staff, guardians,
students). Decided product scope is D4, D19 and D20; this section decides the
engineering.

**Why this checkpoint needs more care than its size suggests:** it introduces
the **first platform-wide content table** — rows that are not scoped to any
school and are read by every school. Every other content table in this schema
is tenant-scoped under FORCE RLS. Getting this one wrong means a single write
becomes visible to every school on the platform.

### 15.1 What CP1 inherits, verified not assumed

Checked against the repo on 2026-09-13:

| Thing | State | Where |
|---|---|---|
| `AcademicYear`, `Term` with `@db.Date` start/end | Shipped | `schema.prisma` |
| The only table without RLS | `schools` — it *is* the tenant table; written through `basePrisma` | `policies/phase-0.sql` header |
| `basePrisma` banned outside an allowlist | ESLint `no-restricted-imports` | `packages/config/eslint/base.js` |
| Runtime role privileges | Default privileges give `app_user` exactly **SELECT, INSERT, UPDATE, DELETE** (`arwd`) on new tables, and **not TRUNCATE** — which matters, because TRUNCATE is not subject to RLS. **Verified on the local dev database** with `\ddp` and `information_schema.role_table_grants`; production not yet checked (§15.7) | migration header comments; local `school-kit-postgres` |
| Platform-level audit rows | `schoolId: null`, written through `basePrisma` (platform-admin login, school toggles) | `platform-admin.service.ts` |
| `audit_logs` policy | `USING (school_id IS NULL OR school_id = GUC)` — **a NULL-school row is readable under every tenant's GUC** | `20260628000000_phase_3_slice_3_audit_partitioning` |
| Operator scripts | Deliberately connect as `app_user`, never `DIRECT_URL` (rail 4) | `packages/db/scripts/disable-ai-per-school.ts` |
| RBAC gates | `@Permissions` plus role assertion, pinned by `rbac-two-gate-conformance.spec.ts` and `permissions-coverage.spec.ts`; audit actions by `audit-coverage.spec.ts` | `apps/api/src/__tests__/` |
| Guardian sessions | Bound to one school (`auth_resolve_guardian_session` returns `school_id`) | CLAUDE.md SD inventory |
| Mobile read pattern | Persisted React Query cache plus `FreshnessLabel` for offline reads | `apps/mobile/app/students/index.tsx` |
| Lagos-date helper | ~~`week.util.ts` uses `Africa/Lagos`~~ **Wrong — corrected during build (§15.9):** `week.util.ts` is deliberately UTC and only *mentions* Lagos in a comment. No Lagos-day helper existed in the API | — |

**What the law and practice actually say about Nigerian public holidays**
(researched 2026-09-13, sources at the end of this section):
- The Public Holidays Act's schedule lists New Year's Day, Good Friday, Easter
  Monday, Workers' Day, Democracy Day, National Day (1 October), Christmas,
  and Id el Fitr, Id el Kabir and Id el Maulud, **the last three on dates
  declared by the Minister**. The President may also appoint special days,
  nationally or for part of the country.
- **The statute text published online is out of date against current
  practice.** The copy found lists Democracy Day as 29 May (now observed on
  12 June, since 2019) and omits Boxing Day, which current federal holiday
  lists include. It also says a holiday falling on a weekend gets no
  substitute day. Substitute days are reported to have been declared in some
  years anyway; that isn't verified year by year here (§15.7).
- **In practice the Ministry of Interior announces each Eid holiday 1–2 days
  ahead**, after the Sultan of Sokoto's moon-sighting committee. In 2026:
  Eid-el-Fitr was Thursday 19 and Friday 20 March; Eid-el-Kabir (Eid-ul-Adha)
  was Wednesday 27 and Thursday 28 May.

**Consequence: national event dates must come from Ministry of Interior
announcements, never be computed from the statute or from rules.** That
shapes D24.

### 15.2 Decisions (approved 2026-09-13)

#### D21 — Three tables: one platform table, two tenant tables, never merged

| Table | Scope | Holds |
|---|---|---|
| `national_events` | **Platform** — no `school_id` | Public holidays and special days |
| `school_events` | Tenant, FORCE RLS | Events a school adds |
| `school_hidden_national_events` | Tenant, FORCE RLS | Which national events a school has hidden (D19) |

The single-table alternative (nullable `school_id`, policy `school_id IS NULL
OR school_id = GUC`) is rejected, as §8.3 already argued: one bug in a write
path would publish a school's event to every school. With separate tables
that is **structurally impossible**, not merely prevented.

Note that `audit_logs` already uses exactly that nullable pattern, which is
why a NULL-school audit row is readable by every tenant (§15.1). That is
acceptable there because audit writes never carry school content under a
NULL school. It is a reason not to copy the pattern for content.

#### D22 — `national_events` is read-only to the runtime, enforced by the database twice

1. **FORCE RLS with a SELECT-only policy** (`USING (true)`) **and no INSERT,
   UPDATE or DELETE policy.** Under RLS a command with no permissive policy is
   denied, so `app_user` cannot write the table through any path: the tenant
   client, `basePrisma`, or raw SQL.
2. **`REVOKE INSERT, UPDATE, DELETE ON national_events FROM app_user`** in the
   same migration, so the guarantee survives even if someone later adds a
   write policy by mistake.

**The only write path is a migration**, which runs as `school_kit` through
`DIRECT_URL`. No SECURITY DEFINER function is added; **the count stays at
22**, and the review due at 23 remains CP6b's.

**This revises §8.3/§8.4**, which proposed a platform-admin endpoint to
correct national events without a deploy. The trade-off, stated plainly:

| | Migration-only (proposed) | Platform-admin endpoint |
|---|---|---|
| Can runtime code ever write a national event? | **No — structurally** | Yes, via a new write path |
| New SECURITY DEFINER functions | 0 | 2 (upsert, delete): count 22 → 24, the review at 23 moves into CP1 |
| Time to publish an Eid date | Merge → CI (~15 min) → deploy | Seconds |
| Audit trail | The migration and its PR, in git | `audit_logs` rows |

Why accept the latency:
- **An honest estimate is always on screen before confirmation.** Future
  lunar dates are seeded with `date_confirmed = false` and shown as
  "expected" (D23). A slow correction therefore shows a correctly labelled
  estimate, not a wrong fact.
- **The failure the other design risks is worse.** A platform-wide write
  path exposed to runtime code means any authorisation bug in it can alter
  what every school's families see.
- **Changes are rare:** a handful of corrections a year.

**Known cost:** this project's e2e job has a history of timeouts, and a
flaky CI run on the day of an announcement could delay a correction by
hours. The mitigation is the "expected" label, not a bypass. **Upgrade path,
recorded rather than built:** if latency proves to be a real problem, add
the platform-admin endpoint backed by write-only SD functions. It is purely
additive; nothing in D22 has to be undone.

#### D23 — `national_events` shape

| Column | Type | Notes |
|---|---|---|
| `id` | `TEXT` (uuid) | |
| `key` | `TEXT`, unique | Stable, human-readable, e.g. `eid-el-fitr-2027`. Correction migrations `UPDATE … WHERE key = …`, so they are idempotent and readable in review |
| `name` | `TEXT` | "Eid-el-Fitr" |
| `start_date`, `end_date` | `DATE` | Inclusive. **One row per consecutive run of declared days** (amended during build, §15.9): a two-day Eid on consecutive days is one row, but Good Friday and Easter Monday are two rows, and so would be a non-consecutive declaration such as Eid-ul-Adha 2025 (Friday 6 and Monday 9 June). A single range would wrongly show the weekend between them as declared. `CHECK (end_date >= start_date)` in raw SQL |
| `kind` | enum `PUBLIC_HOLIDAY` \| `SPECIAL_HOLIDAY` | The second covers presidential special days |
| `date_confirmed` | `BOOLEAN` | `false` = an estimate awaiting the Ministry's announcement; rendered as "expected" |
| `source` | `TEXT` | Where the date came from, e.g. the Ministry of Interior press-release URL, or "Public Holidays Act (fixed date)" |
| `created_at`, `updated_at` | `TIMESTAMP(3)` | |

No `school_id`, no `created_by`: no runtime actor exists (D22).

#### D24 — Seeding policy

- **Coverage:** the current and next calendar year at seed time (2026 and
  2027). Each year after that is added by a migration before it starts.
  Adding next year's list goes on the January routine, recorded in
  `docs/deferred.md` so it isn't forgotten.
- **Fixed dates** (New Year's Day, Workers' Day, Democracy Day, National Day,
  Christmas, Boxing Day): `date_confirmed = true`, with the date as currently
  observed, not the stale statute text (§15.1).
- **Good Friday / Easter Monday:** the calendar date is unambiguous years
  ahead; `date_confirmed = true`.
- **The three Eids:** `true` only once the Ministry has announced them. All
  three 2026 Eids are confirmed: 19–20 March, 27–28 May, and **Eid-el-Maulud
  on Tuesday 25 August** (corrected during build: the plan assumed Maulud 2026
  was unannounced, but the Ministry had declared it). **Every 2027 Eid is
  seeded `false`**, with its estimate's source recorded, and each confirmation
  is a one-line migration.
- **Weekend substitutions and ad hoc special days:** **never derived.** Added
  only when announced.
- **Every seeded date is checked against a Ministry of Interior or official
  source before the migration merges**, with the check recorded in the PR.
  §13 item 6's "general knowledge" caveat is closed by this rule, not by
  memory.

#### D25 — `school_events` shape and visibility

| Column | Type | Notes |
|---|---|---|
| `id`, `school_id` | `TEXT` | FORCE RLS `tenant_isolation`, the standard direct-column policy |
| `title` | `TEXT` | 1–120 chars (Zod) |
| `description` | `TEXT` nullable | ≤ 1000 chars |
| `category` | enum `HOLIDAY` \| `BREAK` \| `EXAM_PERIOD` \| `MEETING` \| `EVENT` \| `RESUMPTION` \| `OTHER` | |
| `start_date`, `end_date` | `DATE` | Inclusive, all-day only. `CHECK (end_date >= start_date)` |
| `created_by`, `updated_by` | `TEXT` | `users.id`, plain FK convention |
| `created_at`, `updated_at` | `TIMESTAMP(3)` | |

**Visibility is everyone in the school (D4), with no exceptions.** One
consequence the admin UI must state at the moment of creation: *"Everyone at
your school — staff, parents and students — will see this event."* There are
no staff-only events in v1, so a "staff meeting" entry is visible to parents.
That follows from D4, and the UI must not let an admin discover it after
publishing.

Editing and deleting are hard operations with an audit row each. There is no
event history; the audit row's metadata carries the title and dates so a
deletion stays explainable.

#### D26 — Hiding national events (D19)

`school_hidden_national_events`: `school_id`, `national_event_id` (FK →
`national_events`, `ON DELETE CASCADE`), `hidden_by`, `hidden_at`; unique on
`(school_id, national_event_id)`; FORCE RLS `tenant_isolation`.

- `PUT …/national-events/:id/hide` and `DELETE …/national-events/:id/hide`
  are idempotent. Each writes a **tenant-scoped** audit row: the school is
  known, so these are not NULL-school rows.
- Hidden events are omitted from every calendar read (D27). The admin
  management list still shows them, labelled "Hidden from your school", with
  unhide.
- A foreign key from a tenant table to a platform table is new here but safe:
  referential checks are not subject to RLS, and `national_events` is
  readable by everyone anyway.

#### D27 — One merged read, built in one place, served to three principals

A single service method, `buildCalendar(db, schoolId, { from, to })`, returns
one sorted list. It merges:
1. `school_events` for that school;
2. `national_events`, minus that school's hidden rows;
3. **term boundaries derived from existing `Term` rows** — "First Term
   begins", "First Term ends". Read-only markers, **not stored**, so they can
   never drift from the terms an admin edits.

Every principal's endpoint calls this method. None queries the three tables
directly — the same instinct as Phase 6 D28's single results reader. A
guardian calendar and a student calendar that filter "the same way today"
would stop doing so the first time one is edited.

Contract (`packages/types/src/calendar/`):

```ts
type CalendarEntryDto = {
  id: string;                   // prefixed by source, so ids can't collide
  source: "SCHOOL" | "NATIONAL" | "TERM";
  title: string;
  category: SchoolEventCategory | "PUBLIC_HOLIDAY" | "SPECIAL_HOLIDAY" | "TERM_START" | "TERM_END";
  startDate: string;            // YYYY-MM-DD
  endDate: string;              // YYYY-MM-DD, inclusive
  dateConfirmed: boolean;       // always true except unconfirmed national events
  description: string | null;
};
```

- **Window:** `from` and `to` are required dates, with a maximum span of 400
  days; an entry is included if it **overlaps** the window, so a multi-day
  break starting before `from` still appears.
- **Reads happen inside `withTenant`.** `national_events` is readable by
  `app_user` under any GUC (D22's SELECT policy), so no `basePrisma` and no
  ESLint allowlist change are needed.

| Principal | Endpoint | Gate |
|---|---|---|
| Staff (owner, admin, teacher, bursar) | `GET /calendar?from=&to=` | `calendar-event.read` |
| Guardian | `GET /portal/calendar?from=&to=` | `GuardianAuthGuard`; school from the session |
| Student | `GET /student-portal/me/calendar?from=&to=` | `StudentAuthGuard`; school from the session |

Management (owner, admin):
- `GET /calendar/events`
- `POST /calendar/events`
- `PATCH /calendar/events/:id`
- `DELETE /calendar/events/:id`
- `GET /calendar/national-events` (with hidden flag)
- `PUT` and `DELETE /calendar/national-events/:id/hide`

**Re-validate tenancy on every id in the path** (CLAUDE.md): an event id from
another school returns 404, exactly like a nonexistent one.

#### D28 — Permissions

A new `CALENDAR_PERMISSIONS` constant, following the naming rule for work
that isn't a numbered phase:

| Permission | owner | admin | teacher | bursar |
|---|---|---|---|---|
| `calendar-event.read` | ✓ (wildcard) | ✓ | ✓ | ✓ |
| `calendar-event.create` / `.update` / `.delete` | ✓ | ✓ | — | — |
| `national-event.hide` | ✓ | ✓ | — | — |

- Admin, teacher and bursar are explicit-list roles, so a data migration
  updates the existing role rows, and `system-roles.ts` is updated in step.
- **Bursar gains a non-finance read.** That is D4's "visible to all users",
  and it's recorded so it doesn't read as scope creep in
  `PHASE_3_BURSAR_PERMISSIONS`' carefully argued exclusions.
- Both gates (`@Permissions` and role assertion) must agree, or
  `rbac-two-gate-conformance.spec.ts` fails.

#### D29 — Dates

- Every calendar date is `@db.Date`, following CLAUDE.md's calendar-date
  convention. No times and no timezones are stored.
- Anything relative to "today" — the default window — uses the Lagos calendar
  day, never the viewer's device clock or server time (Fly runs in UTC).
  **Corrected during build (§15.9):** there was no existing Lagos helper to
  reuse. The API never needs "today", since every request names its window,
  so the helper lives in `packages/types/src/calendar/calendar-dates.ts`,
  shared by web, portal and mobile. It uses the fixed WAT offset (UTC+01:00, no
  daylight saving) rather than `Intl`, because `Intl` output differs between
  Node, browsers and React Native's Hermes.

#### D30 — Surfaces

| Principal | Surface | Notes |
|---|---|---|
| Owner / admin | Web `/events` — agenda list grouped by month, create/edit/delete, national events with hide | "Event Calendar" moves from `LATER_PHASE_ITEMS` to `NAV_ITEMS`, gated on `calendar-event.read` (`nav-items.spec.ts`) |
| Bursar | Same page, read-only | Management controls hidden; the API enforces it regardless |
| Teacher | Teacher shell: read-only calendar page, added to the teacher sidebar | |
| Guardian | Portal web page, plus guardian mobile screen | Mobile uses the persisted cache and `FreshnessLabel`: offline, a family still sees the last calendar they loaded |
| Student | Student mobile screen | Same pattern |

**Agenda list, not a month grid, in v1.** It reads well at phone width, where
most families will see it, and costs a fraction of a grid. A month grid is a
later improvement.

**Staff mobile is excluded.** Staff mobile is a deliberately narrow companion,
enabled one school at a time. Adding a calendar screen there widens a surface
that has its own rollout rail. Staff see the calendar on web.

### 15.3 Shape

**Migrations**, each checked with `migrate diff` and its SQL inspected before
applying, per CLAUDE.md:
1. `phase_8_cp1_calendar`: the three tables, two enums, `CHECK` constraints,
   RLS enabled and forced on all three, policies (mirrored in
   `packages/db/prisma/policies/phase-8.sql`), and the `REVOKE` on
   `national_events`.
2. `phase_8_cp1_national_events_seed`: data only, the 2026 and 2027 lists per
   D24.
3. `phase_8_cp1_calendar_permissions`: role-row updates for admin, teacher
   and bursar.

**Code:**
- `packages/types/src/calendar/` (DTOs and Zod schemas)
- `apps/api/src/modules/calendar/`, plus one method each on `portal` and
  `student-portal`
- web: `apps/web/src/app/(admin)/events/` and a teacher page
- `apps/portal` calendar page
- two mobile screens

### 15.4 Tests

1. **RLS spec, run as `app_user` against a real database:**
   - `school_events` and `school_hidden_national_events`: a no-GUC read
     returns 0 rows; a school-A GUC sees only school A; a cross-tenant INSERT
     is rejected by `WITH CHECK` with a valid GUC set; a control insert under
     the correct GUC succeeds, so the rejection isn't passing for the wrong
     reason.
   - **`national_events`, the structural claim of D22 tested directly:**
     SELECT succeeds with no GUC; **INSERT, UPDATE and DELETE all fail as
     `app_user`** — with a GUC set, without one, and through raw SQL. If
     `DATABASE_URL` is ever a privileged role, this spec must fail loudly, in
     line with the existing RLS hard rule.
2. **`buildCalendar` service spec:**
   - hidden events are excluded;
   - window overlap edges: an event that starts before `from`, and one that
     ends exactly on `to`;
   - term markers come from `Term` rows;
   - ordering is stable;
   - **school B's events never appear for school A**;
   - an unconfirmed national event carries `dateConfirmed: false`.
3. **Principal specs:** a guardian and a student of school A see A's
   calendar only; an unauthenticated request is rejected; a school-B event id
   in a management path returns 404.
4. **Seed spec:** keys are unique; `end_date >= start_date`; every row has a
   `source`; no row has `date_confirmed = false` with a date already in the
   past at the time of writing, which catches forgotten confirmations.
5. **Conformance suites:** `permissions-coverage`, `rbac-two-gate-conformance`,
   `audit-coverage` (create, update, delete, hide, unhide), `nav-items.spec`.
6. **E2E (Playwright), the happy path:** an admin creates an event, and a
   guardian sees it in the portal.
7. **Verification in the running app, not just specs**, per this project's
   habit:
   - apply the migrations to a real database;
   - confirm the RLS grants and `REVOKE` with `\dp national_events`;
   - after deploy, a read-only production check that the seed rows exist and
     that `app_user` cannot write them.

### 15.5 What CP1 does NOT do

- RSVP (D4).
- Reminders or push notifications (D20).
- Audience targeting or staff-only events (D4, D25).
- Event times, recurring events, a month grid, iCal export or subscription.
- The announcement board (D20).
- Any effect on attendance (D20).
- A platform-admin UI for national events (D22's upgrade path).
- **State-level public holidays.** The Act allows holidays "in any part" of
  Nigeria. Only federal holidays are seeded; a school in a state with its own
  holiday adds it as a school event.
- A calendar on staff mobile (D30).

### 15.6 Review questions — all approved 2026-09-13

1. **D22's write path — APPROVED.** Migration-only writes, with the
   operational cost accepted for v1: merge → CI → deploy on announcement days.
   The platform-admin screen stays the recorded upgrade path if that cycle
   proves too slow in practice.
2. **D30: agenda list rather than month grid — APPROVED.**
3. **D30: staff mobile excluded — APPROVED.**
4. **D24: seed horizon of current year plus next, extended each January —
   APPROVED.**

**Condition attached to the approval:** the `app_user` privilege check
(SELECT/INSERT/UPDATE/DELETE granted, TRUNCATE not granted) must be verified
against **production**, not only local dev, before CP1 ships. See §15.7
item 1.

### 15.7 Not verified

1. ~~**`app_user`'s default privileges in production.**~~ **VERIFIED ON
   PRODUCTION 2026-09-13**, before any CP1 code relied on it, as the approval
   required — read-only catalog query from inside the running `school-kit-api`
   container, connected as `app_user`:
   - `current_user = app_user`, `rolsuper = false`, `rolbypassrls = false`;
   - `pg_default_acl`: `app_user=arwd` for tables created by both `school_kit`
     and `neondb_owner` (and `rU` for sequences);
   - all **79** public tables grant `app_user` exactly DELETE, INSERT, SELECT,
     UPDATE (79 each); **0 tables grant TRUNCATE**; 0 tables missing any of
     the four.

   A second read-only query established that production migrations will
   succeed against the new FORCE-RLS table: `school_kit` owns all 79 tables
   and has `rolbypassrls = true` (not SUPERUSER), so the seed INSERT runs,
   while `app_user` (no BYPASSRLS) stays subject to both layers.
2. **2027 Eid dates** don't exist yet; they are estimates by definition.
3. ~~**Eid-el-Maulud 2026**~~ — checked: declared by the Ministry for Tuesday
   25 August 2026, and seeded confirmed with that declaration's URL.
4. **Current substitute-day practice** for weekend holidays beyond individual
   declarations. D24 sidesteps it by never deriving substitutes.

### 15.8 Estimate

| Work | Days |
|---|---|
| Schema, RLS, `REVOKE`, policies file, RLS spec | 1.5–2 |
| Seed research against official sources, seed migration, seed spec | 1 |
| API: `buildCalendar`, management endpoints, three principal endpoints, permissions, audit | 2–2.5 |
| Admin/bursar web page and teacher page | 1–1.5 |
| Portal web page, guardian and student mobile screens | 1–1.5 |
| E2E, deploy verification | 0.5–1.5 |
| **Total** | **7–10 working days — unchanged** |

D22 removes the platform-admin maintenance endpoint the §8.5 estimate
included. That saving is roughly what the second defence layer, the extra
RLS test matrix and the official-source seed checks cost, so the total holds.

### 15.9 Built — 2026-09-13

Implementation of CP1 as approved, on PR #299. Evidence below was freshly
produced, not summarised from memory.

#### The two-layer write block — each layer proven, and proven to FAIL when broken

`apps/api/src/__tests__/calendar-rls.spec.ts`, 19 tests, real Postgres, as
`app_user`. It asserts the preconditions (`app_user`, no SUPERUSER, no
BYPASSRLS; RLS enabled **and** forced; exactly one policy, SELECT-only;
privileges SELECT yes, INSERT/UPDATE/DELETE/TRUNCATE no). It then attempts
writes through Prisma without a GUC, through the tenant client with a GUC, and
through raw SQL — INSERT, UPDATE, DELETE and TRUNCATE, with and without a GUC.

Each layer is also proven **alone**, in a migration-role transaction that is
always rolled back, followed by `SET LOCAL ROLE app_user`:

| Scenario | Result |
|---|---|
| Layer 2 removed (`GRANT` re-added), INSERT | refused: `new row violates row-level security policy` |
| Layer 2 removed, UPDATE / DELETE | 0 rows affected (no UPDATE/DELETE policy makes every row invisible) |
| Layer 1 removed (permissive write policy added) | INSERT/UPDATE/DELETE refused: `permission denied` |
| **Control:** both removed | INSERT succeeds (1 row), so neither test above passes for the wrong reason; afterwards 0 rogue rows and only the original policy |

**Sabotage runs**, to show the spec detects a real regression rather than
passing vacuously. Performed on the local database, then reverted:

| Real change made to the database | Spec result | Did the write still fail? |
|---|---|---|
| `GRANT INSERT, UPDATE, DELETE ON national_events TO app_user` | **5 failed**, 14 passed — exactly the privilege assertions | Yes, blocked by layer 1 (RLS), 0 rogue rows |
| `CREATE POLICY sabotage_writes … FOR ALL USING (true)` | **4 failed**, 15 passed — the policy-set, layer-1-alone and control tests | Yes, blocked by layer 2 (privilege) |
| Both reverted | **19 passed** | — |

#### Cross-school isolation and the single read

`apps/api/src/modules/calendar/calendar.service.spec.ts`, 16 tests, real
Postgres, real roles, and the real `PermissionsGuard` reading
`@Permissions` off `CalendarController`. It covers:
- window overlap edges;
- school B's events never in school A's calendar, and a hide applying only to
  the hiding school;
- term markers derived from `Term` rows;
- ordering and id uniqueness;
- an unconfirmed 2027 Eid returning `dateConfirmed: false`;
- staff, guardian and student reads returning **identical** calendars;
- another school's event id is a 404 on update and delete;
- create/update/delete audited in order, and idempotent hide/unhide audited
  once each;
- both RBAC gates independently refusing teacher and bursar writes;
- a deactivated owner refused.

#### End to end, in a real browser

`e2e/tests/event-calendar.spec.ts`, against the compiled API plus the web and
portal apps:
1. An owner opens `/events` and adds an event through the dialog. The "everyone
   … will see this event" notice is asserted before submit.
2. The owner hides Independence Day with the Hide button.
3. That school's guardian signs into the portal, follows "School calendar →",
   and sees the event and its details, but **not** Independence Day.
4. A **second school's** guardian sees Independence Day and **no trace** of the
   first school's event.
5. After unhide, the first guardian sees the holiday again.

Passed in 23.6s; screenshots reviewed (admin after hide; guardian on a 390px
phone; other school's guardian). Because the portal proxy change touches every
portal GET, the whole existing guardian e2e set was rerun alongside it: **20
passed** (event-calendar, guardian-auth ×17, guardian-released-results,
portal-bank-details).

#### Wider regression

| Suite | Result |
|---|---|
| `pnpm lint` | 9/9 tasks |
| `pnpm typecheck` | 14/14 tasks |
| API vitest, full run | 1,360 passed; **15 failed, all in `invoice-generation.service.spec.ts`** under full parallel load, most in 3–5 ms (a cascading setup failure). **Rerun alone: 48/48 passed.** Consistent with this machine's known parallel-load flakiness; no calendar code involved. CI is the clean check. |
| `permissions-coverage`, `rbac-two-gate-conformance`, `audit-coverage`, `security-definer-inventory`, `app-module-boots` | all pass (SD inventory unchanged; no function added) |
| `national-events-seed.spec.ts` | 4/4 |
| web vitest | 333/333 |
| mobile vitest | 167/167, including new `calendar-keys.spec.ts` |

#### What the build found that the plan did not

1. **The portal proxy silently dropped GET query strings** (`apps/portal/src/app/api/portal/[...portal]/route.ts`).
   It was harmless until now because no portal GET took parameters; the
   calendar's required `?from=&to=` would have failed validation for every
   parent. Fixed by forwarding `req.nextUrl.search`, which is `""` for every
   existing call.
2. **No Lagos-day helper existed** — D29's citation was wrong (§15.1 row
   corrected). Added to `packages/types`, using the fixed WAT offset rather
   than `Intl`: a first draft using `Intl` produced "Fri, 12 Jun 2026" where
   the spec expected "Fri 12 Jun 2026", the platform variance that also makes
   Hermes risky.
3. **Declared holidays are not always consecutive days** (Eid-ul-Adha 2025:
   Friday 6 and Monday 9 June). D23 amended to one row per consecutive run.
4. **Eid-el-Maulud 2026 had already been declared** (25 August). Seeded
   confirmed; D24 corrected.
5. **The mobile session has a third principal, `staff`.** Without a redirect, a
   staff session opening the guardian calendar would sit on "Loading" forever.
   It is redirected to the staff home, consistent with D30.
6. **The generated migration diff carried unrelated drift** (curriculum HNSW
   index, audit_logs PK rename, payments unique index, a fee_items index name).
   It was hand-trimmed to calendar objects only, recorded in the migration
   header.

#### Recurring maintenance recorded

`docs/deferred.md` — "National events need a migration every January, and every
Eid": the January seed extension (coverage ends 31 December 2027), the
one-line confirmation migration per Eid, the non-consecutive split rule, and
the deliberately failing seed test that catches a forgotten confirmation.

**Sources for §15.1:**
- [Ministry of Interior — Public Holiday announcements](https://interior.gov.ng/category/public-holiday/)
- [Ministry of Interior — Eid-el-Fitr 2026 (19–20 March)](https://interior.gov.ng/federal-government-declares-thursday-19th-and-friday-20th-march-2026-as-public-holidays-to-mark-eid-ul-fitr/)
- [Ministry of Interior — Eid-ul-Adha 2026 (27–28 May)](https://interior.gov.ng/federal-government-declares-wednesday-27th-may-and-thursday-28th-may-2026-as-public-holidays-to-mark-eid-ul-adha-celebration/)
- [Public Holidays Act (PLAC copy)](https://www.placng.org/lawsofnigeria/print.php?sn=467)
