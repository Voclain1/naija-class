# Phase 2 — attendance and grading

The phase where the school stops using Excel. End of Phase 2, a real Nigerian school can mark daily attendance for every arm, record CA1 / CA2 / Exam (and whatever other components the school configures) for every student in every subject, have the platform compute totals, letter grades, and class/subject positions, run a subject-teacher → form-teacher → principal approval workflow, and generate a per-student PDF report card that parents will eventually see. Phase 1 gave us the roster; Phase 2 makes it _academic_.

No money yet (Phase 3), no parent portal yet (Phase 4), no AI yet (Phase 5). Report-card comments are typed by hand in Phase 2 — but the comment fields are shaped so Phase 5 can drop an AI generator behind the teacher-approval gate without a migration.

**Estimated time solo with Claude Code:** 3–4 weeks (~5 weeks at observed Phase 1 velocity; budget 4). The PDF slice (5) and the aggregation slice (4) carry the schedule risk.

## Deliverables checklist

End of Phase 2, all of these are true:

- [ ] Every newly-created school is auto-seeded with one `GradingScheme` (CA1 20% / CA2 20% / Exam 60%) and the WAEC-standard `GradeBoundary` set, and can edit both.
- [ ] An admin can configure `GradingComponent`s (label, weight, order) for the school's single scheme; the write is **rejected** unless the weights sum to exactly 100.
- [ ] An admin can edit `GradeBoundary` rows (letter ↔ score range); the WAEC defaults are the starting point, not a hard-coded constant.
- [ ] A teacher can enter an `AssessmentScore` for each (student × subject × term × component) they are assigned to; a score outside `0..component.weight` is rejected with a clear message.
- [ ] On score entry the denormalized `Assessment` summary row is (re)computed: `totalScore`, `letterGrade`, and — after the aggregation pass — `classPosition` and `subjectPosition`.
- [ ] A teacher sees a **gradebook grid** for each assigned (arm, subject): one row per student, one column per component, totals and grades rendered from the API (never computed in the browser).
- [ ] A teacher can mark **daily attendance** (`PRESENT` / `ABSENT` / `LATE` / `EXCUSED`) for an assigned arm; one row per student per date; re-marking updates, never duplicates.
- [ ] A school that opts in (`School.subjectAttendanceEnabled`) can additionally mark **subject-period attendance**; schools that don't opt in never see the surface.
- [ ] A report card runs the **hybrid approval workflow**: granular per-(student × subject) subject-teacher sign-off, then batch per-(arm × term) form-teacher review → principal approval → release. The arm advances as a unit.
- [ ] At release, a per-student PDF `ReportCard` is materialized via a **BullMQ job** (Puppeteer/headless Chrome), stored on R2, with `artifactUrl` on the row. Generation never blocks the request thread.
- [ ] Comments exist at three grains — `subjectComment` (per subject), `formTeacherComment` (per student-term), `principalNote` (per arm-term) — entered as manual text, shaped AI-hook-ready for Phase 5.
- [ ] Every new table has FORCE RLS, a tenant-isolation policy with WITH CHECK, and is covered by the RLS isolation spec (all 8 tables).
- [ ] Every Phase 2 mutation writes one row to `audit_logs`. _(Slice 9: locked by the consolidated `audit-coverage.spec.ts`.)_
- [ ] All tests pass (unit, integration, RLS isolation, aggregation golden-files, PDF smoke, Phase 2 E2E rollup). CI passes on every PR.

## Acceptance bar (concrete test)

The same pilot school from Phase 1 (**250 students, 12 arms, 15 teachers, 1 academic year × 3 terms, 20 subjects**) can run a full end-of-term cycle in under one working day of staff time:

1. School was auto-seeded at signup with a default grading scheme (CA1 20 / CA2 20 / Exam 60) and the WAEC boundaries. The admin tweaks the scheme to CA1 15 / CA2 15 / Project 10 / Exam 60 — the save is accepted because the four weights sum to 100.
2. Across the term, each subject teacher opens their gradebook grid for each assigned arm and enters CA1, CA2, Project, and Exam scores. A typo of `75` into a 60-mark Exam column is rejected inline.
3. At term end, the aggregation pass computes every student's subject totals, letter grades, and positions. A subject teacher reviews their column and **signs off** each (student × subject).
4. Once every subject in JSS 1A is signed off, the form teacher reviews the arm, writes a `formTeacherComment` per student, and **submits the arm**. The principal writes a `principalNote` for the arm and **approves + releases** it.
5. Release enqueues a batch PDF job; ~30 JSS 1A report cards render and land on R2 within a couple of minutes; each `ReportCard.artifactUrl` resolves to a downloadable PDF.
6. A teacher who is **not** assigned to JSS 1A Mathematics cannot enter or sign off JSS 1A Maths scores, and cannot move JSS 1A's report cards through the workflow.

If any of those steps requires hand-editing the database, or if a grade total is computed anywhere but the API, Phase 2 is not done.

## Hard rules — Phase 2 specifics

These sit on top of the CLAUDE.md hard rules (multi-tenancy, money, auth, AI). Read them before writing any Phase 2 service.

- **Strict score validation.** An `AssessmentScore.score` MUST be an integer in `0..component.weight`. The component's weight is the score's ceiling — scores are stored in the same units as the weight (a 60%-weighted Exam is scored 0–60, already weighted). Validate at the DTO **and** re-validate in the service against the live component row. Never trust a client-supplied ceiling.
- **Weights sum to 100.** Any write to the set of `GradingComponent`s for a school is rejected unless the resulting weights total exactly 100. This is enforced atomically over the whole component set, not per-row.
- **Grades are computed server-side, full stop.** Mirrors the money rule. The frontend displays `totalScore`, `letterGrade`, and positions that the API returned. No total, grade, average, or position is ever computed in the browser or the mobile app.
- **PDF generation must not block the request.** Report-card PDF rendering goes through a BullMQ job — never a synchronous Puppeteer call inside an HTTP handler. The release endpoint enqueues and returns; the row carries `pdfStatus` for the UI to poll.
- **Teacher-approval gate before release.** No report card reaches `RELEASED` (the parent-visible state) without passing every workflow gate. There is no admin "force release" that skips sign-off — overrides are audited state transitions, not back doors.
- **No cross-tenant queries.** Every Phase 2 read/write goes through `withTenant(schoolId, …)`; teacher-scoped reads additionally filter by `getTeacherScope`. RLS is the tenancy backstop; the scope filter is in-school authorization.

## Data model

The Prisma schema extension for Phase 2. Appended to the Phase 0 + Phase 1 schema in `packages/db/prisma/schema.prisma`. Naming and column-type conventions follow CLAUDE.md; every domain table carries `schoolId`; raw-SQL column-type assumptions match CLAUDE.md (`String @id` → `TEXT`, `DateTime` → `TIMESTAMP(3)`, `DateTime @db.Date` → `DATE`, `Int` → `INTEGER`).

