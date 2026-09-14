# Phase 8 — Reports, Timetable, Event Calendar, Exams, Result Checker, AI Tutor

**Status:** plan-first investigation **approved 2026-09-13** and merged
(PR #297). Three rounds of decisions were recorded the same day (§3: D1–D8,
D9–D14, D15–D18), and a fourth closed CP1's questions (D19–D20).
**CP0 is done** (§12.1). **CP1 (Event Calendar) is built and live in
production** (PR #299, deployed 2026-09-13; evidence §15.10). CP2's questions
were closed the same day (D21–D23 in §3.4). The §4.6 production measurement
re-scoped CP2 to recording completeness; **CP2's plan-first (§16) is approved and
implementation is in progress.**
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

### 3.4 Fifth round — CP2 (Reports), Arinzechukwu, 2026-09-13

Recorded after CP1 went live. All three confirm the recommendations.

**D21 (Q14) — Admin reports include unreleased marks, clearly labelled.**
Owner/admin see figures computed from marks that are still in the approval
workflow, and every such figure is visibly marked as not yet released. This
never changes what families see: guardian and student visibility stays behind
the `RELEASED` gate (Phase 6 D28).

**D22 (Q26) — No teacher self-view of performance in v1.** Teacher performance
views are owner/admin only (D2), and that includes the teacher's own row.

**D23 (Q27) — Every view of teacher performance is audit-logged.** Each read
writes a tenant-scoped audit row naming who viewed it, the same discipline as
the BVN reveal.

*(Numbering note: §15's CP1 engineering decisions also used D21–D30. Those are
referenced as "§15 D22" etc.; the D-numbers in §3 remain the phase-level
decision log.)*

### 3.5 Sixth round — CP3 (Timetable), Arinzechukwu, 2026-09-14

**D24 (Q7) — Bell schedules are free-form slots; a double period is consecutive
slots.** No fixed period grid is imposed on a school.

**D25 (Q8) — Manual timetable builder only.** Automatic generation and
optimisation stay unscheduled (`docs/deferred.md`).

**D26 — One bell schedule per school in v1; per-class schedules are deferred,
not designed around.** Production has no school with more than 4 classes holding
students, and no evidence any school needs different bell times across classes
(§4.6). This follows the project's discipline of building the smallest real
thing first. §17.2 confirms it simplifies clash checking, and by how much.

**Still open and owned by Arinzechukwu on his own timeline:** Q9 (NDPR for the
tutor) and Q10 (the PII hard rule). **They do not block CP0 or any Phase 8
checkpoint;** they must be resolved before Phase 8b's CP7 begins.

---

## 4. Reports

> **Superseded for v1 on 2026-09-13.** After the §4.6 production measurement,
> CP2's v1 became a **recording-completeness report** (§16). The outcome
> analytics in §4.2–§4.4 are **deferred, not dropped** (§16.9). This section is
> kept as the record of the original scope and its access-control reasoning,
> which the deferred item inherits.

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

**Decided:** no teacher self-view in v1 (§3.4 D22), and every view is
audit-logged (§3.4 D23).

### 4.5 Open questions

None blocking. Q14, Q26 and Q27 were resolved on 2026-09-13 (§3.4 D21–D23).

### 4.6 Production data measurement — 2026-09-13

Measured before writing CP2's plan-first, on the approval's instruction, so
the data actually present informs v1 rather than an assumption that it is rich.

**Method.** One read-only script, run inside the production `school-kit-api`
container as `app_user`. Each school was read inside its own `withTenant`
transaction, so RLS applied exactly as for the app. **Aggregate counts only**:
no student, guardian or staff names or contact fields were selected. The
script was validated against the local database first. Five schools matching
smoke/e2e naming were excluded. The heuristic is loose (some remaining schools
are plainly trial sign-ups), but they hold no data, so the totals are
unaffected.

**Production, all 75 measured schools combined:**

| Measure | Total |
|---|---|
| Active students | **37** |
| Enrolled in the current term | 19 |
| Daily attendance rows | **12 — one class, one day** (25 Aug 2026) |
| Subject attendance rows | 0 |
| Assessment score rows | **60** |
| Report cards | 6 (3 released) |
| Invoices / successful payments / expenses | 14 / 5 / 0 |
| Users holding the teacher role | **2** |
| Lesson plans | 10 |

| Schools… | Count (of 75) |
|---|---|
| with any student | 17 |
| with 10 or more active students | **1** |
| with a current term set | 25 |
| with enrollments this term | 8 |
| with any attendance | **1** |
| with any scores | **2** |
| with more than one teacher | **0** |
| with records in more than one term | 1 |
| with students but no enrollment this term | 9 |
| with students but no current term | 6 |
| whose "current" term has already ended | 5 |

**The only two schools with any academic records:**
- **Virgo Fidelis** — 12 students, 1 teacher, 4 arms:
  - scores entered for one term (24 rows, 3 cards);
  - attendance marked on a single day, in the following term;
  - its current term is still flagged as one that **ended on 31 August**, while
    a 2026/2027 year exists but hasn't been made current;
  - 10 lesson plans.
- **A school created 2026-09-04** — 1 student, 1 teacher. 36 score rows cover
  that one student's full subject list, entered **before its term has
  started**, and 1 released card. It reads as a trial run.

#### What this means for CP2

1. **There is no production data for outcome analytics to analyse.**
   Averages, pass rates, grade distributions, attendance trends and
   term-over-term comparisons all need many students, many days and more than
   one term. Production has at most 12 students in one school, one day of
   attendance in total, and scores in a single term. A report built on that
   would show numbers that look authoritative and mean nothing — a class
   position among 1 student, a "trend" from one day.
2. **Teacher performance cannot be meaningful yet.** No school has more than
   one teacher. For the only two that have data, a per-teacher view is
   literally the whole school's results under one name. That is not a
   comparison, and it is not safe to present as a performance measure. D2's
   scope stands, but its value is currently nil and its risk isn't.
3. **The dominant real signal is incomplete setup and recording.** Schools
   with students but no enrollment this term, no current term, or a current
   term that already ended; scores entered for one term and attendance for
   another; attendance marked once. The measured bottleneck is getting
   records in, not analysing them.
4. **The ARCHITECTURE.md §6.17 list was written for a school running
   on-platform for a year.** No production school is that school yet.

**Recorded as a finding, not decided here.** How this reshapes CP2's v1 is a
product decision for Arinzechukwu.

**Re-running the measurement.** The script is not committed (it was a one-off
read). Its queries — per-school aggregate counts of students, enrollments,
attendance, scores against expected slots, report cards, teaching
assignments and finance rows — should be repeated before CP2 ships and before
any outcome report is built.

### 4.7 Size

**9–13 working days:** 6–9 base plus 3–4 for teacher performance (D2).
*Superseded: CP2 v1 is re-estimated at 6–9 days in §16.10.*

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

> **Revised 2026-09-14 by D26 (one bell schedule per school):** the per-timetable
> `BellSchedule` below and the interval-based clash logic in §7.3 are superseded
> for v1. See CP3's plan-first, §17.

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
| Q7 | Bell schedule shape; double periods | Free-form slots, one schedule per school in v1; doubles = consecutive slots (§3.5 D24, D26) |
| Q8 | Manual builder vs generator | Manual builder only (§3.5 D25) |
| Q14 | Reports: include unreleased marks? | Yes for admins, clearly labelled (§3.4 D21) |
| Q26 | Teacher self-view of performance? | No in v1 (§3.4 D22) |
| Q27 | Audit-log teacher-performance views? | Yes, every view (§3.4 D23) |
| Q29 | PIN batch scope | One academic year + term, chosen at generation (D15) |
| Q30 | Re-export PINs after generation? | No: export once, hashed storage, void and regenerate if lost (D16) |

### 11.2 Still open

| # | Question | Blocks | Recommendation |
|---|---|---|---|
| **Q9** | NDPR: recorded proceed-anyway decision **for the tutor specifically**? | CP7 | — (legal/business call) |
| **Q10** | PII hard rule vs a child's free text | CP7 | — (policy call) |
| **Q12** | Tutor behaviour with no approved curriculum document | CP8 | Refuse politely, naming the subject |
| **Q15** | Assessments & Exams: which of (i)–(iii)? | CP5 | (i) + (ii) |
| **Q20** | "Per result" access mode: per school × term, per arm × term, or per student? | CP6b | Per arm × term, matching release |
| **Q22** | Checker identifiers: admission number **and** PIN, or either? | CP6b | Both required |
| **Q24** | Default of the new school-level position-visibility setting? | CP6a | Hidden (today's behaviour) until a school turns it on |
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
| **CP2** | **Recording completeness** (§16): term health, attendance and score-entry coverage, report-card pipeline, teacher recording activity. Outcome analytics deferred (§16.9) | **6–9 days** (was 9–13) | D2 reframed after §4.6 | **Nothing — Q31–Q33 resolved** (§16.7) |
| **CP3** | Timetable: model, time-of-day convention, **one bell schedule per school**, grid builder, effective-timetable resolution, identity-based clash detection, RLS spec (plan-first §17) | **9–13 days** (was 11–16) | D3; D13; D26 (−2–3) | **Nothing — Q34–Q37 approved** (§17.7) |
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
| **Phase 8** — CP0–CP6b (engineering-led) | 37–58 days | **49–74 days** |
| **Phase 8b** — CP7–CP8 (Tutor engineering) | 25–40 days | **25–40 days**, plus the unestimated safeguarding workstream |
| **Total engineering** | 62–98 days | **74–114 working days, ~15–23 calendar weeks** |

**Where the growth comes from:** D6 (+8–12), D3 (+4–5), D4 (+1), D19 (+1). D2's +3–4 was removed when CP2 was re-scoped to recording completeness after the §4.6 measurement (§16.10: CP2 9–13 → 6–9). D26 (one bell schedule per school) then took CP3 from 11–16 to 9–13 (§17.8).
D5 changes no estimate — CBT was never inside the recommended scope — but it
closes the risk of it entering by accident. **D9 removed the optional +5–8
days for online PIN sales**, so the "58–88" and "83–128" upper variants no
longer exist. D10–D13 are scope-neutral (§7.7, §10.5).

At 49–74 days, **Phase 8 alone (CP0–CP6b) is ~11–16 weeks**, three to four
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

### 15.10 Deployed and verified in production — 2026-09-13

PR #299 merged as `351cbed` after both required checks passed on its final
head commit (`e2e (Playwright)`, `lint + typecheck + test + build`); branch
protection re-read first. `main` CI passed, and deploy run `34777265229`
succeeded.

**Deploy log:** all three migrations applied at 19:18:59–19:19:00 UTC —
`20260913120000_phase_8_cp1_calendar`, `…120100_…_national_events_seed`,
`…120200_…_calendar_permissions` — then "All migrations have been successfully
applied." The post-release smoke test passed 6/6 (health, `/health/db` as
`app_user`, signup, login, `/schools/me`, portal health).

**Production database** — read-only check from inside the running
`school-kit-api` container, connected as `app_user`:

| Check | Result |
|---|---|
| Runtime role | `app_user`, `rolsuper = false`, `rolbypassrls = false` |
| `_prisma_migrations` | all three present, `rolled_back_at` null |
| RLS on the three tables | enabled **and** forced on each |
| Policies | `national_events`: only `national_events_read_all` (SELECT); both tenant tables: `tenant_isolation` |
| `app_user` on `national_events` | SELECT yes; INSERT, UPDATE, DELETE, TRUNCATE **no** |
| **Live write probe** | an INSERT into `national_events` as `app_user`, inside a transaction, was **refused: `permission denied for table national_events`** (SQLSTATE 42501); 0 probe rows exist afterwards |
| Seed | 22 rows, 2026-01-01 → 2027-12-26; unconfirmed = exactly the three 2027 Eids |
| System role grants | admin: read + create + hide; teacher and bursar: read only; owner: wildcard |
| SECURITY DEFINER count | 22 (unchanged) |

**Live HTTP:**

| Request | Result |
|---|---|
| `GET /api/v1/calendar`, `/portal/calendar`, `/student-portal/me/calendar` (no auth) | 401 each |
| Control: `GET /api/v1/calendar-does-not-exist` | 404 — so the 401s prove the routes are deployed |
| `https://portal.schoolkit.ng/calendar` (no cookie) | 307 → `/login?next=%2Fcalendar` |
| `https://app.schoolkit.ng/events` | 200 |

**CP1 is closed.**

**Sources for §15.1:**
- [Ministry of Interior — Public Holiday announcements](https://interior.gov.ng/category/public-holiday/)
- [Ministry of Interior — Eid-el-Fitr 2026 (19–20 March)](https://interior.gov.ng/federal-government-declares-thursday-19th-and-friday-20th-march-2026-as-public-holidays-to-mark-eid-ul-fitr/)
- [Ministry of Interior — Eid-ul-Adha 2026 (27–28 May)](https://interior.gov.ng/federal-government-declares-wednesday-27th-may-and-thursday-28th-may-2026-as-public-holidays-to-mark-eid-ul-adha-celebration/)
- [Public Holidays Act (PLAC copy)](https://www.placng.org/lawsofnigeria/print.php?sn=467)

---

## 16. CP2 plan-first — Recording Completeness (Reports v1)

Written 2026-09-13, after the §4.6 production measurement. **Status: approved in
full 2026-09-13 (§16.7); built 2026-09-13 (§16.11), PR #300.**

### 16.1 Why v1 changed, and what it is now

§4.2's original v1 was outcome analytics: averages, pass rates, grade
distributions, attendance trends and teacher performance. §4.6 measured
production and found nothing for those to analyse:
- 37 active students across 75 schools;
- one day of attendance in total;
- scores in a single term;
- no school with more than one teacher.

**Approved direction (Arinzechukwu, 2026-09-13):**
- CP2's v1 is a **recording-completeness report**, useful from day one at any
  data volume.
- D2's teacher scope is folded into it as **recording activity** (registers
  taken, marks entered), not a standalone performance view.
- The original outcome analytics are **deferred, not dropped** (§16.9).

The report answers one question per term: **is this school getting its records
in, and where not?** It never shows a mark, a grade, an average or a position.
It shows whether the thing that would produce them has been done.

### 16.2 What already exists, and why this does not duplicate it (verified)

| Existing surface | What it answers | Why CP2 is not a copy |
|---|---|---|
| `SetupStateService` (`setup-state.service.ts`) | One-time structural readiness: calendar, students, enrollments, fee catalogue, staff, form teachers, teacher assignments. Live counts | **Switches off once any single real activity exists** (`hasRealActivity`), never looks at a term's progress, and **never checks whether the current term has already ended**. CP2 is the ongoing, per-term complement, and links to the setup checklist for structural gaps rather than recomputing them |
| Dashboard `needsYouToday` | `pending_report_card_approval` = count of cards at `FORM_REVIEWED`, **across all terms** | One number, no per-term or per-arm breakdown. CP2 shows the per-term pipeline and words its total differently, so the two numbers never appear to disagree |
| `GET /assessments/aggregate/status` | When positions were last computed, for one arm | One arm at a time; about positions, not entry |
| `GET /report-cards` (board) | Cards for one arm and term, **with student names** | One arm at a time and student-level. CP2 is school-wide aggregate counts with no student names at all |

**No new tables and no RLS change.** Every figure is computed from existing
tables inside `withTenant`. The only migration is role grants (D39).

### 16.3 Decisions (approved 2026-09-13)

Numbered from D31 to avoid colliding with §15's CP1 decisions (§15 D21–D30).

#### D31 — Four sections, one term at a time

For a chosen term (default: the current term), `GET /reports/completeness`
returns four sections:

1. **Term health** — the signals behind §4.6's sharpest findings.
2. **Attendance recording** — registers taken against registers expected, per arm.
3. **Score entry** — score slots entered against expected, per arm × subject.
4. **Report-card pipeline** — cards per status, per arm, including arms with
   no cards built.

A fifth, **teacher recording activity** (D37), is a separate endpoint with a
separate permission, and every read of it is audited (§3.4 D23).

#### D32 — Term health signals, each with a plain explanation and a link to fix it

Each signal is derived live, carries a one-sentence explanation, and names the
existing screen that fixes it:

| Signal | Condition | Links to |
|---|---|---|
| `NO_CURRENT_TERM` | no term has `isCurrent` | `/settings/academic` |
| `CURRENT_TERM_ENDED` | current term's `endDate` is before today (Lagos) | `/settings/academic` |
| `NEXT_TERM_NOT_CURRENT` | the current term has ended and a later term exists but is not current | `/settings/academic` |
| `NO_ENROLLMENT_THIS_TERM` | students exist, 0 enrollments in this term | `/enrollments` |
| `ENROLLMENT_NOT_ROLLED_OVER` | the previous term had enrollments, this term has none | `/enrollments` |
| `ARMS_WITHOUT_FORM_TEACHER` | arms with enrolled students and no `classTeacherId` | `/settings/academic` |
| `ARMS_WITHOUT_SUBJECT_TEACHERS` | arms with enrolled students and no active assignment effective for this term | `/staff` |

"Today" uses `lagosTodayIso()`, shipped in CP1 in `packages/types`.
Production today would raise `CURRENT_TERM_ENDED` and `NEXT_TERM_NOT_CURRENT`
for Virgo Fidelis and `NO_ENROLLMENT_THIS_TERM` for several others — the §4.6
finding, surfaced to the school that can act on it.

#### D33 — What "a register expected" means, stated rather than implied

**Expected arm-days** for an arm in a term = the **school days** from term start
to `min(today, term end)`, for arms with at least one `ENROLLED` student in that
term.

**A school day** is Monday–Friday **minus** the days in D34. There is no
school-week setting yet; CP3's Timetable introduces one, and this definition
switches to it then (§16.8).

**A register counts as taken** when an arm has **at least one**
`AttendanceRecord` for that date, the same "arm has a register" notion the admin
dashboard already uses. A partially marked register counts as taken; a
per-student completeness breakdown is out of v1.

Reported per arm and school-wide, always with numerator, denominator and date
range, never a bare percentage. "12 of 61 school days" is honest; "20%" alone
invites the reading that attendance was 20%.

**Subject-period attendance is out of v1** (0 rows in production;
`subjectAttendanceEnabled` is opt-in; §16.8).

#### D34 — Holidays reduce EXPECTED days only — needs review (Q31)

Without this, every public holiday shows as a "missed register" for every arm,
and the report teaches schools to ignore it on its first Eid.

**Proposed:** exclude from expected school days:
- **confirmed** national events **not hidden** by this school (a school that hid
  one because it opens that day is expected to mark it);
- the school's own events in categories `HOLIDAY` and `BREAK`.

It reads the calendar through **CP1's `buildCalendar`**, the single reader (§15
D27), not the tables directly. An **unconfirmed** national holiday (an Eid
estimate) is **not** excluded: the report must not forgive a missed register on
a day that may not be the holiday.

**This touches §3.3 D20** ("holidays are purely informational; they don't change
attendance day counts"). The proposal keeps D20 intact for attendance **records
and rates** — nothing about any student's attendance changes — and uses holidays
only to decide which days a register was *expected*. That is still a real
extension of what a holiday does in the product, so it is **Q31**, not assumed.
If declined: weekdays only, with a visible note that holidays are not excluded.

#### D35 — What "a score expected" means

**Expected score slots** for a term = for every **arm × subject** with an active
`TeacherAssignment` effective in that term (`termId` equal to the term, or `null`
for the whole academic year) × the arm's `ENROLLED` students in that term × the
school's grading components. **Entered** = matching `AssessmentScore` rows.

**Why assignments, not `ClassSubject`:**
- `setup-state.service.ts` documents that `ClassSubject` gates nothing; the
  gradebook is built from `TeacherAssignment`.
- Production shows why it matters: one school has 35 class-subject links but 12
  assignments.

Counting unassigned subjects would report work no teacher was ever given.
Subjects with scores but **no** assignment are reported separately as "entered
without an assignment", not silently dropped.

Also per arm × subject: **signed off** (`Assessment.subjectSignedOffAt` set) over
students with any score. Component-level detail (CA1 vs exam) is out of v1.

#### D36 — The report-card pipeline

Per arm with enrolled students this term: cards per `ReportCardStatus`, plus
**enrolled students with no card built**. The total row is labelled distinctly
from the dashboard — "awaiting principal approval **this term**" versus its
all-terms count (§16.2).

#### D37 — Teacher recording activity replaces D2's "performance" view

Per user holding the `teacher` role, for the term:

| Column | Source |
|---|---|
| Arms as form teacher | `ClassArm.classTeacherId` |
| Registers taken / expected for those arms | D33, attributed to the arm, not to whoever clicked |
| Registers this person marked (any arm) | `AttendanceRecord.markedBy`, distinct arm-dates |
| Score slots entered / expected for their assignments | D35, restricted to their assignments |
| Last register marked, last score entered | `max(markedAt)`, `max(enteredAt)` |

**Deliberately absent:**
- any mark, average, pass rate, position, grade distribution or class outcome;
- any composite score, ranking or rating.

§4.4's "class outcomes" column is removed from v1. It belongs to the deferred
analytics (§16.9), and to a school with enough data to make it mean something.

The page says, verbatim: *"Recording activity only — what has been entered, not
how students performed or how well anyone teaches."*

**Attribution caveat, shown in the UI.** Admins can and do mark registers and
enter scores on a teacher's behalf (`markedBy`/`enteredBy` then names the admin).
So "registers taken for your arms" is attributed to the arm, and "marked by this
person" is shown separately. Otherwise a teacher whose admin keyed their marks
would look inactive.

**Access (§4.4 and §3.4 D22–D23), unchanged by the reframing:**
- owner/admin only, with no self-view;
- its own endpoint and permission, pinned in `permissions-coverage.spec.ts` as
  never granted to teacher or bursar;
- never an Insights intent;
- **every read writes a tenant-scoped audit row** (`reports.teacher-activity.view`).

With one teacher per school today, the table has one row. That is fine for
recording activity, which describes the work rather than comparing people. It
would not have been fine for performance.

#### D38 — Endpoints and shapes

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /reports/completeness?termId=` | `reports.completeness.read` | Sections 1–4. `termId` optional → current term; another school's term is a 404 |
| `GET /reports/teacher-activity?termId=` | `reports.teacher-activity.read` | D37; audited per read |

- **Groups shape** (CLAUDE.md): per-arm rows are `{ groupId, label, … }` keyed on
  `ClassArm.id`, with class level carried for grouping, so a future branch
  dimension re-keys without a contract change.
- **No student names** in either response; counts only.
- **One transaction per request, a fixed number of grouped queries** (never one
  per arm). Budget: ≤ 12 queries per request, given this database's history
  (the dashboard's 26→20 round-trip work, `tenant-timeout.spec.ts`).

#### D39 — Permissions

A new `REPORTS_PERMISSIONS` constant: `reports.completeness.read` and
`reports.teacher-activity.read`.
- **Admin** receives both (owner via wildcard); **neither** goes to teacher or
  bursar.
- It is an idempotent append migration, following
  `20260821000000_admin_dashboard_read_permission`, with `system-roles.ts`
  updated in step.
- The name deliberately avoids `report-card.*`.

#### D40 — Surfaces

- **Web `/reports`.** "Reports" leaves "Coming soon", gated on
  `reports.completeness.read`. The page has:
  - a term selector;
  - term-health signals at the top, each with its fix link;
  - attendance, score and report-card tables per arm;
  - CSV export through the existing helper.
- **Teacher recording activity** is a tab on the same page, **fetched only when
  opened**, so an admin who never opens it writes no audit row for a view they
  did not make.
- **Dashboard link (Q33).** One `needsYouToday` item when any D32 signal is
  active, linking to `/reports`. It reuses the completeness service's health
  computation; there is no second definition.
- **Not on mobile, not on the portal.** It is operator information.
- **No teacher-shell view in v1 (Q32).**

### 16.4 What §3.4 D21 means now

D21 ("admin reports include unreleased marks, clearly labelled") has **no effect
on v1**, because the completeness report shows no marks at all. It applies to
the deferred analytics (§16.9) and is carried there unchanged.

### 16.5 Tests

1. **Service spec, real Postgres** (`reports-completeness.service.spec.ts`).
   Fixtures for each shape the report must describe:
   - a school with **zero** data (zeros and the right signals, never an error);
   - a current term that has **ended** while a later term exists;
   - enrollments last term but not this term;
   - an arm with registers on some school days, plus:
     - a weekend;
     - a confirmed public holiday (excluded per Q31);
     - a **hidden** public holiday (not excluded);
     - an **unconfirmed** Eid (not excluded);
   - a whole-year assignment and a term-specific one (both counted in their
     term; the second not in other terms);
   - scores entered with no assignment (reported separately);
   - report cards across statuses, plus students with no card.

   Every expected and actual number is asserted exactly.
2. **Tenant isolation:** two schools; neither's counts move when the other's
   data changes; a `termId` from the other school is a 404.
3. **Teacher activity:**
   - an admin keys scores for a teacher's assignment → counted for the arm and
     shown as not the teacher's own entry;
   - exactly one tenant-scoped audit row per read.
4. **Both RBAC gates** via the real `PermissionsGuard` (the `bursar-scope`
   harness): teacher and bursar refused on both endpoints; a deactivated admin
   refused.
5. **Conformance:**
   - `permissions-coverage`, with a Reports block pinning that teacher and
     bursar never hold either permission;
   - `rbac-two-gate-conformance`;
   - `audit-coverage` (`reports.teacher-activity.view`);
   - `nav-items.spec`.
6. **E2E (Playwright):**
   - an owner whose current term has ended opens `/reports`;
   - sees `CURRENT_TERM_ENDED` with its link;
   - sees "1 of N school days" for an arm marked once;
   - opening the teacher tab writes one audit row;
   - a teacher account is refused the page.
7. **Production verification after deploy.** Run the completeness computation
   read-only against production and confirm it reports what §4.6 independently
   measured (for example, Virgo Fidelis's ended current term). If they disagree,
   one of them is wrong.

### 16.6 What CP2 does NOT do

- **Any outcome analytics** — averages, pass rates, distributions, positions,
  trends, per-teacher class outcomes (§16.9).
- Subject-period attendance completeness.
- Per-student register completeness; component-level score detail.
- Finance reports (existing finance surfaces cover them).
- Enrollment trends (no multi-term history to trend).
- PDF/Excel export; scheduled or emailed reports.
- A teacher-facing view (Q32); mobile or portal surfaces.
- Any change to Insights (§16.8).

### 16.7 Review questions — all resolved 2026-09-13 (Arinzechukwu)

| # | Question | Recommendation |
|---|---|---|
| **Q31 — APPROVED: yes** | May holidays (**confirmed**, non-hidden national holidays and the school's `HOLIDAY`/`BREAK` events) reduce **expected** register days, leaving attendance records and rates untouched? This extends §3.3 D20 | Yes — otherwise every holiday reads as a missed register |
| **Q32 — APPROVED: no** | Should teachers see their own recording completeness in v1? | No, per D22's spirit; the gradebook and register already show their gaps |
| **Q33 — APPROVED: yes** | Add one dashboard `needsYouToday` item linking to `/reports` when a term-health signal is active? | Yes — one count, same computation |

### 16.8 Known limits and follow-ups recorded

- **School week is Monday–Friday** until CP3 defines one; D33 switches to it
  then.
- **Subject-period attendance completeness** — add when a school has enabled it
  and recorded any.
- **Insights (Phase 5) runs its four AI-narrated reports on the same thin
  data.** It already caps rows and states the report it routed to, but "at-risk
  students" among 12 is not meaningful either. **Not changed here**; flagged for
  its own review rather than widened into CP2.

### 16.9 DEFERRED, not dropped — outcome analytics

The original §4.2/§4.4 scope remains a **real future item**, recorded in
`docs/deferred.md` ("Outcome analytics — deferred until real data supports it"):
- academic: class-arm and subject averages, pass rates, grade distributions, top
  and bottom students;
- attendance rates and trends;
- enrollment trends;
- teacher-level class outcomes, under all of §4.4's access rules and §3.4
  D21–D23;
- the SQL layer shared with Insights.

**Trigger — measured, not guessed.** At least one production school meeting, for
a completed term:

| Bar | Proposed threshold |
|---|---|
| Enrolled students | ≥ 40 across ≥ 2 arms |
| Attendance recording | ≥ 80% of expected arm-days (D33) |
| Score entry | ≥ 90% of expected score slots (D35) |
| Report cards | released for that term |
| Teacher-level outcomes, additionally | ≥ 2 teachers with assignments that term |
| Trends, additionally | ≥ 2 consecutive qualifying terms |

The thresholds are proposals, to be confirmed when the item is picked up. The
useful property is that **CP2's completeness report is the instrument that
measures the trigger**: a school crossing the bar shows up in the report this
checkpoint ships, not in another one-off production query.

### 16.10 Estimate — recalculated

| Work | Days |
|---|---|
| Permissions constant, grant migration, DTOs and Zod | 0.5 |
| `ReportsCompletenessService`: term health (D32), attendance (D33–D34 via `buildCalendar`), scores (D35), report-card pipeline (D36) | 2–2.5 |
| Teacher recording activity (D37) + audit | 0.5–1 |
| Real-database specs incl. isolation, RBAC, conformance | 1–1.5 |
| Web `/reports`: term selector, signals, three tables, teacher tab, CSV | 1.5–2 |
| Dashboard `needsYouToday` item (Q33) | 0.25–0.5 |
| E2E + production verification against §4.6 | 0.5–1 |
| **Total** | **6.25–9 → 6–9 working days** (was 9–13) |

| | Before | After |
|---|---|---|
| CP2 | 9–13 | **6–9** |
| Phase 8 (CP0–CP6b) | 54–81 | **51–77** |
| Total engineering incl. Phase 8b | 79–121 | **76–117** |

**Why it shrinks:** the original scope needed a SQL layer shared with Insights,
four analytics families, and outcome-bearing teacher views with interpretive
safeguards.

**Why it doesn't shrink further:** the "expected" definitions (school days net
of holidays, assignment-effective score slots) are the real work. A report that
tells a school it is behind has to be exactly right; one false "missed
register" costs the report its credibility.

### 16.11 Built — 2026-09-13

Implemented as approved, on PR #300. The evidence below was freshly produced.

#### The expected definitions — tested against a real database and mutation-tested

**`school-days.spec.ts`** (pure, 13 tests). Every answer is hand-counted against
the March 2026 calendar:
- whole term, mid-term (today counts), not yet started, starting today;
- confirmed holiday excluded, and **unconfirmed estimate not excluded**;
- school `HOLIDAY`/`BREAK` excluded, while `MEETING`, `EVENT`, `EXAM_PERIOD`,
  `RESUMPTION`, `OTHER` and term markers are not;
- a break spanning a weekend, and a holiday clipped at the term edge;
- two reasons on one day, and a holiday falling on a weekend.

**`completeness.service.spec.ts`** (real Postgres, 19 tests). One fixture school
whose every figure is written next to its hand count:
- **15 school days** (20 weekdays − Eid-el-Fitr 19–20 − a school holiday on the
  10th − a break on the 12th–13th; the MEETING on the 5th is a school day);
- registers **4 taken + 3 on non-school days**, with a day holding two students
  counting once;
- a class with no enrollment absent from the report, and a WITHDRAWN student
  not counted;
- mid-term **7**, before the term **0**;
- hiding Eid restores it: **17** school days, and its register moves to "taken";
- scores:
  - arm1 × Maths **4 of 6** (whole-year assignment) and arm1 × English **2 of 6**
    (term-specific);
  - a later-term assignment and an inactive assignment owe nothing;
  - an unassigned Science score reported separately;
- report cards: 1 RELEASED + 1 DRAFT, and 1 student without a card;
- term health, in exact order, for four fixture schools;
- another school's term is a 404;
- teacher activity: registers attributed to the arm, the **5 of 6** self-keyed
  entries separated from the admin's 1, one audit row per read;
- both RBAC gates refuse teacher and bursar; a deactivated owner is refused.

**Mutation tests.** Each definition was broken in the real code, the spec rerun,
and the code restored:

| Definition broken | Spec result |
|---|---|
| Holidays never excluded | **6 failed** |
| Registers on non-school days counted as taken | **5 failed** |
| Whole-year assignments ignored | **4 failed** |
| WITHDRAWN enrollments counted | **1 failed** |
| All restored | **19 passed** |

#### The dashboard alert (Q33) without a second transaction

- `computeTermHealth` is **one** raw CTE query on the caller's transaction
  handle.
- It adds exactly one round trip to the dashboard's first stage.
- `dashboard-transaction.spec.ts` (the deadlock regression gate: one transaction
  per request) still passes.
- One dashboard assertion changed, and was tightened rather than loosened. The
  "school with no data" fixture's current term ended on 2025-12-15, so
  `term_health` is asserted as **exactly 1**, where before every alert was
  asserted zero.

#### End to end, in a real browser

`e2e/tests/recording-completeness.spec.ts` (passed, 21.1s):
- the owner reaches `/reports` from the sidebar;
- sees "The current term ended on Fri 27 Mar 2026" with its fix link;
- sees "counted up to Fri 27 Mar 2026: 18 school days", "1 of 18 class registers
  taken", "1 of 18 school days" on the class row, the two Eid days listed as not
  counted, and "2 students with no card yet";
- no "average", "position" or "pass rate" anywhere on the page;
- opening the teacher tab writes **exactly one** audit row, re-checked after
  1.5s so a double-mounted effect would show;
- a teacher gets **403** on both endpoints, and the refusal writes no audit row;
- the teacher never sees the page.

Screenshots were reviewed. Run alongside `admin-roster-happy-path`,
`first-school-setup` (which renders the dashboard), `phase-0-happy-path` and
`event-calendar`: **5 passed**.

#### Pre-deploy production dry run of the exact term-health SQL

The SQL was **extracted from `term-health.ts` programmatically** (not retyped) and
run read-only in the production container as `app_user`, per school under
`withTenant`. Signal codes and counts only. Compared with the independent §4.6
measurement:

| Check | §4.6 | Dry run |
|---|---|---|
| Current term already ended | 6 | **6** |
| Virgo Fidelis (12 students) | current term ended 31 Aug; a 2026/2027 year exists | **`CURRENT_TERM_ENDED` (2026-08-31), `NEXT_TERM_NOT_CURRENT`** |
| Students but no enrollment this term | 9 (6 of them with no current term) | **3** = 9 − 6 (the signal applies only when a term exists) |
| No current term | 50 of 75 | 54 of 79 — **reconciled**: the dry run filtered test schools by slug only; the 4 extra schools matched §4.6's name filter and all 4 have no current term (50 + 4 = 54) |

The report and the independent measurement agree on every figure.

#### Wider regression

| Suite | Result |
|---|---|
| `pnpm lint` / `pnpm typecheck` | 9/9 · 14/14 |
| API vitest, full run | **2,020 passed, 3 skipped, 0 failed** (141 files) |
| `permissions-coverage` (new Reports block: teacher/bursar hold neither permission), `rbac-two-gate-conformance`, `audit-coverage` (`reports.teacher-activity.view`), `security-definer-inventory` | pass (SD count unchanged) |
| web vitest | 334/334 (incl. `nav-items.spec`: Reports promoted and gated) |
| mobile vitest | 167/167 |

#### What the build found that the plan did not

1. **A pre-existing `/dashboard` navigation race blocked the sidebar click in
   e2e.** A link clicked before the dashboard's own `?termId=` replace lands is
   cancelled. This is the race already recorded in `docs/deferred.md`. The spec
   waits for the replace, as existing specs do. Not fixed here.
2. **The term selector follows the current academic year, not just the current
   term.** An e2e fixture that marked a term current without its year showed the
   wrong year's terms. The fixture now keeps both current, which is the
   invariant `setCurrentTerm` maintains.
3. **A first dev-mode compile of `/reports` took ~15.6s**, just over the default
   15s assertion timeout. That is dev-server behaviour, not the page; the first
   assertion allows 60s.
4. **The service needs a pinnable clock.** Every expected figure depends on
   "today", so `todayFn` is a plain property specs set explicitly, keeping Nest
   DI unaffected.

### 16.12 Deployed and verified in production — 2026-09-14 (CP1 and CP2)

**CP1 (Event Calendar)** was verified live on 2026-09-13; that evidence is in
§15.10 and is not repeated here. In summary:
- migrations applied;
- a live INSERT into `national_events` as `app_user` refused (42501);
- seed 22 rows;
- routes 401 against a 404 control.

**CP2 (Recording Completeness)** below.

**Merge and deploy.**
- PR #300 merged as `7478a32` after both required checks passed on its final
  head commit (`3c4bd1c`), with branch protection re-read first.
- `main` CI passed; deploy run `34813759125` succeeded.
- The deploy log shows `Applying migration
  20260914120000_phase_8_cp2_reports_permissions` then "All migrations have been
  successfully applied."
- The post-release smoke test passed 6/6.

**Live-code verification.** A read-only script ran inside the production
`school-kit-api` container, as `app_user`. It loaded the **deployed**
`/app/dist/modules/reports/completeness.service.js`, the file the API serves,
rather than re-running extracted SQL, and called `getCompleteness` as each
school's real active owner, so the live role gate ran too. It deliberately did
**not** call `getTeacherActivity`, which writes an audit row by design.

| Check | Result |
|---|---|
| `_prisma_migrations` | `20260914120000_phase_8_cp2_reports_permissions` finished 2026-09-14T06:31:26Z, not rolled back |
| System role grants | admin: both reports permissions; teacher and bursar: neither; owner: wildcard |
| SECURITY DEFINER count | 22 (unchanged) |
| Schools checked | 70, errors 0 (9 skipped: no active owner to run as) |

**Signal counts — live code against the pre-deploy SQL dry run (§16.11):**

| Signal | Dry run (79 schools) | Live code (70 schools) |
|---|---|---|
| `CURRENT_TERM_ENDED` | 6 | **6** |
| `ARMS_WITHOUT_FORM_TEACHER` | 7 | **7** |
| `ARMS_WITHOUT_SUBJECT_TEACHERS` | 7 | **7** |
| `NEXT_TERM_NOT_CURRENT` | 1 | **1** |
| `NO_ENROLLMENT_THIS_TERM` | 3 | **3** |
| `NO_CURRENT_TERM` | 54 | **45** |

**`NO_CURRENT_TERM` 54 → 45 is inferred, not individually verified.** The live
run skipped 9 schools with no active owner (70 + 9 = 79). Every other signal
count is identical, so those 9 carry no other signal, and 54 − 9 = 45 is
consistent with all 9 having no current term. The 9 were not each re-checked.

**Virgo Fidelis (12 students), hand-verified from first principles:**
- The current term is Second Term 2025/2026, 7 Jun – 31 Aug 2026.
- Weekdays in that range: **61**. Excluded weekdays: Democracy Day (Fri 12 Jun)
  and Eid-el-Maulud (Tue 25 Aug) = **59 school days**, which is what the live
  report returned.
- 4 classes × 59 = **236** registers expected. The live report returned 236.
- **0 registers taken on school days, 1 on a non-school day.** §4.6 found the
  only attendance ever recorded in production was on **25 Aug 2026**, which is
  Eid-el-Maulud. The report correctly does not count a register marked on a
  public holiday as a school-day register.
- Score slots: **36 expected, 0 entered this term.** This matches §4.6's 36
  component slots; Virgo's 24 score rows are all in the previous term.
- 12 students with no report card this term (its cards are in the previous
  term).
- Signals: `CURRENT_TERM_ENDED` (31 Aug), `NEXT_TERM_NOT_CURRENT`,
  `ARMS_WITHOUT_FORM_TEACHER`, `ARMS_WITHOUT_SUBJECT_TEACHERS`.

**Live HTTP:**

| Request | Result |
|---|---|
| `GET /api/v1/reports/completeness`, `/reports/teacher-activity` (no auth) | 401 each |
| Control: `GET /api/v1/reports/does-not-exist` | 404, so the 401s prove the routes are deployed |
| `https://app.schoolkit.ng/reports` | 200 |

**Reliability finding during the live check.** One school's report transaction
ran past Prisma's 5000 ms interactive-transaction default: `withTenant` logged
`retrying after connection-level error (P2028) after 5024ms — body ran long`,
and the retry succeeded. That is the same class of failure as the 2026-09-11
dashboard incident, on the same Fly-Johannesburg → Neon-Frankfurt link. The
report runs ~12 statements in one transaction, like the dashboard's ~20.
**Fixed immediately** rather than deferred, applying the dashboard's proven
15-second override: see §16.13.

**CP2 is closed.**

### 16.13 Fix — the report's transaction budget (2026-09-14)

**Problem (found in §16.12's live check).** The completeness report ran its ~12
statements inside `withTenant` at Prisma's 5000 ms interactive-transaction
default. One production run hit P2028 at 5024 ms and survived only on
`withTenant`'s single retry. This is the same failure class as the 2026-09-11
`/dashboard` incident.

**Fix.** A new constant `REPORTS_TRANSACTION_TIMEOUT_MS = 15_000`, the value
already proven by `DASHBOARD_TRANSACTION_TIMEOUT_MS`, is passed with a diagnostic
label on both report transactions:
- `reports.getCompleteness`
- `reports.getTeacherActivity`

It is safe for the dashboard's reason: every report read runs on one connection
with no nested `withTenant`, so a longer hold waits on nothing and cannot
deadlock.

**Gate.** `reports-transaction.spec.ts` intercepts `withTenant`, the technique
`dashboard-transaction.spec.ts` established. It asserts, for both endpoints,
**exactly one** report transaction per request, carrying `timeoutMs: 15000`.
- Run against the unfixed code first: **2 failed** (`expected undefined to be
  15000`; `expected [] to deeply equal [{ label, timeoutMs: 15000 }]`).
- After the fix: **passes**.
- Timing is never involved, so the gate is deterministic.

Not changed: `withTenant`'s own retry behaviour, the role-check transaction
(short, unchanged), and `DashboardService`'s call to `computeTermHealth`, which
already runs inside the dashboard's 15-second transaction.

**Deployed and verified — 2026-09-14.**
- PR #301 merged as `f21063f` after both required checks passed on its final head
  commit (`244eea9`), with branch protection re-read first.
- `main` CI passed; deploy run `34821152876` succeeded ("No pending migrations to
  apply."; smoke test 6/6).
- The background watcher reported a CI failure. The watcher, not CI, failed:
  `gh` showed `main` CI as success, which was confirmed directly before
  proceeding.

In the production container:
- the **deployed** `/app/dist/modules/reports/completeness.service.js` contains
  `REPORTS_TRANSACTION_TIMEOUT_MS = 15_000` and both labelled calls
  (`reports.getCompleteness`, `reports.getTeacherActivity`);
- the §16.12 read-only live-code check was re-run against the fixed code: 70
  schools, 0 errors, every signal count identical;
- Virgo Fidelis unchanged: 59 school days, 236 expected registers, 1 on a
  non-school day, 36 score slots expected — the fix changed no figure.

**Zero P2028 retries occurred on this run. That is consistent with the fix, not
proof of it** — the original slow transaction was intermittent. The evidence for
the fix is the pinned gate (`reports-transaction.spec.ts`, which failed against
the unfixed code) and the deployed value above.

---

## 17. CP3 plan-first — Timetable builder

Written 2026-09-14. **Status: approved in full 2026-09-14 (§17.7); built 2026-09-14 (§17.9), awaiting merge and deploy.**

**Scope:** the data model, one bell schedule per school, a manual per-class
timetable builder with teacher-clash detection, and the admin screens. CP4
(§12.1) keeps the copy-forward/fork workflow and the teacher, student and
guardian read screens.

**Decided before this plan (§3.5):**
- per-term or per-year, varying by class (D3);
- a year and a term timetable may coexist, with the term timetable replacing the
  year one entirely (D13);
- free-form bell schedules with double periods as consecutive slots (D24, Q7);
- manual builder only (D25, Q8);
- **one bell schedule per school in v1** (D26).

### 17.1 What CP3 inherits, verified not assumed

Checked against `main` @ `f21063f` on 2026-09-14:

| Thing | State |
|---|---|
| Any timetable, bell-schedule, period, lesson, `dayOfWeek` or time-of-day field | **None** (re-grepped `schema.prisma` today; §7.1 still holds) |
| `TeacherAssignment` | teacher × class arm × subject × academic year, `termId` nullable (= whole year), `isActive`; co-teaching allowed |
| `SubjectAttendanceRecord.period` | a bare `Int ≥ 1`, linked to nothing |
| School-week setting | **none** — CP2's expected-days definition hard-codes Monday–Friday and records that it switches when CP3 defines a week (§16 D33, §16.8) |
| Time-of-day column convention | **none** in CLAUDE.md or the schema |
| Row locking / serializable / advisory locks | **no precedent anywhere in `apps/api`** (grepped `FOR UPDATE`, `isolationLevel`, `Serializable`, `pg_advisory`) — CP3 introduces the first, stated as such in D32 |
| Current enrollment for a student | `loadCurrentEnrollmentForStudent` exists (portal-students) — what CP4's student and guardian reads will use |
| Production data (§4.6) | 16 active teacher assignments across 2 schools; no school has more than one teacher or more than 4 classes with students |

**A Postgres fact that shapes the data model:** foreign-key checks bypass
row-level security, always. A plain `bell_slot_id → bell_slots.id` foreign key
would therefore accept another school's slot id: RLS hides the row from reads,
but the referential check does not consult RLS. D29 closes this in the schema
rather than relying on the service to remember.

### 17.2 Confirming D26: does one bell schedule per school simplify clash checking?

**Yes, concretely, and the estimate moves accordingly (§17.8).**

With a bell schedule per class (§7.3 as originally scoped), two lessons could
clash while sitting in *different* slots of *different* schedules whose times
overlap. Clash detection had to compare time intervals, and a teacher's lessons
in two classes could overlap partially. That required:
- interval-overlap logic, and re-checking every timetable whenever any
  schedule's times changed;
- a test matrix across mixed schedules;
- a schedule picker per timetable and CRUD for many schedules.

With **one** schedule per school, every class shares the same slots, so:
1. **A clash is an identity match:** same teacher, same weekday, same
   `bell_slot_id`, in two different classes whose timetables are in force in a
   common term. It is a `GROUP BY … HAVING count(DISTINCT class) > 1`, with no
   time arithmetic.
2. **Editing slot times can never create or remove a clash**, because clashes
   don't depend on times. A time edit needs no re-check at all.
3. **The mixed-schedule test matrix disappears.** Tests cover term and year
   combinations only.

**What it does NOT remove, stated honestly.** The effective-timetable resolution
that D3/D13 require is untouched. "Which timetable is in force for this class in
this term" is still derived: a term timetable replaces the year one. So:
- clash checking still has to evaluate **every term** a year-wide change
  touches;
- it still cannot be a database constraint;
- it still needs a per-school lock against concurrent edits.

That is the majority of D3's original cost, and it remains.

**Per-class schedules are deferred, not designed around.** No `bell_schedules`
table exists in v1, and slots belong directly to the school. If real usage later
shows a school needs different bell times across classes, the migration is
additive:
- introduce a `bell_schedules` table;
- backfill one per school;
- add `bell_schedule_id` to slots and to timetables;
- move clash detection back to interval logic.

Recorded in `docs/deferred.md` when this checkpoint ships.

### 17.3 Decisions (approved 2026-09-14)

Numbered from D27 to continue §3's phase-level log. (§15 and §16 used local
D-numbers for their own engineering decisions and are referenced as "§15 D22",
"§16 D33".)

#### D27 — Time of day is stored as integer minutes since midnight

`start_minute` and `end_minute INTEGER`, with `CHECK (0 <= start_minute AND
start_minute < end_minute AND end_minute <= 1440)`.

**Not `@db.Time`:**
- Prisma maps `TIME` to a JavaScript `Date` pinned to 1970-01-01. That turns a
  wall-clock time into a timestamp that serialises with a `Z`.
- It invites exactly the "midnight in which zone?" confusion CLAUDE.md's
  date rule exists to prevent.

**Integer minutes** are:
- zone-free by construction;
- trivially ordered;
- checkable in SQL;
- formatted once, at display ("08:10").

School time is Lagos wall-clock time and is never converted. This is a **new
convention** and is added to CLAUDE.md's "Prisma column types in raw SQL"
section in the same PR.

#### D28 — The data model

| Table | Columns (beyond `id`, `school_id`, timestamps) | Notes |
|---|---|---|
| `bell_slots` | `position INT`, `label TEXT` ("Period 1", "Break"), `kind` enum `LESSON` \| `BREAK` \| `ASSEMBLY` \| `OTHER`, `start_minute`, `end_minute` | **One schedule per school** (D26): the school's slots are the schedule. Unique `(school_id, position)`. Slots must not overlap one another (service-checked on save of the whole schedule) |
| `timetables` | `class_arm_id`, `academic_year_id`, `term_id` nullable | **A header per class** (D3). `term_id` null = in force for the whole year. Partial unique indexes: one year-wide per `(class_arm_id, academic_year_id) WHERE term_id IS NULL`; one per `(class_arm_id, term_id) WHERE term_id IS NOT NULL` (§7.2). The term must belong to the stated year (service-checked, the `Enrollment` precedent) |
| `timetable_entries` | `timetable_id`, `day_of_week SMALLINT` (1 = Monday … 7 = Sunday, ISO), `bell_slot_id`, `subject_id` | Unique `(timetable_id, day_of_week, bell_slot_id)`: one lesson per cell |
| `timetable_entry_teachers` | `entry_id`, `teacher_id` | Co-teaching (`TeacherAssignment` allows it). Unique `(entry_id, teacher_id)` |
| `schools.school_week_days SMALLINT[]` | default `{1,2,3,4,5}` | The school week (D33) |

**Double periods (D24)** are consecutive `LESSON` slots holding the same subject
and teachers. There is no "double period" row. The builder offers "span N
slots", which writes N entries in one mutation, and the grid renders adjacent
identical entries merged. Nothing else in the system needs to know a lesson is
double.

**Only `LESSON` slots accept entries.** Changing a slot's kind away from
`LESSON`, or deleting a slot, is refused while entries use it. A foreign key
`ON DELETE RESTRICT` is the backstop, with a service message naming how many
lessons use the slot.

#### D29 — Composite foreign keys make cross-school references impossible in the database

Because referential checks bypass RLS (§17.1), every reference from a timetable
table to a tenant table is a **composite** foreign key on `(school_id, id)`:
- `timetable_entries (school_id, bell_slot_id) → bell_slots (school_id, id)`
- `timetable_entries (school_id, subject_id) → subjects (school_id, id)`
- `timetable_entries (school_id, timetable_id) → timetables (school_id, id)`
- `timetable_entry_teachers (school_id, entry_id) → timetable_entries (school_id, id)`
- `timetable_entry_teachers (school_id, teacher_id) → users (school_id, id)`
- `timetables (school_id, class_arm_id) → class_arms (school_id, id)`,
  `(school_id, academic_year_id) → academic_years`, `(school_id, term_id) → terms`

Each target gains a `UNIQUE (school_id, id)` index. That is always satisfiable,
since `id` is already unique, and cheap.

With these, an entry in school A **cannot** name school B's slot, subject,
teacher or class, even through a service bug or raw SQL, because the row it
would need, `(A, B's id)`, does not exist. The RLS spec proves it with a real
cross-tenant insert that must fail on the constraint (§17.6).

#### D30 — A clash, defined

**Two lessons clash when, for some term τ:**
- they share a teacher;
- they fall on the same `day_of_week` and `bell_slot_id`;
- they belong to **different** classes;
- both of their timetables are **in force** in τ.

**In force** (D3/D13): a class's term-τ timetable if one exists; otherwise its
year-wide timetable for τ's academic year.

Out of scope for a clash:
- **the same class twice in one slot** — that is already impossible (the unique
  cell);
- **a teacher in two slots that overlap in time** — impossible in v1, because
  slots don't overlap and are shared (§17.2).

#### D31 — Clash checking is write-then-verify, one query, for every mutation

Every mutating operation runs inside one `withTenant` transaction:
1. take the school's timetable lock (D32);
2. apply the change;
3. run **the clash query** for the affected academic year;
4. if it returns any row, **throw `ConflictError` `TIMETABLE_CLASH`** with the
   clashing teacher, day, slot, term and classes, and the transaction rolls
   back; otherwise commit.

That one path covers every operation that can create a clash:
- adding or moving a lesson;
- spanning a double period;
- adding a teacher to a lesson;
- creating a term timetable (it changes what is in force for that term);
- **deleting** a term timetable (the year-wide one comes back into force and
  may clash with another class's term timetable).

It needs no per-operation reasoning about "what could this change affect",
which is where hand-written checks go wrong.

The query computes, for the year, each class's timetable in force per term,
then groups lessons by `(teacher, day, slot, term)` and returns groups spanning
more than one class. It is bounded by one school's one academic year, and
grouped in SQL, never one query per class.

Operations that **cannot** create a clash skip it, each for a stated reason:
- editing slot times (§17.2);
- removing a lesson or a teacher (removal only removes lessons);
- renaming.

#### D32 — Serialise timetable writes per school with a transaction-scoped advisory lock

Two admins editing two classes can each produce a timetable with no clash that,
combined, has one. Under the default READ COMMITTED isolation, neither
transaction sees the other's uncommitted lesson.

**Fix:** `SELECT pg_advisory_xact_lock(hashtextextended('timetable:' || school_id, 0))`
as the first statement of every timetable mutation. Timetable writers for one
school run one at a time; different schools never contend; reads are never
blocked.

**Why this primitive, stated because it is the first lock in this codebase
(§17.1):**
- **It is transaction-scoped.** It releases at commit or rollback, so it can't
  leak across a pooled connection. That makes it safe under PgBouncer
  transaction pooling, which `withTenant`'s own `set_config(…, true)` already
  relies on.
- **`SERIALIZABLE` was considered and rejected.** It would surface as
  serialization failures to retry, on a code path whose `withTenant` retry
  covers connection errors, not serialization errors.
- **`SELECT … FOR UPDATE` on a school row was considered and rejected.** It
  would also block unrelated writes to `schools`.

**Cost:** timetable edits in one school queue behind each other. A save is
~10 ms of SQL, and admins edit rarely; this is the right trade.

#### D33 — Assigning a teacher to a lesson must match a real assignment

A lesson's teacher must hold an active `TeacherAssignment` for that class and
subject, **effective in the term(s) the timetable is in force**:
- **in none** of those terms → refused (`TEACHER_NOT_ASSIGNED`);
- **in some but not all** (e.g. a year-wide timetable, but a term-only
  assignment) → saved, with a warning returned and shown in the grid.

This keeps the timetable consistent with the gradebook and teacher scope, which
are built from assignments. (§7.3 item 5's recommendation, now a decision
proposal.)

**A lesson may have no teacher yet (Q34)** — a school can timetable a subject
before hiring. It can't clash and is shown as "No teacher".

#### D34 — The school week

A per-school `school_week_days` setting (default Monday–Friday), edited
alongside the bell schedule. Real reason, not speculation: some Nigerian private
schools hold Saturday classes. **The grid shows these days only.**

**CP2's expected-days definition switches to it in this checkpoint** (§16 D33
recorded that it would). `computeSchoolDays` takes the school's week instead of
hard-coding Monday–Friday, and the completeness spec gains a Saturday-school
case. For every existing school the result is unchanged, because the default
*is* Monday–Friday. → Q35 confirms.

#### D35 — Permissions

A new `TIMETABLE_PERMISSIONS` constant:
- `timetable.read`
- `timetable.manage` (bell schedule, school week, lessons, timetables)

**CP3 grants both to owner/admin only.** Teachers, students and guardians get
their read screens in CP4, whose plan-first decides their endpoints and grants.
No teacher or bursar grant here: the whole-school grid names every teacher's
week, and teacher reads follow the scoped-surface rule
(`rbac-two-gate-conformance` I2 exceptions).

**Every mutation is audited**, tenant-scoped, with the before/after of the cell.

#### D36 — Surfaces (CP3)

- **Settings → Bell schedule:**
  - an ordered slot list (label, kind, start, end), saved as a whole;
  - school-week days;
  - validation messages for overlapping or out-of-order slots.
- **Timetable** (`/timetable`, promoted from "Coming soon", gated on
  `timetable.read`):
  - a class picker;
  - a **"Whole year" / "This term only"** choice per class (D3), showing which
    timetable is in force for the selected term;
  - a day × slot grid; click a lesson cell → subject, teacher(s), "span N
    periods";
  - clash errors name the teacher, the other class, day and period;
  - partial-assignment warnings inline;
  - creating a "This term only" timetable starts **empty** in CP3 (copy/fork is
    CP4).
- **Not in CP3:** teacher, student and guardian read views; copy-forward; fork;
  printing.

### 17.4 Rules that are easy to get wrong, stated once

1. Deleting a term timetable is a mutation that **can** create a clash (D31).
2. Editing slot times **cannot**, so it skips the check (§17.2).
3. `day_of_week` is ISO (1 = Monday). `Date.getUTCDay()` is 0 = Sunday; every
   conversion goes through one helper.
4. A year-wide timetable is in force only for terms **of its own academic year**.
5. Deactivating a class doesn't delete its timetables; builder and reads list
   active classes only.
6. A timetable on a term that is deleted cascades away (`terms` → `timetables`
   `ON DELETE CASCADE`); a lesson can never outlive its slot (`RESTRICT`).

### 17.5 What CP3 does NOT do

- **Per-class bell schedules** (D26 — deferred until usage shows the need).
- Automatic timetable generation or optimisation (D25).
- Rooms and room clashes.
- Copy-forward, fork-from-year, and the teacher/student/guardian read views (CP4).
- Substitution/cover.
- Periods-per-week targets. There is no target data anywhere, so §7.4's "soft
  warning" has nothing to warn against; it is dropped rather than invented.
- Linking `SubjectAttendanceRecord.period` to slots (existing data; §7.5).
- Printing or exporting the grid.

### 17.6 Tests

1. **RLS + composite-FK spec (real Postgres, as `app_user`)** for all four
   tables:
   - no-GUC reads see nothing; each school sees only itself;
   - cross-tenant INSERT rejected by `WITH CHECK`, with a control insert
     succeeding;
   - **under school A's own GUC, an entry referencing school B's slot, subject,
     class or teacher is rejected by the composite foreign key** (D29), with
     the control referencing A's own rows succeeding.
2. **Clash spec (real Postgres)** — each case hand-constructed:
   - same teacher, same day and slot, two classes, both year-wide → clash;
   - different day, or different slot → no clash;
   - class A year-wide, class B **term-2-only** → clash only in term 2's
     effective set, and the error names term 2;
   - class A has a term-2 timetable **without** that lesson → A's year-wide
     lesson is not in force in term 2, so no clash in term 2 but a clash in
     terms 1 and 3;
   - **deleting** A's term-2 timetable brings the clash back → the delete is
     refused and rolled back;
   - co-taught lesson where only one teacher clashes → the clash names that
     teacher;
   - two classes in **different academic years** → never a clash;
   - a lesson with no teacher → never a clash;
   - spanning a double period into an occupied cell → refused; into a
     non-LESSON slot → refused.
3. **Concurrency spec:** two transactions writing lessons that clash only in
   combination, started together. With the advisory lock, one commits and the
   other gets `TIMETABLE_CLASH`. **Mutation-tested:** with the lock removed,
   both commit and the clash query then finds the clash that was let in.
4. **Mutation tests on the clash query**, in the CP2 manner:
   - ignore term replacement (treat all timetables as in force);
   - drop the "different class" condition;
   - skip the check on term-timetable delete.

   Each must fail specific cases.
5. **Assignment validity (D33):** none → refused; partial → saved with warning;
   inactive assignment → treated as none.
6. **Bell schedule:**
   - overlap refused;
   - deleting or re-kinding a used slot refused with a count;
   - time edits don't run the clash check (asserted by intercepting the query,
     the `reports-transaction.spec` technique).
7. **CP2 switch (D34):** the existing completeness spec unchanged; a new
   Saturday-school case (Mon–Sat week) counts Saturdays.
8. **Conformance:**
   - `permissions-coverage` (teacher and bursar hold neither timetable
     permission);
   - `rbac-two-gate-conformance`;
   - `audit-coverage` (every mutation);
   - `nav-items.spec`;
   - `security-definer-inventory` (count unchanged — no SD function).
9. **E2E:**
   - owner sets a bell schedule, builds class A's year-wide grid with teacher T
     on Monday period 1;
   - attempts T on Monday period 1 for class B → sees the clash message naming
     class A;
   - moves it to period 2 → saved;
   - screenshots reviewed.
10. **Production verification after deploy:**
    - migrations applied;
    - RLS forced and policies present on the four tables;
    - composite FKs present (`pg_constraint`);
    - grants correct;
    - SD count 22;
    - route 401 against a 404 control;
    - the re-run CP2 live check shows unchanged figures (D34 default week).

### 17.7 Review questions — all approved 2026-09-14 (Arinzechukwu)

| # | Question | Recommendation |
|---|---|---|
| **Q34 — APPROVED: yes** | May a lesson have no teacher yet? | Yes, shown as "No teacher" |
| **Q35 — APPROVED: yes** | Add a per-school `school_week_days` setting in CP3 and switch CP2's expected days to it now (unchanged for every current school)? | Yes — CP2 already committed to switching when a week exists |
| **Q36 — APPROVED: yes** | D33: refuse a lesson teacher with no effective assignment, and warn (not refuse) when only some terms are covered? | Yes |
| **Q37 — APPROVED: yes** | Accept the first advisory lock in the codebase (D32) as the concurrency mechanism for timetable writes? | Yes |

### 17.8 Estimate

| Work | Days |
|---|---|
| Schema: 4 tables, `school_week_days`, composite FKs + supporting unique indexes, partial unique indexes, RLS, policies file; CLAUDE.md time convention | 1.5–2 |
| RLS + composite-FK spec | 0.5 |
| Bell schedule + school week API and settings screen | 1–1.5 |
| Timetable API: headers, lessons, span, teachers, assignment validity (D33), audit | 1.5–2 |
| Effective resolution + clash query + advisory lock (D30–D32); clash, concurrency and mutation specs | 2–3 |
| `/timetable` grid builder UI with clash and warning display | 1.5–2.5 |
| CP2 school-week switch (D34) + spec case | 0.5 |
| Permissions migration, nav promotion, conformance, e2e, production verification | 0.5–1 |
| **Total** | **9–13 working days** |

**Against the previous CP3 estimate of 11–16:** smaller by 2–3 days, from D26.
Removed:
- interval-overlap clash logic and its re-check on time edits;
- the mixed-schedule test matrix;
- per-timetable schedule selection;
- CRUD for many schedules.

Two small things were **added** that the §7 estimate did not carry:
- composite foreign keys (D29), found while checking how RLS and foreign keys
  interact;
- the CP2 school-week switch (D34), already committed to in §16.8.

| | Before | After |
|---|---|---|
| CP3 | 11–16 | **9–13** |
| CP4 | 5–7 | 5–7 (unchanged; its plan-first will re-check) |
| Timetable total | 16–23 | **14–20** |
| Phase 8 (CP0–CP6b) | 51–77 | **49–74** |
| Total engineering incl. Phase 8b | 76–117 | **74–114** |

### 17.9 Built — 2026-09-14

Implemented as approved, on PR #302. Every figure below was freshly produced on
this branch against a real local Postgres; nothing is carried over from the plan.

#### The concurrency proof — the lock is necessary, not decorative

`timetable-concurrency.spec.ts` (real concurrent transactions, 3 tests). Two
admins save Tunde Bello on Monday P1 in JSS 1A and in JSS 1B at the same time.
The service's `afterWriteHook` is a **barrier**: it holds the first transaction
between its write and its clash query until the second arrives (or 1.5 s
passes). That forces the dangerous interleaving deterministically instead of
hoping a race lands.

| Run | Lock | Result |
|---|---|---|
| CONTROL | removed (`lockFn` = no-op) | **both commit**; both reached the barrier together; the clash query afterwards finds the clash that was let in (3 rows, one per term) |
| Real | `pg_advisory_xact_lock` | **one commits, one fails `TIMETABLE_CLASH`**; the second reached the barrier only ≥ 1.45 s after the first (blocked at its first statement); 1 lesson committed, 0 clashes |
| Scope | held in an open transaction | a same-school write is **still blocked after 1 s** (control), while another school's write completes in < 1 s |

The same operations run in both cases; only the lock differs. The reverse is
also tested (mutation M7 below): making the lock key unique per transaction, so
it never contends, fails the real run and the scope test.

#### Clash rules — real Postgres, hand-constructed, mutation-tested

`timetable.service.spec.ts` (real Postgres, 31 tests), on a fixture whose every
assignment is stated in its header:
- same teacher/day/slot in two year-wide classes → refused with 409, named
  "Tunde Bello would be teaching JSS 1A and JSS 1B at the same time — Monday,
  P1, First Term.", one clash per term; **rolled back** (no lesson, and exactly
  one `timetable.lesson.save` audit row — the successful one);
- different day, or different slot → saved, clash query empty;
- A year-wide + B Second-Term-only → the clash exists **only in Second Term**;
- A has an empty Second-Term timetable → A's year-wide lesson is out of force
  there: the clash set is exactly **First and Third**;
- **deleting** A's Second-Term timetable brings the clash back → delete refused,
  timetable still present; a year-wide delete never runs the query;
- co-taught lesson → the clash names only the teacher who clashes;
- different academic years → never; no teacher (Q34) → never;
- the second half of a double period clashes like any lesson;
- span into an occupied cell / a break / past the day's end → refused, nothing
  written; re-saving a double over its own second half → allowed;
- a day outside the school week → refused.

**Mutation runs.** Each rule was broken in the real code, the three specs
(timetable service, concurrency, completeness — 51 tests) rerun, and the file
restored from git; the tree was clean afterwards.

| Mutation | Result |
|---|---|
| M1 ignore term replacement (in-force resolution) | **2 failed** — the First/Third clash set; the delete-brings-it-back case |
| M2a `count(DISTINCT class_arm_id) > 1` → `count(*) > 1` | **0 failed — equivalent mutant**, see below |
| M2b "different class" condition dropped (`> 0`) | **21 failed** |
| M3 no clash check on term-timetable delete | **1 failed** — the delete case |
| M4 `day_of_week` dropped from the grouping | **1 failed** — different day |
| M5 `bell_slot_id` dropped from the grouping | **2 failed** — different slot; co-taught |
| M6 year scoping removed from in-force timetables | **1 failed** — different academic years |
| M7 lock key unique per transaction | **2 failed** — the real concurrency run; lock scope |
| M8 CP2 ignores the school week (D34 reverted) | **1 failed** — Saturday school |
| M9 inactive assignments count (D33) | **1 failed** — inactive assignment |
| All restored | **51 passed** |

**M2a is an equivalent mutant, stated rather than hidden.** Under correct
in-force resolution each class has exactly one timetable per term; the unique
cell `(timetable, day, slot)` allows one lesson per class per slot; and the
unique `(entry, teacher)` allows a teacher once per lesson. So every row in a
`(teacher, day, slot, term)` group comes from a different class, and `count(*)`
equals `count(DISTINCT class_arm_id)`. No test can tell them apart because no
reachable data can. The DISTINCT stays because it states the rule and remains
correct if a future change ever lets one class contribute two rows; dropping the
condition outright (M2b) is caught by 21 tests.

#### Assignment validity (D33), bell schedule, two gates

- No assignment → `TEACHER_NOT_ASSIGNED`. A First-Term-only assignment on a
  year-wide timetable → saved with a warning naming **Second Term and Third
  Term**; on a First-Term timetable → no warning; on a Second-Term timetable →
  refused. An inactive assignment, and an active assignment held by an inactive
  teacher → refused.
- Overlapping periods refused **by the service itself**. Removing a used period
  → `SLOT_IN_USE` "P3 has 2 lessons"; re-kinding a used period → refused with
  count 1; removing Monday while it has 2 lessons → `DAY_IN_USE`. Reorder and
  add keep ids; a Saturday school can timetable Saturdays.
- **Editing slot times never calls the clash query; saving a lesson calls it
  exactly once** (the query function intercepted with a spy).
- The permission guard refuses a teacher on read and manage routes; the
  service's own gate refuses a teacher on all five mutations and writes nothing;
  a deactivated owner is refused.

#### RLS and composite foreign keys (D29)

`timetable-rls.spec.ts` (real Postgres as `app_user`, 13 tests):
- RLS enabled **and forced**, one `tenant_isolation` policy, on all four tables;
- no GUC → 0 rows in each (control: the migration role sees both schools);
- each school sees only itself; a write carrying the other school's id is
  rejected with a **row-level security** error, and the control write succeeds;
- under school A's own GUC, a reference to school B's row fails on **the named
  composite constraint** for all eight: bell slot, subject, timetable (entries);
  class arm, academic year, term (timetables); teacher, entry (entry teachers) —
  each with a control referencing A's own row succeeding;
- **necessity:** in a rolled-back migration-role transaction, the bell-slot FK is
  swapped for a plain `bell_slot_id → bell_slots(id)` FK and the session drops to
  `app_user` under A's GUC. B's slot is invisible to a SELECT (0 rows), **and the
  cross-school INSERT succeeds (1 row)**. RLS alone does not protect a reference;
  the composite key does. The constraint is confirmed back in place afterwards.

#### CP2 school-week switch (D34)

`school-days.spec.ts` 13 → 18 tests and `completeness.service.spec.ts` 19 → 20;
every pre-existing case unchanged. New: `isoWeekday`; an explicit Mon–Fri week
equal to the default; a Mon–Sat week counting Saturdays (**23**); a Saturday
holiday excluded only for a Saturday school; a Mon/Wed/Fri week (**12**); and on
the real fixture a Saturday school gets **18** expected days, with the Sat 7
register moving from "non-school" to "taken". Reports specs: 40 passed.

#### Conformance

- `rbac-two-gate-conformance`: passes. **It was initially passing blind.** The
  first version asserted the owner/admin gate inside a shared `runMutation`
  helper, and the gate spec reads role assertions only from the method the
  controller calls, so it saw no gate on any timetable mutation. The assertion
  moved into each public mutation. Proven by sabotage: with the roles set to
  `["owner"]` the spec fails naming all five routes
  (`TimetableController.saveLesson -> TimetableService.saveLesson: admin holds
  timetable.manage but is rejected by [owner]`, …); restored, it passes.
- `permissions-coverage`: every handler's exact permission pinned; admin holds
  both; **teacher and bursar hold neither**.
- `audit-coverage`: bell-schedule save, create ×2, lesson save, lesson clear,
  delete — six tenant-scoped rows in order; the refused clash and the no-op
  clear write none.
- `security-definer-inventory`: passes, count unchanged at **22** (no SD
  function in CP3). `app-module-boots`: passes.
- `nav-items.spec`: Timetable live, gated on `timetable.read`, not under Coming
  soon.

#### End to end, in a real browser

`e2e/tests/timetable-builder.spec.ts`, against the compiled API and the web dev
server:
1. owner opens Settings → Bell schedule, adds Period 1 (08:00–08:40) and
   Period 2 (08:40–09:20), saves;
2. Timetable → JSS 1A → "Create whole-year timetable" → Monday Period 1 →
   Mathematics, Tunde Bello → saved;
3. JSS 1B → the same → **"Timetable clash — nothing was saved. Tunde Bello
   already teaches JSS 1A on Monday, Period 1 (First Term)."**; the database
   shows no lesson for JSS 1B;
4. in the same dialog, Period → Period 2 → saved; the grid shows it in Period 2
   with Period 1 empty; the database shows exactly A: Mon P1 and B: Mon P2, and
   2 lesson-save audit rows;
5. a teacher's API calls to the timetable → 403.

Screenshots reviewed (`test-results/timetable-builder/1–4`). The first run's
clash screenshot also showed class A's lingering "Timetable saved." toast, which
could be misread as a save; the test now waits for it to clear, and the rerun's
screenshot shows only the refusal. Unauthenticated `GET /timetable/options` →
401, against a 404 control on a non-existent route.

#### Wider regression

| Check | Result |
|---|---|
| `pnpm lint` | 9/9 tasks |
| `pnpm typecheck` | 14/14 tasks |
| API, full suite (run alone) | **148 files: 2076 passed, 3 skipped** (pre-existing env-gated specs), 0 failed |
| Web | 35 files, 339 passed |
| Mobile | 21 files, 167 passed |
| Phase 8 e2e together (event calendar, recording completeness, timetable) | 3 passed |

A first full API run, started while the web and mobile suites were also running,
was **not** a pass: Chromium timed out launching for a report-card PDF render,
the single test worker exited, and only 27 of 148 files ran. The rerun, alone,
is the figure above.

#### What the build found that the plan did not

1. **The two-gate conformance spec could not see a gate inside a helper** (above).
   Worth knowing for any future service that centralises its role assertion.
2. **A year with no terms would make a timetable unchecked.** A year-wide
   timetable is in force only in its year's terms, so with none the clash query
   has nothing to check. Creating a timetable in such a year is refused
   (`YEAR_HAS_NO_TERMS`). Residual edge, recorded rather than solved: a term
   *added later* puts year-wide timetables in force for it, which could surface
   a latent clash. The next timetable save in that year is then refused with a
   message naming the teacher, classes and term, so it is visible and
   actionable, never silent.
3. **Moving a lesson in the editor is two requests.** The new cell is saved (and
   clash-checked) first, then the old cells are cleared. If the clear fails, the
   lesson briefly appears in both places: visible and fixable, never a hidden
   clash.
4. The basePrisma lint rule caught the shared test fixture. Rather than widen
   the allowlist, the fixture deletes its school through the tenant client
   (`schools` has no RLS). Verified: 0 leftover fixture schools after the full run.