```prisma
// ---------- Grading configuration ----------

// Exactly one scheme per school (the @@unique on school_id enforces it). Most
// Nigerian schools run a single CA1+CA2+Exam scheme across every subject; per-
// level or per-subject schemes are explicitly deferred (see "What's deferred").
model GradingScheme {
  id        String   @id @default(uuid())
  schoolId  String   @map("school_id")
  name      String                              // "WAEC-style (default)"
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  components GradingComponent[]

  @@unique([schoolId])                          // one scheme per school
  @@map("grading_schemes")
}

// N rows per scheme. weight is an integer percent; the set of components for a
// school MUST sum to exactly 100 (validated atomically at write — see Hard rules).
model GradingComponent {
  id         String   @id @default(uuid())
  schoolId   String   @map("school_id")
  schemeId   String   @map("scheme_id")
  key        String                             // "ca1","ca2","project","exam","practical" — stable per school
  label      String                             // "First CA", "Project"
  weight     Int                                // integer percent; Σ weight per scheme = 100
  orderIndex Int      @map("order_index")       // display order, left→right in the gradebook grid
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  scheme GradingScheme    @relation(fields: [schemeId], references: [id], onDelete: Cascade)
  scores AssessmentScore[]

  @@unique([schoolId, schemeId, key])
  @@index([schoolId])
  @@map("grading_components")
}

// Per-school letter ↔ score-range map. WAEC scale pre-populated at school
// creation; fully editable. Ranges are inclusive on both ends and must tile
// 0..100 without gaps or overlaps (service-layer invariant).
model GradeBoundary {
  id         String   @id @default(uuid())
  schoolId   String   @map("school_id")
  letter     String                             // "A1","B2","B3","C4","C5","C6","D7","E8","F9"
  minScore   Int      @map("min_score")         // inclusive, 0..100
  maxScore   Int      @map("max_score")         // inclusive, 0..100
  remark     String?                            // "Excellent","Very Good",...
  orderIndex Int      @map("order_index")
  createdAt  DateTime @default(now()) @map("created_at")
  updatedAt  DateTime @updatedAt @map("updated_at")

  @@unique([schoolId, letter])
  @@index([schoolId])
  @@map("grade_boundaries")
}

// ---------- Assessment ----------

// One row per (student × subject × term × component). The raw score the teacher
// types. score ∈ [0, component.weight]. This is the source of truth; the
// Assessment summary below is derived and materialized from these rows.
model AssessmentScore {
  id          String   @id @default(uuid())
  schoolId    String   @map("school_id")
  studentId   String   @map("student_id")
  subjectId   String   @map("subject_id")
  termId      String   @map("term_id")
  componentId String   @map("component_id")
  score       Int                               // 0..component.weight (strict)
  enteredBy   String   @map("entered_by")       // users.id (plain FK; no enforced relation, mirrors ImportJob.createdBy)
  enteredAt   DateTime @default(now()) @map("entered_at")
  updatedAt   DateTime @updatedAt @map("updated_at")

  component GradingComponent @relation(fields: [componentId], references: [id], onDelete: Restrict)

  @@unique([schoolId, studentId, subjectId, termId, componentId])
  @@index([schoolId])
  @@index([schoolId, termId, subjectId])
  @@map("assessment_scores")
}

// Denormalized summary: one row per (student × subject × term). Materialized on
// score entry and on the aggregation pass — NOT live-rendered — so the gradebook
// and report card read a single row per cell instead of summing components every
// query.
//   totalScore      = Σ (AssessmentScore.score) over the scheme's components, 0..100
//   letterGrade     = resolved from GradeBoundary at compute time
//   subjectPosition = rank within (classArm, subject, term) by totalScore
//   classPosition   = the student's OVERALL position within (classArm, term),
//                     denormalized identically onto every subject row for the
//                     student×term (so a single subject row can render the footer
//                     "position in class"). Also surfaced on ReportCard.
model Assessment {
  id              String   @id @default(uuid())
  schoolId        String   @map("school_id")
  studentId       String   @map("student_id")
  subjectId       String   @map("subject_id")
  termId          String   @map("term_id")
  academicYearId  String   @map("academic_year_id")   // denormalized from term
  classArmId      String   @map("class_arm_id")        // denormalized from enrollment for position scans
  totalScore      Int      @map("total_score")         // 0..100
  letterGrade     String?  @map("letter_grade")
  remark          String?
  subjectPosition Int?     @map("subject_position")
  classPosition   Int?     @map("class_position")
  subjectComment  String?  @map("subject_comment")     // per-subject; AI-hook-ready (Phase 5), plain text
  subjectSignedOffAt DateTime? @map("subject_signed_off_at")
  subjectSignedOffBy String?   @map("subject_signed_off_by")   // users.id
  computedAt      DateTime @map("computed_at")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@unique([schoolId, studentId, subjectId, termId])
  @@index([schoolId])
  @@index([schoolId, termId, subjectId, classArmId])   // position scans
  @@index([schoolId, classArmId, termId])
  @@map("assessments")
}

// ---------- Attendance ----------

enum AttendanceStatus {
  PRESENT
  ABSENT
  LATE
  EXCUSED
}

// Daily attendance. UNIVERSAL — every school, no opt-in. One row per
// (student × date). Re-marking updates the existing row (upsert on the unique
// key), never inserts a duplicate.
model AttendanceRecord {
  id         String           @id @default(uuid())
  schoolId   String           @map("school_id")
  studentId  String           @map("student_id")
  classArmId String           @map("class_arm_id")   // arm context at marking time
  termId     String           @map("term_id")
  date       DateTime         @db.Date
  status     AttendanceStatus
  note       String?
  markedBy   String           @map("marked_by")      // users.id
  markedAt   DateTime         @default(now()) @map("marked_at")
  updatedAt  DateTime         @updatedAt @map("updated_at")

  @@unique([schoolId, studentId, date])
  @@index([schoolId])
  @@index([schoolId, classArmId, date])
  @@index([schoolId, termId])
  @@map("attendance_records")
}

// Subject-period attendance. SEPARATE table from daily — different semantics
// (period-level), different query patterns (per subject), and OPT-IN per school
// via School.subjectAttendanceEnabled. Senior classes that run a period
// timetable use it; primary classes don't. One row per
// (student × subject × date × period).
model SubjectAttendanceRecord {
  id         String           @id @default(uuid())
  schoolId   String           @map("school_id")
  studentId  String           @map("student_id")
  classArmId String           @map("class_arm_id")
  subjectId  String           @map("subject_id")
  termId     String           @map("term_id")
  date       DateTime         @db.Date
  period     Int                                       // period number within the day
  status     AttendanceStatus
  note       String?
  markedBy   String           @map("marked_by")        // users.id
  markedAt   DateTime         @default(now()) @map("marked_at")
  updatedAt  DateTime         @updatedAt @map("updated_at")

  @@unique([schoolId, studentId, subjectId, date, period])
  @@index([schoolId])
  @@index([schoolId, classArmId, subjectId, date])
  @@map("subject_attendance_records")
}

// ---------- Report card ----------

enum ReportCardStatus {
  DRAFT              // created; scores may still be changing
  SUBJECT_REVIEWED   // every subject for the arm signed off by its subject teacher
  FORM_REVIEWED      // form teacher reviewed the arm + wrote form comments
  PRINCIPAL_APPROVED // principal approved the arm
  RELEASED           // parent-visible; PDF materialized
}

enum ReportCardPdfStatus {
  PENDING            // not yet enqueued / awaiting release
  GENERATING         // BullMQ job running Puppeteer
  GENERATED          // artifactUrl populated
  FAILED             // render failed; retryable
}

// Materialized artifact, NOT live-rendered. One row per (student × term). Carries
// the term's overall rollup, the three free-text comment grains, the workflow
// state, and the R2 pointer to the rendered PDF. The arm-level workflow advances
// every ReportCard in (classArm, term) together; principalNote is per-arm-term,
// denormalized identically onto each card in the arm.
//
// overallAverage is stored as an integer in hundredths (e.g. 7350 = 73.50%) to
// avoid Float — same discipline as the money rule, applied to averages.
model ReportCard {
  id             String              @id @default(uuid())
  schoolId       String              @map("school_id")
  studentId      String              @map("student_id")
  termId         String              @map("term_id")
  academicYearId String              @map("academic_year_id")
  classArmId     String              @map("class_arm_id")
  status         ReportCardStatus    @default(DRAFT)
  overallTotal   Int?                @map("overall_total")     // Σ subject totals
  overallAverage Int?                @map("overall_average")   // avg × 100 (hundredths), no Float
  overallPosition Int?               @map("overall_position")  // student's position in the arm for the term
  subjectsCount  Int?                @map("subjects_count")
  formTeacherComment String?         @map("form_teacher_comment")   // per student-term; AI-hook-ready
  principalNote      String?         @map("principal_note")         // per arm-term; AI-hook-ready
  formReviewedAt DateTime?           @map("form_reviewed_at")
  formReviewedBy String?             @map("form_reviewed_by")        // users.id
  principalApprovedAt DateTime?      @map("principal_approved_at")
  principalApprovedBy String?        @map("principal_approved_by")   // users.id
  releasedAt     DateTime?           @map("released_at")
  pdfStatus      ReportCardPdfStatus @default(PENDING) @map("pdf_status")
  artifactUrl    String?             @map("artifact_url")            // R2: schools/<id>/report-cards/<term>/<student>.pdf
  generatedAt    DateTime?           @map("generated_at")
  createdAt      DateTime            @default(now()) @map("created_at")
  updatedAt      DateTime            @updatedAt @map("updated_at")

  @@unique([schoolId, studentId, termId])
  @@index([schoolId])
  @@index([schoolId, classArmId, termId, status])
  @@map("report_cards")
}
```

Additions to existing models:

```prisma
// School — one new column (Phase 0 table). Added in slice 8 alongside the
// SubjectAttendanceRecord table. Defaults false: subject-period attendance is
// strictly opt-in.
model School {
  // ... existing fields unchanged ...
  subjectAttendanceEnabled Boolean @default(false) @map("subject_attendance_enabled")
}

// Back-relations only (no column changes) on Phase 1 tables:
//   Student  → assessments, assessmentScores (none — AssessmentScore has no enforced student relation),
//              attendanceRecords, subjectAttendanceRecords, reportCards
//   Subject  → (assessments / scores reference subjectId as plain FK, no enforced relation)
//   Term, ClassArm, AcademicYear → referenced by denormalized columns (plain FK, no enforced relation)
```

**Plain-FK convention (deliberate).** `enteredBy`, `markedBy`, `subjectSignedOffBy`, `formReviewedBy`, `principalApprovedBy`, and the `studentId`/`subjectId`/`termId`/`classArmId` columns on the assessment + attendance tables are stored as plain `String` columns referencing `users.id` / the relevant Phase-1 table, **without** Prisma enforced relations — the same choice Phase 1 made for `ImportJob.createdBy` and audit `createdBy`. Reason: these are high-volume, append-mostly rows; enforced relations would add foreign-key churn and relation-include temptation without buying integrity that RLS + the service layer don't already guarantee. The one place an enforced relation earns its keep is `AssessmentScore.component → GradingComponent` (we need the live `weight` to validate the score), so that one is enforced with `onDelete: Restrict`.

No new columns are added to `users`, `roles`, `invitations`, `audit_logs`, `sessions`, or `branches`. The only existing-table change is `schools.subject_attendance_enabled`.

## RLS policies

New table list (8): `grading_schemes`, `grading_components`, `grade_boundaries`, `assessment_scores`, `assessments`, `attendance_records`, `subject_attendance_records`, `report_cards`.

Every Phase 2 table is tenant-scoped, carries its own `school_id`, and gets ENABLE + FORCE RLS with a flat `tenant_isolation` policy (USING + WITH CHECK on `school_id`). No EXISTS-through-parent policies are needed — every table carries `school_id` directly (the same belt-and-braces choice Phase 1 made for `student_guardians` / `mastery_records`). Lives in `packages/db/prisma/policies/phase-2.sql`:

```sql
-- Phase 2 RLS policies. Same discipline as phase-0.sql / phase-1.sql:
--   1. ENABLE + FORCE so the table owner (school_kit migration role) cannot
--      bypass policies; the runtime app_user has neither SUPERUSER nor BYPASSRLS.
--   2. WITH CHECK on every policy so a buggy controller cannot INSERT a row
--      carrying another school's school_id.
--   3. Flat school_id check on every table — all eight carry school_id directly.

ALTER TABLE grading_schemes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_schemes            FORCE  ROW LEVEL SECURITY;
ALTER TABLE grading_components         ENABLE ROW LEVEL SECURITY;
ALTER TABLE grading_components         FORCE  ROW LEVEL SECURITY;
ALTER TABLE grade_boundaries           ENABLE ROW LEVEL SECURITY;
ALTER TABLE grade_boundaries           FORCE  ROW LEVEL SECURITY;
ALTER TABLE assessment_scores          ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_scores          FORCE  ROW LEVEL SECURITY;
ALTER TABLE assessments                ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessments                FORCE  ROW LEVEL SECURITY;
ALTER TABLE attendance_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_records         FORCE  ROW LEVEL SECURITY;
ALTER TABLE subject_attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE subject_attendance_records FORCE  ROW LEVEL SECURITY;
ALTER TABLE report_cards               ENABLE ROW LEVEL SECURITY;
ALTER TABLE report_cards               FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON grading_schemes
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON grading_components
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON grade_boundaries
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON assessment_scores
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON assessments
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON attendance_records
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON subject_attendance_records
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON report_cards
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
```

**RLS isolation test must be extended** (`apps/api/src/__tests__/rls.spec.ts`) to cover every new table:
- For each table: as School A, insert 1 row; switch session to School B; assert `count(*)` returns 0 from School B's view; assert INSERT with School A's `school_id` fails the WITH CHECK; assert findUnique on School A's id returns null under School B; assert an unset GUC returns zero rows.
- After Phase 2, `rls.spec.ts` covers **23 tables** (15 from Phase 1 + 8 new).

## SECURITY DEFINER functions

**Phase 2 adds zero new SECURITY DEFINER functions.** Every Phase 2 endpoint is post-authentication and post-tenant: by the time a handler runs we have a session-resolved `schoolId` and use `withTenant` for all DB access.

Specifically:
- **Grading-scheme + grade-boundary seeding** happens inside the existing signup transaction *after* the school is created — the same site and the same `tx` handle as the Phase 1 ClassLevel seed. The GUC `app.current_school_id` is already set inside that tx (`set_config(..., true)`), so the RLS WITH CHECK is satisfied directly. **Do not wrap the seed in `withTenant`** (nested `$transaction` deadlocks — see the Phase 1 note on ClassLevel seeding).
- **Score entry, attendance marking, aggregation, the approval workflow, and PDF generation** all run under `withTenant` against an authenticated session.
- **Teacher-scope filters** (a teacher entering scores / marking attendance for their assigned arm+subject) are application-level joins through `teacher_assignments`, already tenant-scoped via RLS — exactly the Phase 1 `getTeacherScope` helper, reused verbatim.

**SECURITY DEFINER count after Phase 2: still 4.** Under the refactor trigger of 5 (CLAUDE.md / `docs/deferred.md`). The CLAUDE.md inventory table does **not** change in Phase 2. If implementation discovers a need for pre-tenant access (it shouldn't), that addition pushes the count to 5 and triggers the consolidation refactor — **flag immediately if this happens.**

## Tenant client

No change. Phase 2 uses `withTenant` from `packages/db/src/tenant-client.ts` verbatim, plus the Phase 1 `getTeacherScope` helper for teacher-scoped score entry and attendance marking. The position-aggregation pass and the report-card batch transition both run inside a single `withTenant` transaction per arm-term.

## API endpoints

All under `/api/v1`. Auth required for every endpoint. Validation via Zod DTOs in `packages/types/src/<module>/`. Response shape conventions are identical to Phase 0/1 (`{ data }`, `{ data, meta }`, `{ error }`).

### Grading scheme + components

```
GET    /grading-scheme                          — the school's single scheme + its components
PATCH  /grading-scheme                           — rename / toggle isActive
GET    /grading-scheme/components
POST   /grading-scheme/components                 — body: { key, label, weight, orderIndex }
PATCH  /grading-scheme/components/:id             — edit label/weight/order
DELETE /grading-scheme/components/:id
PUT    /grading-scheme/components                 — bulk replace the whole component set (atomic; rejects unless Σ weight = 100)
```

The `PUT` bulk endpoint is the settings UI's save path — it is the only safe way to edit weights, because the sum-to-100 invariant is over the whole set. Single `POST`/`PATCH`/`DELETE` also re-validate the resulting set and reject if it breaks the invariant.

### Grade boundaries

```
GET    /grade-boundaries                          — sorted by orderIndex (A1 → F9)
PUT    /grade-boundaries                           — bulk replace; rejects unless ranges tile 0..100 with no gaps/overlaps
PATCH  /grade-boundaries/:id                        — edit one band (re-validates the full set)
```

### Assessment scores + summaries

```
GET    /assessments?termId=&classArmId=&subjectId=        — gradebook grid feed: summaries + per-component scores
POST   /assessment-scores                                  — body: { studentId, subjectId, termId, componentId, score }
PATCH  /assessment-scores/:id                               — correct a score
POST   /assessment-scores/bulk                              — body: { termId, subjectId, rows: [{ studentId, componentId, score }] } (one grid save)
POST   /assessments/:id/sign-off                            — subject teacher signs off (student × subject)
POST   /assessments/sign-off/bulk                           — body: { termId, subjectId, classArmId } — sign off a whole column
GET    /assessments/:id                                     — single summary with component breakdown
```

Score writes trigger a synchronous recompute of the affected `Assessment` row's `totalScore` + `letterGrade`. Positions are **not** recomputed on every keystroke — see the aggregation endpoint.

### Aggregation (positions)

```
POST   /assessments/aggregate                              — body: { termId, classArmId, subjectId? } — recompute positions for an arm-term (and/or one subject)
GET    /assessments/aggregate/status?termId=&classArmId=   — last-computed timestamps
```

Aggregation is an explicit pass (admin/form-teacher triggered at term end, or auto-triggered on bulk save) rather than a per-write side effect, because a position depends on every other student's total — recomputing on every keystroke would be O(n²) churn. See slice 4.

### Attendance (daily, universal)

```
GET    /attendance?classArmId=&date=                       — register for one arm on one day
GET    /attendance?classArmId=&termId=&studentId=          — history (per student / per arm / per term)
POST   /attendance/mark                                     — body: { classArmId, date, records: [{ studentId, status, note? }] } — upsert the day's register
GET    /attendance/summary?classArmId=&termId=             — per-student present/absent/late/excused counts for the term
```

### Subject-period attendance (opt-in)

All of these `404` (feature-disabled) when `School.subjectAttendanceEnabled` is false.

```
GET    /subject-attendance?classArmId=&subjectId=&date=&period=
POST   /subject-attendance/mark                            — body: { classArmId, subjectId, date, period, records: [{ studentId, status, note? }] }
GET    /subject-attendance/summary?subjectId=&termId=
```

### Report cards + approval workflow

```
GET    /report-cards?termId=&classArmId=&status=           — arm roster of cards with workflow state
GET    /report-cards/:id                                    — one card: rollup + comments + per-subject assessments
PATCH  /report-cards/:id                                    — edit formTeacherComment (form teacher) / principalNote (principal); state-gated
POST   /report-cards/arm/build                              — body: { termId, classArmId } — materialize DRAFT cards for an arm from its assessments
POST   /report-cards/arm/form-review                        — body: { termId, classArmId } — form teacher submits the arm (DRAFT/SUBJECT_REVIEWED → FORM_REVIEWED)
POST   /report-cards/arm/approve                            — body: { termId, classArmId } — principal approves (FORM_REVIEWED → PRINCIPAL_APPROVED)
POST   /report-cards/arm/release                            — body: { termId, classArmId } — release + enqueue batch PDF (PRINCIPAL_APPROVED → RELEASED)
POST   /report-cards/arm/reopen                             — body: { termId, classArmId, reason } — audited rollback to DRAFT (owner/principal only)
GET    /report-cards/:id/pdf                                — signed R2 URL (TTL) once pdfStatus = GENERATED
```

Workflow transitions are arm-batch operations: every `ReportCard` in `(classArm, term)` moves together inside one `withTenant` transaction. The endpoints reject out-of-order transitions (e.g. `release` on an arm that isn't `PRINCIPAL_APPROVED`) with a `409`.

## Report card + PDF design

The single most operationally-risky Phase 2 feature. A school's whole term of work funnels through this; if it's slow, fragile, or leaks PII, the school loses trust at the worst possible moment (report-card day). This section defines the materialization and approval lifecycle.

### Why materialized, not live-rendered

A report card is a **point-in-time artifact**. Once a school releases JSS 1A's Term-1 cards, those PDFs are the record — they must not silently change if a teacher later edits a score or the grading scheme. So the card is built (DRAFT rows materialized from the current `Assessment` rows), frozen through the workflow, and rendered to an immutable PDF at release. Re-rendering only happens via an audited `reopen`.

### Approval lifecycle

```
            sign off every             form teacher           principal            principal
            subject in arm             submits arm            approves arm         releases arm
  ┌────────┐    ───────▶    ┌──────────────────┐  ───────▶  ┌──────────────┐  ──▶  ┌────────────────────┐  ──▶  ┌──────────┐
  │ DRAFT  │                │ SUBJECT_REVIEWED │            │ FORM_REVIEWED │       │ PRINCIPAL_APPROVED │       │ RELEASED │
  └────────┘                └──────────────────┘            └──────────────┘       └────────────────────┘       └──────────┘
       ▲                                                                                                              │
       └──────────────────────────────── reopen (audited; owner/principal; reason required) ◀───────────────────────┘
```

Two granularities, deliberately:
- **Granular sign-off** is per (student × subject) — it lives on the `Assessment` row (`subjectSignedOffAt` / `subjectSignedOffBy`). A subject teacher signs off their column; this is the data-quality gate ("these marks are final and mine").
- **Batch transition** is per (arm × term) — the whole arm's `ReportCard` rows advance together. The arm reaches `SUBJECT_REVIEWED` only when *every* subject taught in the arm is signed off for every enrolled student. Form review, approval, and release are arm-level acts by one person each (form teacher, then principal).

> **Recommended shape (Claude Code, draft):** keep subject sign-off as two columns on `Assessment` (not a separate `SubjectSignoff` table) — it's exactly the right grain, it keeps Phase 2 at the locked 8 tables, and it avoids a join on every gradebook read. Keep the three comment grains as plain text columns (`Assessment.subjectComment`, `ReportCard.formTeacherComment`, `ReportCard.principalNote`) with **no** AI-specific columns — Phase 5 attaches a generator behind the existing teacher-approval gate without touching the schema. `principalNote` is per-arm-term, written once and denormalized identically onto each card in the arm.

### PDF rendering (BullMQ + Puppeteer)

1. `release` flips every card in the arm to `RELEASED`, sets `pdfStatus = PENDING`, and enqueues one `report-cards:render` BullMQ job per card (or one batch job that fans out per card — implementation choice; per-card jobs give cleaner retry isolation, mirroring the Phase 1 per-row import decision).
2. The render worker (`apps/api/src/modules/report-cards/workers/render.processor.ts`): loads the card + its assessments under `withTenant`, flips `pdfStatus = GENERATING`, renders an HTML template (school header, student bio, per-subject grid, comments, positions) to PDF via a **shared, pooled** headless-Chrome instance, uploads to R2 at `schools/<id>/report-cards/<termId>/<studentId>.pdf`, sets `artifactUrl` + `generatedAt` + `pdfStatus = GENERATED`.
3. On render failure: `pdfStatus = FAILED`; the job is retryable; the UI surfaces a "Regenerate" action. A failed PDF does **not** roll back the `RELEASED` workflow state — release is the academic decision, the PDF is an artifact of it.
4. **No student PII leaves the box.** The PDF is rendered in-process and stored on R2 under a tenant-scoped path; the LLM is not involved in Phase 2 at all. (When Phase 5 adds AI comments, the CLAUDE.md AI rule applies — opaque IDs + class-level context only.)

### Memory discipline (the headline risk)

Puppeteer/headless Chrome is memory-hungry, and the API's deploy target (fly.io) runs on a tight memory budget. The spec mandates:
- **One pooled browser**, not one-browser-per-render. Launch a single Chrome at worker boot, reuse across jobs, recycle every N pages to bound leak growth.
- **Concurrency cap of 1–2** render jobs at a time on the BullMQ queue, independent of the API's HTTP concurrency.
- **Hard page timeout** so a wedged render can't pin a tab forever.
- Consider a dedicated worker process / machine for rendering so a render OOM can't take down HTTP serving. **Tracked as a slice-5 acceptance gate** — if the pooled single-browser approach blows the memory budget under a 40-card arm batch, fall back to an external render service (deferred, `docs/deferred.md`).

#### Slice-5 cp2 implementation notes (what actually shipped)

The render worker runs **in-process** in the API (module-structured: `apps/api/src/modules/report-cards/render/` — `browser-pool.ts`, `render.service.ts`, `render.processor.ts`, `report-card-template.ts`, `report-card-render.module.ts`). Decisions vs the spec above:

- **One pooled browser, `BrowserPool`** — lazy single `puppeteer.launch`, reused across jobs, recycled (full browser teardown + relaunch) every `PAGE_RECYCLE_LIMIT = 20` pages to bound renderer leak growth. A page failure tears the browser down (distrust + cold relaunch); a Chromium `disconnected` event drops the handle so the next job relaunches.
- **Concurrency 1** on `REPORT_CARDS_QUEUE` (`@Processor(REPORT_CARDS_QUEUE, { concurrency: 1 })`) — the load-bearing memory knob. Do **not** raise without re-running the memory gate.
- **Hard page timeout** `PAGE_HARD_TIMEOUT_MS = 30_000` — `withPage()` races the render against a timer and kills the page (+ browser) on overrun.
- **Chromium launch flags:** `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage --disable-gpu`. We deliberately **dropped `--single-process` / `--no-zygote`**: they shave a little RSS but make `page.pdf()` crash the renderer with an empty-message protocol error (confirmed on Windows dev; a known cross-platform PDF-printing footgun). Page-recycle + concurrency-1 bound memory without them.
- **Template is a hand-rolled typed function** (`renderReportCardHtml`), not React/JSX. Every user-controlled field passes through `esc()` (the single XSS boundary); a unit test feeds a `<script>` payload through every field and asserts it comes out inert.
- **Deterministic storage path** `schools/<schoolId>/report-cards/<termId>/<studentId>.pdf` (via `StorageObjectKey` `{ kind: "report-card" }` + `pathFor`). Re-render overwrites in place — idempotent across BullMQ retries, no orphaned blobs. `artifactUrl` stores the path; `getPdfUrl` mints a short-lived (1h) signed URL on demand.
- **PII boundary:** the worker runs in-process under `withTenant`; the only outbound write is the PDF to our own tenant-scoped storage. No student PII leaves the box; no LLM is involved.

#### Deployment — Chromium provisioning (documented, NOT deploy-validated)

The 40-card memory gate was measured in **dev on Windows** (see the slice-5 cp2 journal entry). It has **not** been validated inside a fly.io Linux container. Before the first deploy that exercises PDF render, the API container image must:

1. **Provide a Chromium binary + its system libraries.** `puppeteer` (not `puppeteer-core`) downloads its own Chromium at `pnpm install`, but the headless binary still needs OS shared libs that aren't in a slim Node base image: `libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 libcairo2 fonts-liberation` (Debian/Ubuntu names). Without them Chromium fails to launch with a missing-`.so` error.
2. **Ship a font for Naija names + the WAEC grid** — `fonts-liberation` (or a bundled TTF) so the PDF isn't tofu boxes.
3. **Decide binary source.** Either let `puppeteer` cache Chromium into the image at build (set `PUPPETEER_CACHE_DIR` and copy it into the runtime stage of a multi-stage build), or install the distro `chromium` package and point `puppeteer.launch({ executablePath })` at it. The former matches dev; the latter is smaller.
4. **`/dev/shm` size.** `--disable-dev-shm-usage` is already set (forces Chromium onto `/tmp`), so the container's default 64MB `/dev/shm` is not a blocker — but if that flag is ever removed, mount a larger `/dev/shm`.

There is no `apps/api/Dockerfile` yet (Phase 3 / pre-deploy work). When it lands, the steps above are its acceptance checklist, and the memory gate must be **re-measured in-container** against the fly.io machine size (512MB / 1GB) before PDF render is enabled in prod.

## UI screens — web (Next.js)

New screens under `apps/web/src/app/(admin)/` (admin/principal), `apps/web/src/app/(teacher)/` (teacher). Route-group rules from CLAUDE.md apply.

### Settings → grading (admin)

- `/settings/grading` — the scheme editor: component rows (label, weight, order), a live "weights total: 100 ✓ / 92 ✗" indicator, save disabled until the sum is exactly 100. Save calls `PUT /grading-scheme/components`.
- `/settings/grading/boundaries` — the grade-boundary table (letter, min, max, remark), WAEC defaults pre-filled, with a "ranges tile 0–100 ✓" validity indicator.
- `/settings/attendance` — the `subjectAttendanceEnabled` toggle (slice 8) with a one-line explainer of what opting in turns on.

### Gradebook (teacher)

- `/teacher/gradebook` — picker: pick term → assigned arm → assigned subject.
- `/teacher/gradebook/[armId]/[subjectId]` — the grid: rows = enrolled students, columns = grading components + computed Total + Grade + Position. Inline cell edit with `0..weight` validation; a per-cell error chip on out-of-range. "Save" calls the bulk endpoint and re-renders totals/grades from the API response. A "Sign off column" action (enabled once every cell is filled) calls the bulk sign-off endpoint and locks the column.

### Attendance (teacher)

- `/teacher/attendance` — pick assigned arm + date (defaults today). A tap-through register: each student row toggles PRESENT / ABSENT / LATE / EXCUSED; "Save register" upserts the day. Re-opening a saved day rehydrates the marks.
- `/teacher/attendance/subject` — only rendered when the school opted in: adds subject + period selectors above the same register.
- `/teacher/attendance/summary` — per-arm term summary (counts + %).

### Report cards (admin / form teacher / principal)

- `/report-cards` — pick term + arm → workflow board for the arm: current `status`, a checklist of subjects signed-off vs outstanding, and the stage-appropriate action button (Build / Form review / Approve / Release / Reopen) gated by the viewer's role and the arm's state.
- `/report-cards/[armId]/[studentId]` — single card preview: bio, per-subject grid, comments (editable in the right stage), positions, and — once `pdfStatus = GENERATED` — a "Download PDF" button.
- During release, the board polls `pdfStatus` and shows per-card progress (PENDING → GENERATING → GENERATED / FAILED) with a "Regenerate" action on failures.

### Owner / admin dashboard updates

`/dashboard` gains an academic widget: current term's attendance rate, count of arms with report cards in each workflow state, and a "term-end checklist" (scores entered → signed off → released).

## UI screens — mobile (Expo)

No parent/student mobile features in Phase 2 (parent app unblocks in Phase 4 when guardians get auth). The locked decision keeps the teacher surfaces **web-only** for Phase 2, consistent with Phase 1 — Nigerian teachers do register/gradebook work on laptops or shared admin tablets via the web app. Mobile-first attendance marking (ARCHITECTURE §6.6) is therefore a Phase-4 mobile concern, not a Phase-2 one. The mobile login screen does not need to handle teacher attendance/grading.

## RBAC implementation

### New permission strings

Appended to `packages/types/src/permissions.ts`:

```typescript
export const PHASE_2_PERMISSIONS = [
  // Grading configuration
  'grading-scheme.read', 'grading-scheme.update',
  'grading-component.read', 'grading-component.create', 'grading-component.update', 'grading-component.delete',
  'grade-boundary.read', 'grade-boundary.update',

  // Assessment
  'assessment.read',                       // summaries / gradebook
  'assessment-score.read', 'assessment-score.create', 'assessment-score.update',   // teacher, scoped to assigned arm+subject
  'assessment.sign-off',                   // subject teacher signs off own column
  'assessment.aggregate',                  // run the position pass

  // Attendance
  'attendance.read', 'attendance.mark',                        // daily, teacher-scoped
  'subject-attendance.read', 'subject-attendance.mark',        // opt-in

  // Report cards
  'report-card.read',
  'report-card.build',
  'report-card.form-review',               // form teacher
  'report-card.principal-approve',         // principal / owner
  'report-card.release',
  'report-card.reopen',                    // owner / principal only
  'report-card.comment',                   // edit form/subject/principal comments (stage-gated)
] as const;

export const ALL_PERMISSIONS = [
  ...PHASE_0_PERMISSIONS,
  ...PHASE_1_PERMISSIONS,
  ...PHASE_2_PERMISSIONS,
  /* extend per phase */
] as const;
```

### Updated seeded roles

The Phase 1 seed grows; existing schools get a one-shot data migration to apply the new permissions to existing role rows (idempotent UPDATE on the global system-role singletons, exactly like the Phase 1 slice-13 RBAC rollup).

| Role key | Phase 2 additions |
|---|---|
| `owner` | `["*"]` (unchanged) |
| `admin` | all Phase 2 config + read + workflow **except** `report-card.reopen` (owner/principal-only). Admin can build/release on the school's behalf but cannot silently rewrite a released card. |
| `teacher` | `assessment-score.*` (scoped to assigned arm+subject), `assessment.sign-off` (own subjects), `assessment.read`, `attendance.mark` + `attendance.read` (assigned arms), `subject-attendance.*` (assigned arms, when enabled), `report-card.read` (own arms). A teacher who is **also a form teacher** of an arm additionally gets `report-card.form-review` + `report-card.comment` for that arm via the scope filter. |
| `principal` | **New optional role (deferred decision).** Phase 2 maps `report-card.principal-approve` + `report-card.reopen` to `owner` + `admin` by default; schools that want a distinct principal who is not a full admin get a seeded `principal` role. Seeding a dedicated `principal` role is deferred to the first pilot that asks (see "What's deferred"). |
| `student` / `parent` / `bursar` | unchanged (TBD Phases 6 / 4 / 3) |

### Service-layer scope filter (teacher scope)

Reuses the Phase 1 `getTeacherScope(db, teacherId, academicYearId?)` helper verbatim. Every teacher-callable Phase 2 endpoint applies it:
- **Score entry / sign-off:** the (arm, subject) pair must be in the teacher's `subjectIdsByArm`. Otherwise `404`.
- **Attendance marking:** the arm must be in `classArmIds` (subject teacher *or* class teacher of the arm).
- **Form review:** the teacher must be the **class teacher** of the arm (`ClassArm.classTeacherId`), a stricter check than subject assignment.

**Critical (carried from Phase 1):** RLS isolates by school; the teacher-scope check is in-school authorization. A bug here leaks within-school, not across-school — treat every teacher-hittable endpoint as a security-review surface, and the slice-9 E2E rollup must include "teacher tries to score another teacher's subject" assertions.

## Audit interceptor

No change to the interceptor. New actions follow the Phase-0 convention `<singular-resource>.<verb>` (the code uses the singular form; the hyphenated-plural prose elsewhere is casual — do not "fix" the code to match prose):

- `grading-scheme.update`, `grading-component.create`, `grading-component.update`, `grading-component.delete`
- `grade-boundary.update`
- `assessment-score.create`, `assessment-score.update`
- `assessment.sign-off`, `assessment.aggregate`
- `attendance.mark`
- `subject-attendance.mark`
- `report-card.build`, `report-card.form-review`, `report-card.principal-approve`, `report-card.release`, `report-card.reopen`, `report-card.comment`

Bulk operations write **one** audit row with counts in metadata, not one-per-cell:
- A gradebook grid save (`assessment-score.create`/`update` bulk) → one `assessment-score.create` row with `{ termId, subjectId, classArmId, count }`.
- An attendance register save (`attendance.mark` for a day) → one `attendance.mark` row with `{ classArmId, date, count }`.
- An arm workflow transition → one row per transition with `{ termId, classArmId, fromStatus, toStatus, cardCount }`.

Rationale matches Phase 1's import-commit decision: per-cell audit would dominate the table; the `AssessmentScore` / `AttendanceRecord` rows already carry `enteredBy`/`markedBy` per row for fine-grained provenance.

**Audit writes stay synchronous in Phase 2**, as in Phases 0–1. The BullMQ audit-queue migration remains deferred (`docs/deferred.md`) — a dedicated future slice, not a rider on this feature phase.

## Acceptance criteria

End of Phase 2 these must all pass:

1. **Default grading seed.** A new school signup auto-seeds exactly one `GradingScheme` with components CA1=20, CA2=20, Exam=60 (Σ=100) and the nine WAEC `GradeBoundary` rows. Verified by an integration test that signs up a fresh school and asserts on `grading_components` + `grade_boundaries`.
2. **WAEC boundaries exact + editable.** The seeded boundaries are A1=75–100, B2=70–74, B3=65–69, C4=60–64, C5=55–59, C6=50–54, D7=45–49, E8=40–44, F9=0–39. An admin can edit any band; a save that leaves a gap or overlap in 0–100 is rejected.
3. **Weights sum to 100.** Editing components to a set whose weights don't total 100 is rejected with a clear error; a valid set (e.g. 15/15/10/60) is accepted. Verified by service unit tests over the bulk endpoint.
4. **Strict score validation.** Entering an `AssessmentScore` outside `0..component.weight` (e.g. 75 into a 60-weight Exam) is rejected; a valid score is stored. Verified at DTO and service layers.
5. **Summary materialization.** On score entry the `Assessment` row's `totalScore` = Σ component scores and `letterGrade` resolves from the school's boundaries. Verified by an integration test that enters all components and asserts the computed total + grade.
6. **Aggregation + positions (test-first).** The aggregation pass computes `subjectPosition` (rank within arm/subject) and `classPosition` (overall rank within arm), with deterministic tie handling (equal totals share a position; the next rank skips). Verified by golden-file unit tests written **before** the implementation.
7. **Gradebook grid.** A teacher opens an assigned (arm, subject), sees one row per enrolled student and one column per component, enters scores, saves, and sees totals/grades/positions rendered from the API. No total or grade is computed in the browser.
8. **Daily attendance.** A teacher marks an assigned arm's register for a date; one row per student per date; re-marking the same date updates rows (no duplicates); `markedBy`/`markedAt` recorded. Verified by integration test including the re-mark idempotency case.
9. **Subject attendance is opt-in.** With `subjectAttendanceEnabled=false`, the subject-attendance endpoints `404` and the UI hides the surface. After an admin toggles it on, marking works against the separate table. Verified by integration test in both states.
10. **Hybrid approval workflow.** Subject teachers sign off per (student × subject); an arm reaches `SUBJECT_REVIEWED` only when all its subjects are signed off; the form teacher submits the arm (`FORM_REVIEWED`); the principal approves (`PRINCIPAL_APPROVED`) and releases (`RELEASED`). Out-of-order transitions `409`. The whole arm advances together. Verified by an integration test walking the full state machine.
11. **Comments at three grains, AI-hook-ready.** `subjectComment` (per subject), `formTeacherComment` (per student-term), and `principalNote` (per arm-term) are editable manual text in their respective stages, stored as plain columns with no AI-specific schema. Verified by integration test.
12. **PDF materialization off the request thread.** Releasing an arm enqueues a BullMQ render job per card; PDFs land on R2; each `ReportCard.artifactUrl` resolves; `pdfStatus` transitions PENDING → GENERATING → GENERATED. The release HTTP call returns before any PDF renders. Verified by a render smoke test (job enqueued → worker produces a PDF → R2 object exists) and an assertion that the handler does not call Puppeteer synchronously.
13. **Released cards are immutable except via reopen.** A `RELEASED` card cannot be edited; `reopen` (owner/principal only, reason required) rolls the arm to `DRAFT` and writes an audit row. Verified by integration test.
14. **RLS isolation across all 8 new tables.** Two schools cannot see each other's grading config, scores, assessments, attendance, subject-attendance, or report cards. Verified by the extended `rls.spec.ts` (23 tables total). SECURITY DEFINER count remains 4; CLAUDE.md inventory unchanged.
15. **Audit + CI.** Every Phase 2 mutation writes its expected synchronous audit row (locked by `audit-coverage.spec.ts`); CI passes lint, typecheck, unit, integration, RLS isolation, and the Phase 2 E2E rollup on every PR.

## Slice breakdown

Sequenced per the locked build order (grading config → scores → gradebook → aggregation → report cards → workflow → attendance → opt-in attendance → close). Each slice ships independently and is testable on its own. `cps` = checkpoint count (the per-PR working units inside a slice, Phase-1 cadence); size in days assumes observed Phase-1 velocity.

| # | Slice | Why it ships independently | cps | Size |
|---|---|---|---|---|
| 1 | **GradingScheme + GradingComponent + GradeBoundary** — three models, migration, RLS, seed-on-signup, settings UI (scheme editor + boundary table), sum-to-100 + tile-0–100 validation | The whole grading skeleton hangs off this. Demo: sign up a fresh school, see the default CA1/CA2/Exam scheme + WAEC bands, edit them. | 2 | 2 days |
| 2 | **Assessment + AssessmentScore + score-entry API** — two models, migration, RLS, strict `0..weight` validation, summary materialization (total + grade), teacher-scoped write | Marks can be entered and a total/grade computed for one student in one subject. Shippable as "marks entry" before the grid UI exists. | 3 | 3 days |
| 3 | **Gradebook grid UI** — the teacher grid, bulk save, inline validation, live totals/grades from API | Teachers get the real entry surface. Pure web slice on top of slice 2's API. | 2 | 2 days |
| 4 | **Aggregation + positions (test-first)** — the position pass, deterministic ties, aggregate endpoint, gradebook "Position" column | The most testable correctness property of Phase 2; written test-first. Isolated so a bug here can't be blamed on entry/UI. | 2 | 2 days |
| 5 | **Report card materialization + Puppeteer PDF** — `ReportCard` model, migration, RLS, build-from-assessments, BullMQ render worker, pooled headless Chrome, R2 storage, pdfStatus polling | First half of report cards: a DRAFT card can be built and rendered to a PDF on R2. The memory-budget gate lives here. | 3–4 | 4 days |
| 6 | **Report card approval workflow** — subject sign-off (on Assessment), arm-batch state machine, form/principal comments, release, reopen, workflow board UI | Completes report cards. Acceptance criteria 10/11/13 pass after this. | 3 | 3 days |
| 7 | **Daily attendance (universal)** — `AttendanceRecord` model, migration, RLS, upsert-the-day API, teacher register UI, term summary | Closes the attendance loop for every school. Independent of grading entirely. | 2 | 2 days |
| 8 | **Subject-period attendance (opt-in)** — `SubjectAttendanceRecord` model + `School.subjectAttendanceEnabled` column, migration, RLS, gated API + UI | Opt-in senior-class feature; ships behind a flag so it can't regress schools that don't use it. | 2 | 2 days |
| 9 | **Phase 2 close — RBAC + audit + RLS + Scope B E2E** — consolidate `PHASE_2_PERMISSIONS` into the seed + `PermissionsGuard`; admin/principal role updates + idempotent data migration; verify every Phase 2 mutation audits; extend `rls.spec.ts` to all 8 tables; the E2E rollup (below) | Phase 2 closes here. All deliverables green. | 3 | 3 days |

Total: **23 days** raw, ~5 calendar weeks at observed pace. Buffer: 1 week. **Phase 2 target: 6 weeks elapsed, ~25 working days.**

### Slice 9 — Scope B E2E rollup (detail)

The slice-9 E2E set has three tiers (modelled on the Phase 1 slice-13 rollup, and explicitly designed to catch the slice-4 "form-class" form bug pattern categorically):

- **Critical-path acceptance E2Es:** teacher gradebook entry (enter a column, save, totals appear); teacher daily attendance marking; form-teacher arm submission; principal release; PDF generation smoke (release → job → R2 object → downloadable URL).
- **Form-coverage E2Es:** every new Phase 2 form (scheme editor, boundary editor, gradebook grid, attendance register, comment fields) gets a "fill required-only fields → submit → row/state appears" test. This is the categorical guard against the slice-4 bug class where a blank optional field silently blocked submit.
- **Cross-tenant isolation walks:** for each of the 8 new tables, a School-A-cannot-touch-School-B walk, plus the in-school teacher-scope walks (a teacher cannot enter/sign-off another teacher's subject; a non-form-teacher cannot submit an arm).

## First prompts for Claude Code

Run in slice order. Don't paste the whole spec — each prompt names the section to read.

**Prompt 1 — slice 1 (grading config):**

> Read `docs/modules/phase-2.md` (Hard rules; Data model → GradingScheme/GradingComponent/GradeBoundary; RLS policies; API endpoints → grading scheme + grade boundaries; SECURITY DEFINER functions → the seeding note) and `CLAUDE.md`. Implement slice 1: the three models, a migration including the RLS policies, NestJS module under `apps/api/src/modules/grading/`, Zod DTOs in `packages/types/src/grading/`, the sum-to-100 (components) and tile-0–100 (boundaries) invariants enforced atomically over the whole set, and the `/settings/grading` + `/settings/grading/boundaries` UI. Extend the signup transaction to seed the default scheme (CA1/CA2/Exam) + WAEC boundaries the same way Phase 1 seeds class levels (inside the existing tx, NOT via withTenant). Write the service spec first.

**Prompt 2 — slice 2 (scores):**

> Read `docs/modules/phase-2.md` (Data model → AssessmentScore/Assessment; Hard rules → strict score validation; API endpoints → assessment scores). Implement slice 2: the two models + migration + RLS, the teacher-scoped score-entry API (single + bulk), strict `0..component.weight` validation at DTO and service, and synchronous materialization of the Assessment summary (totalScore + letterGrade). Reuse `getTeacherScope`. Write the validation + materialization unit tests first. Don't build the grid UI yet.

(Continue one slice per prompt — slice 3 gradebook grid; slice 4 aggregation/positions test-first; slice 5 report-card PDF; slice 6 approval workflow; slice 7 daily attendance; slice 8 opt-in subject attendance; slice 9 the close-out rollup. Don't run more than one slice per prompt. Slice 5's first prompt must call out the pooled-single-browser + concurrency-cap memory discipline.)

## What's deferred to later phases

Intentionally out of Phase 2 scope:

- **Auto-SMS to parent on unexplained absence** (ARCHITECTURE §6.6). Needs Termii + a guardian-comms channel, and guardians aren't users yet. **Phase 4 communications.**
- **AI report-card comment generation** (ARCHITECTURE §7). Phase 2 ships manual text in `subjectComment` / `formTeacherComment` / `principalNote`, shaped so Phase 5 drops a generator behind the existing teacher-approval gate with no migration. **Phase 5.**
- **Cumulative position across terms** (term1+term2+term3 aggregate, and the cumulative-average report-card footer). Phase 2 computes per-term positions only. **Trigger: first school finishing a full three-term year on-platform — late Phase 2 or Phase 3.**
- **Per-school report-card template / branding customization.** Phase 2 ships one HTML template. Custom layouts, logos-beyond-header, and house/affective-domain (psychomotor, punctuality, neatness) rating blocks are deferred. **Trigger: first pilot that rejects the default template.**
- **Per-level or per-subject grading schemes.** Phase 2 locks exactly one scheme per school. **Trigger: a school whose SSS science stream weights differ from its JSS scheme.**
- **Bulk export / archiving of report cards** (ARCHITECTURE §6.7 "Bulk export for archiving") — a zip of an arm's PDFs. Phase 2 generates per-card PDFs; the batch-download bundle is deferred. **Trigger: first end-of-year archive request.**
- **Promotion engine** (carried over from Phase 1 deferred) — end-of-year bulk-promote each arm to the next level. The data model supports it (`Enrollment.promotedFromArmId`); the workflow does not. **End of Phase 2 or start of Phase 3.**
- **Parent viewing report cards.** Release marks cards parent-visible, but parent auth + the parent app are **Phase 4**.
- **Dedicated `principal` role.** Phase 2 maps principal approval/reopen to owner+admin. A distinct `principal` role (principal who is not a full admin) is seeded when a pilot asks. **Trigger: first school that separates principal from admin.**
- **External PDF render service.** The fallback if pooled in-process Puppeteer blows fly.io's memory budget under large arm batches (`docs/deferred.md`). **Trigger: slice-5 memory gate fails on a 40-card batch.**
- **Mobile-first attendance marking** (ARCHITECTURE §6.6). Phase 2 attendance is web-only. **Phase 4 mobile.**

## Risks and gotchas

- **Puppeteer at fly.io's memory budget (the headline risk).** Headless Chrome is the most likely thing to OOM the API machine. Mitigations are mandated in "PDF rendering": one pooled browser, render concurrency capped at 1–2, hard page timeouts, page recycling, and ideally a separate render worker so a render OOM can't take down HTTP serving. **Slice 5 carries an explicit acceptance gate**: a 40-card arm batch must render within the memory budget, or we fall back to an external render service (deferred). Don't let "it worked rendering one card locally" stand in for the batch case.
- **Score aggregation cascading wrong if `GradingComponent.weight` changes mid-term.** If a weight is edited after scores exist, every `AssessmentScore.score` ceiling and every materialized `totalScore` becomes inconsistent — a silent, school-wide correctness corruption. **Mitigation:** editing component weights (and adding/removing components) is **blocked once any `AssessmentScore` exists for an in-progress term**; the scheme is effectively frozen per term. A weight change mid-term requires an explicit, audited "reset term scores" path (deferred). The settings UI must surface "this scheme is locked because Term 1 has marks." Treat this as the slice-1/slice-2 boundary's load-bearing invariant.
- **When to recompute positions.** A position depends on every other student's total, so recomputing on every keystroke is O(n²) churn and races concurrent edits. Phase 2 makes aggregation an **explicit pass** (slice 4) triggered on bulk save and at term end, not a per-write side effect. The gradebook must show "positions last computed at HH:MM — recompute" rather than implying live positions.
- **No Float for averages.** `overallAverage` is stored as an integer in hundredths (7350 = 73.50%), mirroring the money rule's spirit. A `Float` average would drift and break position ties. Lint/review must catch any `Number`/`Float` creeping into grade math.
- **Teacher-scope leaks within-school.** Score entry, sign-off, attendance marking, and form-review are all teacher-scoped in the **service layer**, not RLS — a bug leaks within-school (one teacher edits another's subject). Every teacher-hittable endpoint is a security-review surface; slice-9 E2Es must include the cross-teacher negative walks. Form-review is the stricter check (must be the arm's `classTeacherId`, not merely a subject teacher).
- **Approval-state races.** Two people acting on the same arm (form teacher submits while a subject teacher un-signs-off; principal approves while a score is edited) can corrupt the state machine. Arm transitions run in one `withTenant` transaction and re-check preconditions inside it; a transition whose precondition no longer holds `409`s rather than half-applying.
- **Released-card immutability.** Once `RELEASED`, scores/comments for that card must be read-only; the only mutation path is the audited `reopen`. A naive "just edit the score" path that silently changes a released PDF's underlying data (without re-rendering) is the trap — block edits at the service layer keyed on `ReportCard.status`, not just in the UI.
- **Opt-in subject attendance doubling the marking burden.** Schools that enable `subjectAttendanceEnabled` now mark twice (daily + per-period). The UI must make clear these are independent records, and the daily register must not be auto-derived from period marks (different semantics — a student can be present at registration and skip period 4).
- **Mid-term enrollment / transfers shift position denominators.** A student who transfers arms mid-term (Phase 1 `Enrollment` per-term model) belongs to one arm per term, so positions are computed against the arm-term roster. The aggregation pass must use the term's `Enrollment` rows as the denominator, not a stale `classArmId` snapshot — read the roster live at aggregate time.
- **Tests pass / runtime fails (banked lesson).** Puppeteer rendering, BullMQ wiring, and R2 upload only fail in real headless Chrome / a real Redis / real R2 — never in unit tests against mocks. Slice 5 must be verified by a real render in dev (job → PDF → R2 object) before "done", exactly as Phase 1 required a real CSV-import call. Use a real arm's worth of assessments as the fixture, not one hand-built card.
- **Audit volume.** Phase 2 adds high-frequency mutation surfaces (scores, attendance) across 8 tables; even with one-row-per-bulk-save, the audit table grows faster than Phase 1. Partitioning, noted since Phase 0 and pushed by Phase 1, will be pushed harder here — **watch row count weekly**, and remember Phase 3 finance is the table that finally forces the partition decision.
