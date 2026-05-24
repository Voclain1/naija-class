# Phase 1 — SIS and academic structure

The first business module. End of Phase 1, a real Nigerian school can move off Excel: define their academic year and terms, set up their class levels and arms, list their subjects, register every student (one-by-one or via bulk CSV), capture each student's guardians, enrol students into class arms, and assign teachers to classes and subjects. No grades yet, no money yet, no AI yet — just the **complete roster, correctly modelled**, that every later phase depends on.

**Estimated time solo with Claude Code:** 3–4 weeks (~5 weeks at observed Phase 0 velocity; budget 4).

## Deliverables checklist

End of Phase 1, all of these are true:

- [ ] An admin can define an `AcademicYear` (e.g. "2025/2026") and its three `Term`s with start/end dates.
- [ ] Every newly-created school is auto-seeded with the standard Nigerian `ClassLevel`s (Nursery 1 through SSS 3) and can edit/add its own.
- [ ] An admin can create `ClassArm`s under any `ClassLevel` (e.g. JSS 1A, JSS 1B), set a capacity, and assign a class teacher.
- [ ] An admin can define `Subject`s and link them to one or more `ClassLevel`s via `ClassSubject`.
- [ ] An admin can register a `Student` one-by-one with admission number, bio, photo URL, status, and link to one or more `Guardian` records.
- [ ] An admin can **bulk-import** students from CSV with: column mapping, per-row validation, preview of good/bad rows, partial-success commit, downloadable error report. No AI dedupe (Phase 5).
- [ ] An admin can `Enroll` a student into a `ClassArm` for a given `AcademicYear`, with status (enrolled / transferred / withdrawn / repeated / graduated).
- [ ] An admin can invite a teacher (Phase 0 invitation flow) → on accept, the teacher gets a `TeacherProfile` and can be assigned via `TeacherAssignment` to teach a `Subject` in a `ClassArm`.
- [ ] A teacher logging in sees **only** their assigned arms and subjects. They cannot list or query students outside their assignments.
- [ ] Two thin AI-foundation tables (`MasteryRecord`, `AIInteractionLog`) exist with `school_id` + RLS, sit empty, and are covered by the RLS isolation test. Their semantic shape is owned by Phase 5.
- [ ] Every new table has FORCE RLS, a tenant-isolation policy with WITH CHECK, and is covered by the RLS isolation spec.
- [ ] Every Phase 1 mutation writes one row to `audit_logs`.
- [ ] All tests pass (unit, integration, RLS isolation, CSV import golden-files, one E2E for the import wizard).
- [ ] CI passes on every PR.

## Acceptance bar (concrete test)

A pilot school with **250 students across 12 class arms, 15 teachers, 1 academic year × 3 terms, 14 class levels, 20 subjects** can complete first-day-of-term roster setup in under 90 minutes:

1. Owner signs up → onboarding finishes (Phase 0) → school is auto-seeded with 14 default class levels (KG 1, KG 2, Primary 1–6, JSS 1–3, SSS 1–3).
2. Admin creates AcademicYear "2025/2026" + three terms.
3. Admin creates class arms (JSS 1A, JSS 1B, …) and subjects, links subjects to levels.
4. Admin uploads `students.csv` (250 rows); 8 rows fail validation (missing DOB, duplicate admission number, invalid gender code); admin downloads the error report, fixes those 8 rows in Excel, re-uploads the 8 → all import.
5. Admin uploads `guardians.csv` and links by `student_admission_number`.
6. Admin enrols all 250 students into their arm for 2025/2026 Term 1.
7. Admin invites 15 teachers; each completes acceptance; admin assigns class teachers + subject teachers.
8. Each teacher logs in and sees exactly and only the arms/subjects they teach.

If any of those eight steps requires hand-editing the database, Phase 1 is not done.

## Data model

The Prisma schema extension for Phase 1. Lives in `packages/db/prisma/schema.prisma` (appended to the Phase 0 schema). All field-naming and column-naming follows `CLAUDE.md` conventions; relations are explicit; every domain table carries `schoolId`; raw-SQL column-type assumptions match CLAUDE.md's "Prisma column types in raw SQL" rules (`String @id` → `TEXT`, `DateTime` → `TIMESTAMP(3)`).

```prisma
// ---------- Academic structure ----------

model AcademicYear {
  id        String   @id @default(uuid())
  schoolId  String   @map("school_id")
  label     String                            // e.g. "2025/2026"
  startDate DateTime @map("start_date")       // first day of term 1
  endDate   DateTime @map("end_date")         // last day of term 3
  isCurrent Boolean  @default(false) @map("is_current")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  terms       Term[]
  enrollments Enrollment[]
  teacherAssignments TeacherAssignment[]

  @@unique([schoolId, label])
  @@index([schoolId])
  @@index([schoolId, isCurrent])
  @@map("academic_years")
}

model Term {
  id             String   @id @default(uuid())
  schoolId       String   @map("school_id")
  academicYearId String   @map("academic_year_id")
  sequence       Int                                // 1, 2, 3
  name           String                             // "First Term", "Second Term", "Third Term"
  startDate      DateTime @map("start_date")
  endDate        DateTime @map("end_date")
  isCurrent      Boolean  @default(false) @map("is_current")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  academicYear       AcademicYear        @relation(fields: [academicYearId], references: [id], onDelete: Cascade)
  teacherAssignments TeacherAssignment[]
  enrollments        Enrollment[]

  @@unique([academicYearId, sequence])
  @@index([schoolId])
  @@index([schoolId, isCurrent])
  @@map("terms")
}

model ClassLevel {
  id         String       @id @default(uuid())
  schoolId   String       @map("school_id")
  name       String                                  // "JSS 1", "Primary 4"
  code       String                                  // "jss1", "pri4" — stable identifier per school
  stage      ClassStage                              // NURSERY | PRIMARY | JSS | SSS
  orderIndex Int          @map("order_index")        // global sort order, e.g. Nursery 1 = 1 … SSS 3 = 14
  isActive   Boolean      @default(true) @map("is_active")
  createdAt  DateTime     @default(now()) @map("created_at")
  updatedAt  DateTime     @updatedAt @map("updated_at")

  arms          ClassArm[]
  classSubjects ClassSubject[]

  @@unique([schoolId, code])
  @@index([schoolId])
  @@index([schoolId, orderIndex])
  @@map("class_levels")
}

enum ClassStage {
  NURSERY
  PRIMARY
  JSS
  SSS
}

model ClassArm {
  id             String   @id @default(uuid())
  schoolId       String   @map("school_id")
  classLevelId   String   @map("class_level_id")
  name           String                                // "JSS 1A"
  code           String                                // "jss1-a" — stable identifier
  capacity       Int?                                  // optional max headcount
  classTeacherId String?  @map("class_teacher_id")     // FK → users.id (form teacher)
  isActive       Boolean  @default(true) @map("is_active")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  classLevel  ClassLevel @relation(fields: [classLevelId], references: [id], onDelete: Cascade)
  classTeacher User?     @relation("ClassTeacherArms", fields: [classTeacherId], references: [id], onDelete: SetNull)
  enrollments Enrollment[]
  teacherAssignments TeacherAssignment[]

  @@unique([schoolId, classLevelId, code])
  @@index([schoolId])
  @@index([classTeacherId])
  @@map("class_arms")
}

model Subject {
  id        String          @id @default(uuid())
  schoolId  String          @map("school_id")
  name      String                                     // "Mathematics"
  code      String                                     // "math" — stable identifier per school
  category  SubjectCategory @default(CORE)
  isActive  Boolean         @default(true) @map("is_active")
  createdAt DateTime        @default(now()) @map("created_at")
  updatedAt DateTime        @updatedAt @map("updated_at")

  classSubjects      ClassSubject[]
  teacherAssignments TeacherAssignment[]

  @@unique([schoolId, code])
  @@index([schoolId])
  @@map("subjects")
}

enum SubjectCategory {
  CORE
  ELECTIVE
  VOCATIONAL
}

model ClassSubject {
  id           String   @id @default(uuid())
  schoolId     String   @map("school_id")
  classLevelId String   @map("class_level_id")
  subjectId    String   @map("subject_id")
  isCore       Boolean  @default(true) @map("is_core")  // override per level (e.g. Maths is core in JSS, elective in some SSS streams)
  createdAt    DateTime @default(now()) @map("created_at")

  classLevel ClassLevel @relation(fields: [classLevelId], references: [id], onDelete: Cascade)
  subject    Subject    @relation(fields: [subjectId], references: [id], onDelete: Cascade)

  @@unique([schoolId, classLevelId, subjectId])
  @@index([schoolId])
  @@map("class_subjects")
}

model TeacherAssignment {
  id             String   @id @default(uuid())
  schoolId       String   @map("school_id")
  teacherId      String   @map("teacher_id")            // FK → users.id
  classArmId     String   @map("class_arm_id")
  subjectId      String   @map("subject_id")
  academicYearId String   @map("academic_year_id")
  termId         String?  @map("term_id")               // null = whole year; set = term-specific
  isActive       Boolean  @default(true) @map("is_active")
  createdAt      DateTime @default(now()) @map("created_at")
  updatedAt      DateTime @updatedAt @map("updated_at")

  teacher      User         @relation("TeacherSubjectAssignments", fields: [teacherId], references: [id], onDelete: Cascade)
  classArm     ClassArm     @relation(fields: [classArmId], references: [id], onDelete: Cascade)
  subject      Subject      @relation(fields: [subjectId], references: [id], onDelete: Cascade)
  academicYear AcademicYear @relation(fields: [academicYearId], references: [id], onDelete: Cascade)
  term         Term?        @relation(fields: [termId], references: [id], onDelete: SetNull)

  @@unique([schoolId, teacherId, classArmId, subjectId, academicYearId, termId])
  @@index([schoolId])
  @@index([teacherId])
  @@index([classArmId])
  @@index([schoolId, academicYearId])
  @@map("teacher_assignments")
}

// ---------- Student information ----------

model Student {
  id               String        @id @default(uuid())
  schoolId         String        @map("school_id")
  admissionNumber  String        @map("admission_number")    // unique per school; free-text in Phase 1
  firstName        String        @map("first_name")
  middleName       String?       @map("middle_name")
  lastName         String        @map("last_name")
  dateOfBirth      DateTime      @map("date_of_birth") @db.Date  // Reconciled in slice 4 cp1: calendar date, not a moment — see CLAUDE.md.
  gender           Gender
  photoUrl         String?       @map("photo_url")
  address          String?
  phone            String?
  email            String?
  bloodGroup       String?       @map("blood_group")
  medicalNotes    String?       @map("medical_notes")
  religion         String?
  stateOfOrigin    String?       @map("state_of_origin")
  nationality      String        @default("Nigerian")
  status           StudentStatus @default(ACTIVE)
  admittedAt       DateTime      @default(now()) @map("admitted_at")
  withdrawnAt      DateTime?     @map("withdrawn_at")
  graduatedAt      DateTime?     @map("graduated_at")
  notes            String?
  createdAt        DateTime      @default(now()) @map("created_at")
  updatedAt        DateTime      @updatedAt @map("updated_at")

  guardians        StudentGuardian[]
  enrollments      Enrollment[]
  masteryRecords   MasteryRecord[]
  aiInteractionLogs AIInteractionLog[]

  @@unique([schoolId, admissionNumber])
  @@index([schoolId])
  @@index([schoolId, status])
  @@index([schoolId, lastName, firstName])    // for sorted roster scans
  @@map("students")
}

enum Gender {
  MALE
  FEMALE
  OTHER
}

enum StudentStatus {
  ACTIVE
  INACTIVE
  WITHDRAWN
  GRADUATED
  SUSPENDED
}

model Guardian {
  id           String   @id @default(uuid())
  schoolId     String   @map("school_id")
  firstName    String   @map("first_name")
  lastName     String   @map("last_name")
  relationship Relationship
  phone        String                              // NOT globally unique — multiple students may share a guardian's phone
  email        String?
  occupation   String?
  employer     String?
  address      String?
  notes        String?
  createdAt    DateTime @default(now()) @map("created_at")
  updatedAt    DateTime @updatedAt @map("updated_at")

  students StudentGuardian[]

  @@index([schoolId])
  @@index([schoolId, phone])
  @@map("guardians")
}

enum Relationship {
  FATHER
  MOTHER
  GUARDIAN
  UNCLE
  AUNT
  GRANDPARENT
  SIBLING
  OTHER
}

model StudentGuardian {
  id         String   @id @default(uuid())
  schoolId   String   @map("school_id")
  studentId  String   @map("student_id")
  guardianId String   @map("guardian_id")
  isPrimary  Boolean  @default(false) @map("is_primary")
  canPickup  Boolean  @default(true) @map("can_pickup")
  createdAt  DateTime @default(now()) @map("created_at")

  student  Student  @relation(fields: [studentId], references: [id], onDelete: Cascade)
  guardian Guardian @relation(fields: [guardianId], references: [id], onDelete: Cascade)

  @@unique([studentId, guardianId])
  @@index([schoolId])
  @@index([guardianId])
  @@map("student_guardians")
}

// Enrollment is per-TERM, not per-academic-year. One row per (student, term).
// Why per-term, not per-year:
//   - Nigerian schools admit students mid-year. A second-term joiner gets a
//     second-term row and no first-term row — no fudging required.
//   - Phase 2's term-scoped features (attendance, CA1/CA2/exam, report cards)
//     join cleanly to Enrollment without a "which arm were they in this term"
//     lookup table.
//   - Mid-year arm transfers are recorded as the next term's row in the new
//     arm, with the old term's row preserved as historical truth.
// Do NOT "simplify" this back to per-year — it breaks the join shape Phase 2
// is designed around. (Decision locked 2026-05-22.)
//
// academicYearId is denormalized from term.academicYearId for convenient
// "all students enrolled in 2025/2026" roster queries. Service layer sets
// both together; they must stay consistent.
model Enrollment {
  id                String           @id @default(uuid())
  schoolId          String           @map("school_id")
  studentId         String           @map("student_id")
  termId            String           @map("term_id")
  academicYearId    String           @map("academic_year_id")   // denormalized from term; MUST equal term.academic_year_id
  classArmId        String           @map("class_arm_id")
  status            EnrollmentStatus @default(ENROLLED)
  enrolledAt        DateTime         @default(now()) @map("enrolled_at")
  transferredAt     DateTime?        @map("transferred_at")
  withdrawnAt       DateTime?        @map("withdrawn_at")
  promotedFromArmId String?          @map("promoted_from_arm_id")   // optional pointer to a previous term's arm (mid-year transfer or year promotion)
  notes             String?
  createdAt         DateTime         @default(now()) @map("created_at")
  updatedAt         DateTime         @updatedAt @map("updated_at")

  student      Student      @relation(fields: [studentId], references: [id], onDelete: Cascade)
  term         Term         @relation(fields: [termId], references: [id], onDelete: Cascade)
  academicYear AcademicYear @relation(fields: [academicYearId], references: [id], onDelete: Cascade)
  classArm     ClassArm     @relation(fields: [classArmId], references: [id], onDelete: Cascade)

  @@unique([schoolId, studentId, termId])    // one row per student per term
  @@index([schoolId])
  @@index([classArmId])
  @@index([schoolId, termId])
  @@index([schoolId, academicYearId])
  @@map("enrollments")
}

enum EnrollmentStatus {
  ENROLLED
  TRANSFERRED
  PROMOTED
  REPEATED
  WITHDRAWN
  GRADUATED
}

// ---------- Staff ----------

model TeacherProfile {
  id            String   @id @default(uuid())
  schoolId      String   @map("school_id")
  userId        String   @unique @map("user_id")     // 1:1 with User; teachers are Users with a teacher role
  staffNumber   String   @map("staff_number")        // unique per school; free-text in Phase 1
  qualifications String? @map("qualifications")      // free-text in Phase 1; structured array in Phase 3 payroll
  specialty     String?                              // e.g. "Mathematics"
  nutNumber     String?  @map("nut_number")          // Nigerian Union of Teachers number (optional)
  joinedAt      DateTime @default(now()) @map("joined_at")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([schoolId, staffNumber])
  @@index([schoolId])
  @@map("teacher_profiles")
}

// ---------- CSV import bookkeeping ----------

model ImportJob {
  id              String         @id @default(uuid())
  schoolId        String         @map("school_id")
  type            ImportJobType
  status          ImportJobStatus @default(PENDING)
  sourceFileUrl   String         @map("source_file_url")        // R2 path: schools/<id>/imports/<jobId>/source.csv
  columnMapping   Json?          @map("column_mapping")         // { csv_header: schema_field }
  totalRows       Int            @default(0) @map("total_rows")
  validRows       Int            @default(0) @map("valid_rows")
  invalidRows     Int            @default(0) @map("invalid_rows")
  committedRows   Int            @default(0) @map("committed_rows")
  errorReportUrl  String?        @map("error_report_url")
  previewSnapshot Json?          @map("preview_snapshot")       // first 50 good + first 50 bad rows for UI preview
  createdBy       String         @map("created_by")
  createdAt       DateTime       @default(now()) @map("created_at")
  completedAt     DateTime?      @map("completed_at")

  @@index([schoolId])
  @@index([schoolId, status])
  @@map("import_jobs")
}

enum ImportJobType {
  STUDENTS
  GUARDIANS
  TEACHERS
}

enum ImportJobStatus {
  PENDING       // file uploaded, awaiting column mapping
  VALIDATING    // worker parsing + validating rows
  READY         // preview available, awaiting admin commit
  COMMITTING    // worker inserting valid rows
  COMPLETED     // commit done (may have skipped rows; error_report_url set if any)
  FAILED        // unrecoverable error (e.g. malformed CSV, > size limit)
}

// ---------- AI foundation (thin; semantics OWNED BY PHASE 5) ----------
// These tables exist to lock in school_id + RLS + audit shape NOW so that
// when Phase 5 fills out the AI features, we are NOT doing a live-data
// migration. Their detailed schema (taxonomy of `status`, structure of
// `payload`, indexes for retrieval) is Phase 5's responsibility. Do not
// build features against these in Phase 1.

model MasteryRecord {
  id        String   @id @default(uuid())
  schoolId  String   @map("school_id")
  studentId String   @map("student_id")
  topicRef  String   @map("topic_ref")        // loose identifier; taxonomy owned by Phase 5
  status    String                            // free-text in Phase 1; enum in Phase 5
  updatedAt DateTime @updatedAt @map("updated_at")
  createdAt DateTime @default(now()) @map("created_at")

  student Student @relation(fields: [studentId], references: [id], onDelete: Cascade)

  @@unique([schoolId, studentId, topicRef])
  @@index([schoolId])
  @@index([studentId])
  @@map("mastery_records")
}

model AIInteractionLog {
  id         String   @id @default(uuid())
  schoolId   String   @map("school_id")
  studentId  String?  @map("student_id")      // nullable: teacher-driven sessions exist too
  sessionRef String   @map("session_ref")     // loose grouping identifier; shape owned by Phase 5
  payload    Json                              // raw envelope; structure owned by Phase 5
  createdAt  DateTime @default(now()) @map("created_at")

  student Student? @relation(fields: [studentId], references: [id], onDelete: SetNull)

  @@index([schoolId])
  @@index([schoolId, createdAt])
  @@index([studentId])
  @@map("ai_interaction_logs")
}
```

Additions to existing Phase 0 models (back-relations only — no column changes):

```prisma
// User — add back-relations
model User {
  // ... existing fields unchanged ...

  classTeacherArms     ClassArm[]          @relation("ClassTeacherArms")
  teacherAssignments   TeacherAssignment[] @relation("TeacherSubjectAssignments")
  teacherProfile       TeacherProfile?
}
```

No new columns are added to `users`, `schools`, `roles`, `invitations`, `audit_logs`, `sessions`, or `branches`. Phase 1 is purely additive.

## RLS policies

New table list (12): `academic_years`, `terms`, `class_levels`, `class_arms`, `subjects`, `class_subjects`, `teacher_assignments`, `students`, `guardians`, `student_guardians`, `enrollments`, `teacher_profiles`, `import_jobs`, `mastery_records`, `ai_interaction_logs`.

All Phase 1 tables are tenant-scoped, all get ENABLE + FORCE RLS, all get a `tenant_isolation` policy with both `USING` and `WITH CHECK` matching the school_id. Pattern is identical to `phase-0.sql`. Lives in `packages/db/prisma/policies/phase-1.sql`:

```sql
-- Phase 1 RLS policies. Same discipline as phase-0.sql:
--   1. ENABLE + FORCE so the table owner (school_kit migration role) cannot
--      bypass policies in dev or prod. The runtime app_user has neither
--      SUPERUSER nor BYPASSRLS — see CLAUDE.md "Multi-tenancy" hard rules.
--   2. WITH CHECK on every policy so a buggy controller cannot INSERT a
--      row with another school's school_id.
--   3. Joined-through-parent tables (student_guardians, mastery_records,
--      ai_interaction_logs that filter through students; class_subjects
--      that filter through class_levels) use EXISTS subqueries — same
--      pattern as user_roles in phase-0.

ALTER TABLE academic_years      ENABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years      FORCE  ROW LEVEL SECURITY;
ALTER TABLE terms               ENABLE ROW LEVEL SECURITY;
ALTER TABLE terms               FORCE  ROW LEVEL SECURITY;
ALTER TABLE class_levels        ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_levels        FORCE  ROW LEVEL SECURITY;
ALTER TABLE class_arms          ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_arms          FORCE  ROW LEVEL SECURITY;
ALTER TABLE subjects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE subjects            FORCE  ROW LEVEL SECURITY;
ALTER TABLE class_subjects      ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_subjects      FORCE  ROW LEVEL SECURITY;
ALTER TABLE teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_assignments FORCE  ROW LEVEL SECURITY;
ALTER TABLE students            ENABLE ROW LEVEL SECURITY;
ALTER TABLE students            FORCE  ROW LEVEL SECURITY;
ALTER TABLE guardians           ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardians           FORCE  ROW LEVEL SECURITY;
ALTER TABLE student_guardians   ENABLE ROW LEVEL SECURITY;
ALTER TABLE student_guardians   FORCE  ROW LEVEL SECURITY;
ALTER TABLE enrollments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollments         FORCE  ROW LEVEL SECURITY;
ALTER TABLE teacher_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_profiles    FORCE  ROW LEVEL SECURITY;
ALTER TABLE import_jobs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE import_jobs         FORCE  ROW LEVEL SECURITY;
ALTER TABLE mastery_records     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mastery_records     FORCE  ROW LEVEL SECURITY;
ALTER TABLE ai_interaction_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_interaction_logs FORCE  ROW LEVEL SECURITY;

-- Direct school_id columns (the boring majority) ------------------------

CREATE POLICY tenant_isolation ON academic_years
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON terms
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON class_levels
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON class_arms
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON subjects
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON class_subjects
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON teacher_assignments
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON students
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON guardians
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON student_guardians
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON enrollments
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON teacher_profiles
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON import_jobs
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON mastery_records
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));

CREATE POLICY tenant_isolation ON ai_interaction_logs
  USING      (school_id::text = current_setting('app.current_school_id', true))
  WITH CHECK (school_id::text = current_setting('app.current_school_id', true));
```

**Note on `student_guardians`:** it carries its own `school_id` (rather than joining through students or guardians), so the policy is a flat school_id check. That's a deliberate choice — it's cheaper to enforce, and gives a second line of defence if a guardian and a student from different schools were ever linked. Same reasoning for `mastery_records` and `ai_interaction_logs` carrying their own `school_id` despite having a `student_id` foreign key.

**RLS isolation test must be extended** (`apps/api/src/__tests__/rls.spec.ts`) to cover every new table:
- For each table: as School A, insert 1 row; switch session to School B; assert `count(*)` returns 0 from School B's view; assert INSERT with School A's school_id fails the WITH CHECK.
- Including the two AI tables, which sit empty in production but MUST pass the same isolation invariant.

## SECURITY DEFINER functions

**Phase 1 adds zero new SECURITY DEFINER functions.** Every Phase 1 endpoint is post-authentication and post-tenant: by the time the handler runs, we have a session-resolved `schoolId` and can use `withTenant` for all DB access.

Specifically:
- **ClassLevel seeding** happens inside the existing signup transaction *after* the school is created. The seed uses the same `tx` handle as the other tenant-scoped inserts in `signupOwner` (user, userRole, auditLog) — by the time the seed runs, the GUC `app.current_school_id` has already been set inside that tx via `set_config(..., true)` (see `auth.service.ts:signupOwner`), so the RLS `WITH CHECK` is satisfied directly. *Do not wrap the seed in `withTenant`*: `withTenant` opens its own `basePrisma.$transaction`, and Prisma does not support nested transactions — the call would hang or deadlock. (Updated 2026-05-23 when slice 2 was implemented; the earlier wording said "calls `withTenant`" which is wrong for this site.)
- **CSV import** runs entirely under `withTenant` — the admin is authenticated, the schoolId is on their JWT, and every row insert happens inside that tenant scope.
- **Teacher acceptance** reuses the Phase 0 `auth_resolve_invitation_by_token_hash` SECURITY DEFINER function (no new one needed).
- **Teacher scope filters** (a teacher querying their assigned students) are application-level joins through `teacher_assignments` and `enrollments`, both already tenant-scoped via RLS.

**SECURITY DEFINER count after Phase 1: still 4.** Under the refactor trigger threshold of 5 (per CLAUDE.md and `docs/deferred.md`). The inventory table in CLAUDE.md does **not** need updating in Phase 1.

If during implementation we discover we need pre-tenant access for any Phase 1 feature (we shouldn't, but if we do), that addition would push the count to 5 and trigger the consolidation refactor in `docs/deferred.md`. **Flag immediately if this happens.**

## Tenant client

No change. Phase 1 uses the existing `withTenant` from `packages/db/src/tenant-client.ts` verbatim. New repositories and services follow the same pattern as Phase 0:

```typescript
return withTenant(user.schoolId, (db) =>
  db.student.findMany({ where: { status: 'ACTIVE' } })
);
```

The only new helper Phase 1 introduces is `withTeacherScope(user, fn)` — a service-layer wrapper that, on top of `withTenant`, filters by the teacher's `TeacherAssignment` rows. See "RBAC implementation" below.

## API endpoints

All under `/api/v1`. Auth required for every endpoint listed here. Validation via Zod DTOs in `packages/types/src/<module>/`.

### Academic year + term

```
GET    /academic-years
POST   /academic-years
GET    /academic-years/:id
PATCH  /academic-years/:id
DELETE /academic-years/:id                — only if no enrollments reference it
POST   /academic-years/:id/set-current    — flips is_current, unflips all others

GET    /academic-years/:yearId/terms
POST   /academic-years/:yearId/terms
PATCH  /terms/:id
DELETE /terms/:id                          — only if no teacher_assignments reference it
POST   /terms/:id/set-current              — flips is_current, unflips siblings
```

### Class levels

```
GET    /class-levels                       — sorted by orderIndex
POST   /class-levels                       — admin add (rare; usually the seed is enough)
GET    /class-levels/:id
PATCH  /class-levels/:id
DELETE /class-levels/:id                   — soft-delete via isActive=false, hard-delete blocked if class_arms exist
```

### Class arms

ClassArm follows the slice-1 nested-create / flat-edit convention — the parent `classLevelId` comes from the URL on create, not the body. (Reconciled in slice 3 cp3: spec prose originally showed a flat `POST /class-arms` which never matched the shipped controller.)

```
GET    /class-arms?includeInactive=                       — flat cross-level list
GET    /class-levels/:levelId/class-arms?includeInactive= — nested list under one level
POST   /class-levels/:levelId/class-arms                  — nested-create
GET    /class-arms/:id
PATCH  /class-arms/:id                                    — including classTeacherId assignment
DELETE /class-arms/:id                                    — hard-delete; UI uses PATCH isActive=false for the recommended soft path
```

### Subjects

```
GET    /subjects?includeInactive=
POST   /subjects
GET    /subjects/:id
PATCH  /subjects/:id                                      — including isActive toggle (soft-deactivate path)
DELETE /subjects/:id                                      — hard-delete (cascades to class_subjects)
```

### Class subjects

ClassSubject follows the same nested-create / flat-edit shape as ClassArm. The `/bulk` endpoint is the matrix UI's save path — atomic per level row, deletes-before-creates, all-or-nothing. (Reconciled in slice 3 cp3: original spec prose was missing the nested form, the `/bulk` endpoint, and the PATCH route.)

```
GET    /class-levels/:levelId/class-subjects
POST   /class-levels/:levelId/class-subjects               — body: { subjectId, isCore? }
POST   /class-levels/:levelId/class-subjects/bulk          — body: { create: [{ subjectId, isCore? }], delete: string[] }
GET    /class-subjects/:id
PATCH  /class-subjects/:id                                 — body: { isCore } — toggles core/elective in place
DELETE /class-subjects/:id
```

### Teacher assignments

```
GET    /teacher-assignments?teacherId=&classArmId=&academicYearId=
POST   /teacher-assignments                — body: { teacherId, classArmId, subjectId, academicYearId, termId? }
PATCH  /teacher-assignments/:id            — toggle isActive
DELETE /teacher-assignments/:id            — hard delete (history will live in audit_logs)
```

### Students

```
GET    /students?status=&classArmId=&academicYearId=&search=&cursor=&limit=
POST   /students                            — single-create; body matches Student fields
GET    /students/:id                        — includes guardians + current enrollment
PATCH  /students/:id
POST   /students/:id/withdraw               — body: { reason, withdrawnAt }
POST   /students/:id/graduate
POST   /students/:id/reactivate
```

Example `POST /students` request:

```typescript
{
  admissionNumber: string,              // required, unique per school
  firstName: string,
  middleName?: string,
  lastName: string,
  dateOfBirth: string,                  // ISO date
  gender: 'MALE' | 'FEMALE' | 'OTHER',
  photoUrl?: string,
  address?: string,
  phone?: string,
  email?: string,
  bloodGroup?: string,
  religion?: string,
  stateOfOrigin?: string,
  nationality?: string,                 // defaults "Nigerian"
  admittedAt?: string,                  // defaults now()
  notes?: string
}
// Response: { student: Student }
```

### Guardians

```
GET    /guardians?search=&studentId=
POST   /guardians
GET    /guardians/:id                       — includes linked students
PATCH  /guardians/:id
DELETE /guardians/:id                       — hard-delete only if no StudentGuardian rows

POST   /students/:studentId/guardians       — body: { guardianId, isPrimary, canPickup } — link existing
POST   /students/:studentId/guardians/new   — body: { ...guardianFields, isPrimary, canPickup } — create + link in one transaction
PATCH  /student-guardians/:id               — toggle isPrimary, canPickup
DELETE /student-guardians/:id               — unlink (Guardian row preserved if linked elsewhere)
```

### Enrollments

```
GET    /enrollments?termId=&academicYearId=&classArmId=&studentId=&status=
POST   /enrollments                          — body: { studentId, termId, classArmId, status } — server resolves academicYearId from term
GET    /enrollments/:id
PATCH  /enrollments/:id                      — move arm, change status, add notes
DELETE /enrollments/:id                      — admin-only; rare; recorded in audit
POST   /enrollments/bulk                     — body: { termId, classArmId, studentIds: string[] }
```

The server resolves `academicYearId` from `termId` at create time and writes both columns. Filtering by `?academicYearId=` (without a `termId`) returns enrollments across all three terms of that year — useful for "everyone who has ever been enrolled in 2025/2026" roster scans. Filtering by `?termId=` returns one term's roster.

### Teacher profiles

```
GET    /teacher-profiles?search=&specialty=
POST   /teacher-profiles                    — create profile for an existing User who has the teacher role
GET    /teacher-profiles/:id
PATCH  /teacher-profiles/:id
DELETE /teacher-profiles/:id                — soft via User.isActive; profile preserved
GET    /teacher-profiles/me                 — current teacher's own profile (used by teacher UI)
PATCH  /teacher-profiles/me                 — limited fields the teacher may edit themselves (specialty, qualifications); admin-only fields rejected
```

### CSV import

See the dedicated section below for input/output shapes and the full lifecycle.

```
POST   /imports/students/upload             — multipart; returns { jobId, sourceFileUrl, status }
POST   /imports/:jobId/mapping              — body: { columnMapping } — triggers validate worker
GET    /imports/:jobId                      — status + counts + preview snapshot
POST   /imports/:jobId/commit               — triggers commit worker for valid rows
GET    /imports/:jobId/error-report         — signed URL to error report CSV
DELETE /imports/:jobId                      — only if status in (READY, FAILED); cleans R2 objects
```

The same endpoints serve guardian and teacher imports — type is set at upload via a `type` form field (`STUDENTS` | `GUARDIANS` | `TEACHERS`).

### Response shape conventions

Same as Phase 0:
- Success: `{ data: <resource>, meta?: { ... } }`
- List: `{ data: <resource>[], meta: { cursor?: string, total?: number } }`
- Error: `{ error: { code: string, message: string, details?: unknown } }`

## CSV import design

The single most important Phase 1 feature for adoption. Schools are migrating from Excel; if this is brittle they abandon the platform on day 1. This section defines the full lifecycle.

### Lifecycle

```
┌──────────┐       ┌─────────────┐       ┌────────┐       ┌──────────────┐       ┌─────────────┐
│ PENDING  │──────▶│ VALIDATING  │──────▶│ READY  │──────▶│ COMMITTING   │──────▶│ COMPLETED   │
└──────────┘       └─────────────┘       └────────┘       └──────────────┘       └─────────────┘
   ▲                                          │                                        │
   │                                          ▼                                        ▼
   │                                     (admin abort)                             (errors? → error_report_url set)
   │                                          │
   │                                          ▼
   │                                      ┌────────┐
   └──────────────────────────────────────┤ FAILED │
                                          └────────┘
```

### Step 1 — upload (PENDING)

Admin uploads CSV. Endpoint: `POST /imports/students/upload` (multipart, max 5 MB, max 10 000 rows). The handler:

1. Authenticates admin, resolves `schoolId` from JWT.
2. Streams the file to R2 at `schools/<schoolId>/imports/<jobId>/source.csv`. (R2 wiring is a Phase 1 deliverable — we already have R2 keys in `.env.example` from Phase 0.)
3. Reads the first row to extract headers; rejects with `INVALID_CSV` if header row missing, malformed UTF-8, or > 10 000 data rows.
4. Inserts an `ImportJob` row with `status=PENDING`, `totalRows`, `sourceFileUrl`. All writes under `withTenant`.
5. Returns `{ jobId, headers: string[], sampleRows: object[] }` — first 5 data rows for UI preview before mapping.

### Step 2 — column mapping (VALIDATING → READY)

Admin reviews detected headers in the UI and maps each to a schema field. Endpoint: `POST /imports/:jobId/mapping`. Body:

```typescript
{
  columnMapping: {
    "Adm No": "admissionNumber",
    "First Name": "firstName",
    "Surname": "lastName",
    "DOB": "dateOfBirth",
    "Sex": "gender",
    "": null                          // unmapped columns explicitly null
  },
  options: {
    dateFormat?: "DD/MM/YYYY" | "MM/DD/YYYY" | "YYYY-MM-DD",   // default YYYY-MM-DD
    treatBlankAs?: "skip" | "error",                            // default "skip" for optional fields
  }
}
```

The handler:

1. Validates the mapping covers all required fields (`admissionNumber`, `firstName`, `lastName`, `dateOfBirth`, `gender`).
2. Persists `columnMapping` on `ImportJob`, flips `status` to `VALIDATING`.
3. Enqueues a BullMQ job `imports:validate` with `{ jobId }`.
4. Returns `{ jobId, status: 'VALIDATING' }` immediately.

The validate worker (`apps/api/src/modules/imports/workers/validate.processor.ts`):

1. Loads the `ImportJob` row.
2. Streams the source CSV from R2.
3. For each row:
   - Applies `columnMapping` → object with schema field names.
   - Coerces types (date parsing per `dateFormat`, gender uppercase, etc.).
   - Runs the Zod `studentImportRowSchema` from `packages/types/src/students/import.ts`.
   - On validation failure: records `{ rowNumber, csvRow, errors: ZodIssue[] }` in the bad-rows accumulator.
   - On validation success: records `{ rowNumber, parsedRow }` in the good-rows accumulator.
4. After all rows parsed, runs **in-file dedup**: exact-match check on `admissionNumber` across good rows; any duplicate after the first occurrence is moved to bad-rows with reason `"Duplicate admission number with row N"`. (Exact-match only — no AI / fuzzy.)
5. Runs **external dedup**: queries existing `students.admissionNumber` for the school (under `withTenant`); any good row whose admission number already exists is moved to bad-rows with reason `"Already exists in roster"`.
6. Builds a `previewSnapshot`: first 50 good rows + first 50 bad rows + counts.
7. Updates the `ImportJob`: `status=READY`, `totalRows`, `validRows`, `invalidRows`, `previewSnapshot`.

### Step 3 — preview (READY)

Admin polls `GET /imports/:jobId` (or the UI subscribes via the existing tanstack-query refetch interval). Response:

```typescript
{
  data: {
    jobId, status: 'READY',
    totalRows: 250, validRows: 242, invalidRows: 8,
    previewSnapshot: {
      good: [{ rowNumber, parsedRow }, ...],     // first 50
      bad:  [{ rowNumber, csvRow, errors }, ...] // first 50
    }
  }
}
```

The admin sees a two-column UI: "ready to import" (242 rows, preview table) and "needs fixing" (8 rows with per-error messages). They can:
- **Download the bad-rows CSV** with an extra `_errors` column — clean up in Excel, re-upload as a new job.
- **Commit good rows now** — partial-success path.
- **Abort** — delete the job, R2 objects cleaned.

### Step 4 — commit (COMMITTING → COMPLETED)

Admin clicks "Import 242 students". Endpoint: `POST /imports/:jobId/commit`. Handler:

1. Validates `status=READY` (otherwise 409).
2. Flips `status=COMMITTING`.
3. Enqueues `imports:commit` BullMQ job.
4. Returns immediately.

The commit worker:

1. Streams the source CSV again (do not trust an in-memory snapshot — re-validate to defend against schema changes between validate and commit). For each row, re-run the Zod parse + dedup.
2. For each successfully re-validated row, run `withTenant(schoolId, (tx) => tx.student.create({ data: parsedRow }))` — **one transaction per row**. Why per-row: `withTenant` uses `SET LOCAL` inside a transaction; partial success requires per-row commit boundaries. A row that fails its own transaction (e.g. race-condition admission-number collision) is added to the bad-rows list with `"Could not commit: <reason>"` and the rest of the import continues.
3. After all rows attempted, writes a single audit_log entry with `action='students.import.commit'` and metadata containing the job id + counts. (Per-row audit would explode the log — Phase 3+ can revisit if compliance requires it.)
4. Generates the error report CSV (header row + every bad row from validate AND any rows that failed at commit time, each with an `_errors` column). Uploads to R2 at `schools/<schoolId>/imports/<jobId>/error-report.csv`. Stores the path on `ImportJob.errorReportUrl`.
5. Sets `status=COMPLETED`, `committedRows`, `completedAt`.

### Why per-row, not bulk + savepoints

A single Postgres transaction with savepoints would be faster (one connection, one `SET LOCAL`, N savepoints). Phase 1 chooses per-row transactions because:
- BullMQ retries on worker crash mid-import become trivially safe (already-committed rows stay committed; uncommitted retried).
- Per-row error isolation is debuggable.
- Throughput is fine: 250 rows × ~10 ms per Prisma transaction = 2.5 s — well within UX tolerance.

If a future school imports 10 000 students in one go, revisit with savepoints. **Tracked in `docs/deferred.md` as a Phase 1+ trigger.**

### Edge cases the spec must handle

- **Excel-saved CSVs** with UTF-8 BOM (`﻿` prefix on first header) — strip on parse.
- **Quoted fields containing commas** — use `csv-parse` with strict mode.
- **Mixed line endings** (`\r\n` vs `\n`) — `csv-parse` handles both.
- **Empty rows** at end of file — skip, don't count toward bad-rows.
- **Date ambiguity** — DD/MM/YYYY vs MM/DD/YYYY can both parse "03/05/2010". Force the admin to pick `dateFormat` at mapping time; default `YYYY-MM-DD` (ISO).
- **Gender values** — accept `M`, `Male`, `male`, `MALE` → `MALE`; reject anything else with a clear message.
- **Phone numbers** — store as given (no normalization in Phase 1; Phase 4 communications will canonicalize).
- **Whitespace** in mapped values — trim on parse; warn (not error) if trimmed value differs from raw.
- **Headers with same name** — reject upload (`AMBIGUOUS_HEADERS`); admin must rename in source file.
- **File size > 5 MB** — reject upload with HTTP 413 and a user-facing message: *"This file is larger than the 5 MB limit. Please split it into smaller files and upload them separately."* Error code `FILE_TOO_LARGE`. Never a raw 500; never a silent truncation. The frontend uploader surfaces the message inline above the drop zone with the file name and its measured size.
- **More than 10 000 data rows** — reject after header inspection with HTTP 413 and a user-facing message: *"This file has N rows. The limit is 10 000 rows per upload. Please split it into smaller files and upload them separately."* Error code `TOO_MANY_ROWS`. Same UX as above; same hard rule against silent truncation. The check happens before the source CSV is persisted to R2 so we don't pay for storage on rejected uploads.
- **Mapping submitted before validation completes** — impossible by lifecycle; upload returns sample rows synchronously.
- **Commit on an already-completed job** — 409 `JOB_NOT_IN_READY_STATE`.

### Guardian + teacher imports

Same lifecycle, different Zod schema and different post-insert hooks:
- **Guardians:** rows include `student_admission_number` to link via an in-flight lookup to `Student.id`. Link creates a `Guardian` if not deduped (exact-match on phone + lastName) and a `StudentGuardian` row in the same transaction. Bad-row reason includes `"Student admission number not found"`.
- **Teachers:** rows include `email` + `firstName` + `lastName` + `staffNumber` + `specialty`. Commit creates an `Invitation` row with the teacher role (reusing Phase 0 invitation infra); the teacher receives an invitation email and their `TeacherProfile` is created on acceptance. **Subject and class assignments are NOT in the CSV in Phase 1** — admins assign teachers to classes after acceptance, via the teacher-assignment UI. This avoids the bad UX of importing assignments referencing teachers who haven't accepted yet.

## UI screens — web (Next.js)

All new screens live under `apps/web/src/app/(admin)/` (admin/owner) or `apps/web/src/app/(teacher)/` (teacher). Route group rules from CLAUDE.md apply: route groups in parens do not appear in URLs.

### Settings → academic structure (admin)

- `/settings/academic` — landing tabs for Years, Class Levels, Subjects.
- `/settings/academic/years` — list of AcademicYears, "Add year" CTA, per-row "Set current" / "Edit" / "Delete".
- `/settings/academic/years/[id]/terms` — list of terms within a year; inline add/edit.
- `/settings/academic/class-levels` — list of ClassLevels in `orderIndex` order. Inline reorder (drag-handle). Add custom level CTA.
- `/settings/academic/class-arms` — table grouped by ClassLevel; per-arm: name, capacity, class teacher dropdown.
- `/settings/academic/subjects` — list of subjects + linked levels.
- `/settings/academic/class-subjects` — matrix view (rows = class levels, columns = subjects, checkbox = linked + core/elective toggle).

### Roster (admin)

- `/students` — paginated, searchable, filterable student list. Columns: photo, admission number, name, current arm, status. Bulk-select for status changes.
- `/students/new` — single student create form.
- `/students/[id]` — student detail: bio, guardians, enrollment history, photo. Tabs.
- `/students/[id]/edit` — edit form.
- `/students/import` — CSV import wizard (see below).
- `/guardians` — guardian list, search by name/phone.
- `/guardians/[id]` — guardian detail with linked students.

### CSV import wizard (admin)

`/students/import` — a 4-step wizard, URL-driven so refresh resumes:

1. `/students/import` — file picker, drag-and-drop, "Download template CSV" link. On upload → server returns `jobId`, navigate to step 2.
2. `/students/import/[jobId]/mapping` — column-mapping table (left: CSV headers detected; right: target field dropdown). Sample rows shown below. Date-format selector. "Validate" CTA → triggers `POST /imports/:jobId/mapping`, page polls or refetches until `status=READY`.
3. `/students/import/[jobId]/preview` — two panels: "Ready to import (242)" with a table of the first 50, and "Needs fixing (8)" with per-row error messages and "Download error CSV" button. "Commit 242 students" CTA → confirms with a modal showing the count and the warning that rejected rows are skipped.
4. `/students/import/[jobId]/done` — completion screen: "Imported 242 students. 8 rows skipped." with the final error-report CSV download.

States:
- During step 2 polling: skeleton loader + "Validating 250 rows…" with elapsed timer.
- During step 4 polling (`COMMITTING`): same pattern.
- Network error: inline banner with retry CTA.
- Abort: button in steps 2 and 3 that calls `DELETE /imports/:jobId` and routes back to `/students/import`.

### Enrollments (admin)

- `/enrollments` — current-term roster by arm. Term + year selectors at the top, defaulting to the school's current term. A "carry-over" CTA per arm copies last term's enrollments into this term for quick start-of-term setup.
- `/enrollments/bulk` — wizard: pick term, pick arm, multi-select students by current enrollment state ("not yet enrolled in this term"), commit. The wizard surfaces students admitted mid-year as a distinct group ("Admitted after term 1") so they don't get accidentally bulk-enrolled into terms they weren't around for.

### Staff (admin)

- `/staff` — list of users with the `teacher` role + their TeacherProfile.
- `/staff/invite` — calls Phase 0 invitation endpoint, role pre-selected as `teacher`.
- `/staff/[userId]` — teacher detail: profile, assigned arms, assigned subjects.
- `/staff/[userId]/edit` — admin-editable profile fields.
- `/staff/import` — CSV import wizard for bulk teacher invitations (same shell as students).

### Teacher portal (route group `(teacher)`)

Initial Phase 1 surface — minimal, just enough to validate scope-isolation:

- `/teacher/dashboard` — "Welcome. You are assigned to: <list of arms + subjects>."
- `/teacher/classes` — list of arms where this teacher is class teacher OR has a subject assignment.
- `/teacher/classes/[armId]` — single arm view: roster (filtered to enrolled students), and the subjects this teacher teaches in that arm.
- `/teacher/profile` — view + edit own profile (specialty, qualifications); read-only on `staffNumber`, `nutNumber`.

A teacher who navigates to `/students` or `/staff` is server-rejected with a redirect to `/teacher/dashboard`. A teacher who navigates to `/teacher/classes/[someoneElsesArm]` gets a 404 (the service-layer scope filter returns no row).

### Owner dashboard updates

`/dashboard` (Phase 0 empty state) gets two new widgets:
- "Roster" — count of active students, count of teachers, current academic year + term.
- "Setup checklist" — visible until all 6 acceptance-bar steps are complete; clicking each opens the relevant screen.

## UI screens — mobile (Expo)

No new mobile work in Phase 1. The teacher portal is web-only (teachers in Nigerian schools typically use laptops or admin tablets for register-style work; mobile teacher app is post-Phase 4). The parent app stays as the Phase 0 placeholder; parent features unblock in Phase 4 when guardians get auth.

The mobile login screen does **not** need to handle teachers logging in via mobile — that's web only.

## RBAC implementation

### New permission strings

Appended to `packages/types/src/permissions.ts`:

```typescript
export const PHASE_1_PERMISSIONS = [
  // Academic structure
  'academic-year.read', 'academic-year.create', 'academic-year.update', 'academic-year.delete',
  'term.read', 'term.create', 'term.update', 'term.delete',
  'class-level.read', 'class-level.create', 'class-level.update', 'class-level.delete',
  'class-arm.read', 'class-arm.create', 'class-arm.update', 'class-arm.delete',
  'subject.read', 'subject.create', 'subject.update', 'subject.delete',
  'class-subject.read', 'class-subject.create', 'class-subject.update', 'class-subject.delete',
  'teacher-assignment.read', 'teacher-assignment.create', 'teacher-assignment.update', 'teacher-assignment.delete',

  // Roster
  'student.read', 'student.create', 'student.update', 'student.deactivate',
  'student.import',
  'guardian.read', 'guardian.create', 'guardian.update', 'guardian.delete',
  'guardian.import',
  'enrollment.read', 'enrollment.create', 'enrollment.update', 'enrollment.delete',

  // Staff
  'teacher-profile.read', 'teacher-profile.create', 'teacher-profile.update', 'teacher-profile.delete',
  'teacher.import',
  'teacher-profile.self.read', 'teacher-profile.self.update',     // teacher self-service

  // AI foundation (Phase 5 extends)
  'mastery.read',
  'ai-interaction.read',
] as const;

export const ALL_PERMISSIONS = [
  ...PHASE_0_PERMISSIONS,
  ...PHASE_1_PERMISSIONS,
  /* extend per phase */
] as const;
```

### Updated seeded roles

The Phase 0 seed script grows; existing schools get a one-shot migration to apply new permissions to existing role rows.

| Role key | Permissions |
|---|---|
| `owner` | `["*"]` (unchanged) |
| `admin` | all Phase 0 + all Phase 1, **except** `*.delete` on history-bearing tables (`student.delete`, `enrollment.delete`, `academic-year.delete`, `term.delete`) — those are owner-only |
| `teacher` | `class-arm.read`, `class-level.read`, `subject.read`, `class-subject.read`, `teacher-assignment.read` (self-scoped), `teacher-profile.self.read`, `teacher-profile.self.update`, `student.read` (assigned-arm-scoped), `enrollment.read` (assigned-arm-scoped) |
| `student` | TBD Phase 6 |
| `parent` | TBD Phase 4 |
| `bursar` | TBD Phase 3 |

### Service-layer scope filter (teacher scope)

The `PermissionsGuard` (Phase 0) checks the permission string but does not know which arms a teacher is assigned to. Phase 1 adds a service-layer helper:

```typescript
// apps/api/src/modules/auth/teacher-scope.ts
export async function getTeacherScope(
  db: PrismaClient,
  teacherId: string,
  academicYearId?: string,
): Promise<{ classArmIds: string[]; subjectIdsByArm: Record<string, string[]> }> {
  const assignments = await db.teacherAssignment.findMany({
    where: { teacherId, isActive: true, ...(academicYearId ? { academicYearId } : {}) },
    select: { classArmId: true, subjectId: true },
  });
  const classArmIds = [...new Set(assignments.map(a => a.classArmId))];
  // also include arms where they are the class teacher
  const homeroomArms = await db.classArm.findMany({
    where: { classTeacherId: teacherId, isActive: true },
    select: { id: true },
  });
  homeroomArms.forEach(a => { if (!classArmIds.includes(a.id)) classArmIds.push(a.id); });

  const subjectIdsByArm: Record<string, string[]> = {};
  for (const a of assignments) {
    subjectIdsByArm[a.classArmId] = [...(subjectIdsByArm[a.classArmId] ?? []), a.subjectId];
  }
  return { classArmIds, subjectIdsByArm };
}
```

Every endpoint that a teacher can call MUST apply this scope in the service layer. Pattern:

```typescript
@Get(':armId/roster')
@Permissions('student.read')
async roster(@CurrentUser() user, @Param('armId') armId: string) {
  return withTenant(user.schoolId, async (db) => {
    if (user.roles.includes('teacher') && !user.roles.includes('admin')) {
      const scope = await getTeacherScope(db, user.id);
      if (!scope.classArmIds.includes(armId)) throw new NotFoundException();
    }
    return db.student.findMany({
      where: { enrollments: { some: { classArmId: armId } } },
      include: { enrollments: true },
    });
  });
}
```

**Critical:** RLS already isolates by school. The teacher-scope check is an additional in-school filter — it's authorization, not tenancy. A bug here leaks within-school, not across-school.

## Audit interceptor

No change to the interceptor itself. New actions added to the implicit naming convention.

**Convention: `<singular-resource>.<verb>`** (Phase 0 set this: `school.update`, `user.invite`, `onboarding.step1_complete`). The list below uses that form. The hyphenated-plural prose form used elsewhere in this spec ("academic-years.create", etc.) is casual; **the code uses the singular form** and nobody should "fix" the code to match the casual prose. Slice 1 locked this in via inline `AUDIT` constants on `AcademicYearsService` and `TermsService` — copy the same shape in subsequent slices.

- `student.create`, `student.update`, `student.withdraw`, `student.graduate`, `student.reactivate`, `student.import.commit`
- `guardian.create`, `guardian.update`, `guardian.delete`
- `student-guardian.create`, `student-guardian.update`, `student-guardian.delete`
- `enrollment.create`, `enrollment.update`, `enrollment.delete`
- `academic-year.create`, `academic-year.update`, `academic-year.delete`, `academic-year.set-current`
- `term.create`, `term.update`, `term.delete`, `term.set-current`
- `class-level.create`, `class-level.update`, `class-level.delete`
- `class-arm.create`, `class-arm.update`, `class-arm.delete`
- `subject.create`, `subject.update`, `subject.delete`
- `class-subject.create`, `class-subject.delete`
- `teacher-assignment.create`, `teacher-assignment.update`, `teacher-assignment.delete`
- `teacher-profile.create`, `teacher-profile.update`, `teacher-profile.delete`
- `import.upload`, `import.mapping`, `import.commit`, `import.abort`

The CSV import commit writes **one** audit row per import (not per row inserted) with row counts in metadata. Rationale: 10 000 students × 3 imports × 1 audit row each would dominate the audit table; the import job already persists per-row state in `ImportJob` + the error report CSV.

**Audit writes stay synchronous in Phase 1**, as in Phase 0. The BullMQ migration tracked in `docs/deferred.md` ("Refactor audit log writes from direct (synchronous) to BullMQ queued") deserves its own dedicated slice when scale demands it, not a rider on a feature phase. Phase 1's mutation volume during build + single-pilot doesn't justify the queue; synchronous worked through all of Phase 0 and will continue to work here.

## Acceptance criteria

End of Phase 1 these must all pass:

1. New school signup auto-seeds 14 ClassLevels: KG 1, KG 2, Primary 1–6, JSS 1–3, SSS 1–3, with correct stage and orderIndex. Verified by integration test that signs up a fresh school and asserts on `class_levels` rows. (Pre-primary naming locked to KG 1 / KG 2 on 2026-05-23 — see the "default pre-primary naming" decision in slice 2 implementation; schools that prefer "Nursery 1 / Nursery 2" rename after the fact.)
2. Admin can create an AcademicYear with three Terms, set one as current; setting another as current unflips the first. Verified by integration test.
3. Admin can create a ClassArm under a ClassLevel, assign a class teacher, set capacity. The class teacher dropdown only lists users with the `teacher` role at this school.
4. Admin can create a Subject and link it to one or more ClassLevels via ClassSubject. The matrix view persists checkbox state through refresh.
5. Admin can create a single Student with required fields, link one or more Guardians via the same form, and the student appears in the roster list. Audit log has `students.create` and `student-guardians.create` rows.
6. Admin can upload a 250-row student CSV: column mapping screen renders detected headers; validation completes; preview shows 242 good + 8 bad with per-error messages; commit imports 242; final completion screen offers a downloadable error report containing exactly the 8 bad rows + their `_errors` column. Verified by Playwright E2E test using a fixture CSV.
7. The same CSV import flow works for guardians (linking by `student_admission_number`) and teachers (creating Invitations via the Phase 0 flow).
8. Admin can enrol a student into a ClassArm for a given Term via single-create and via bulk-enroll. Re-enrolling the same student into the same term returns a 409 conflict, not a silent overwrite. A student admitted mid-year shows zero rows for the term they missed and one row for the term they joined — verified by integration test.
9. Teacher invitation flow end-to-end: admin invites by email → teacher accepts at `/invitations/[token]` → admin assigns the teacher as class teacher of JSS 1A → teacher logs in → teacher sees `/teacher/classes/[arm-id]` for JSS 1A's roster ONLY. Attempting to GET another arm's roster returns 404 from the service-layer scope filter.
10. Two separate schools cannot see each other's academic structure, students, guardians, enrollments, teacher profiles, import jobs, mastery records, or AI interaction logs. Verified by the extended RLS isolation spec covering all 15 new tables.
11. SECURITY DEFINER count remains at 4 (no new ones added). CLAUDE.md inventory table is unchanged.
12. CI passes on every PR: lint, typecheck, unit, integration, RLS isolation, Playwright E2E (Phase 0 happy-path + new CSV import path).
13. The two AI-foundation tables (`mastery_records`, `ai_interaction_logs`) exist, have FORCE RLS, pass the isolation spec, and contain zero rows.

## Slice breakdown

Sequenced per the locked build order (academic skeleton → students → enrollment → staff). Each slice ships independently and is testable on its own. Size estimates assume Phase 0's observed velocity (~1 slice/day, allowing for "tests pass / runtime fails" verification overhead).

| # | Slice | Why it ships independently | Size |
|---|---|---|---|
| 1 | **AcademicYear + Term** — models, migration, RLS, CRUD endpoints, settings UI tab | The whole academic skeleton hangs off this. Trivial to demo: log in, create a year + three terms. | 2 days |
| 2 | **ClassLevel** — model, migration, RLS, seed-on-signup, CRUD endpoints, settings UI | Seed runs at signup; admins can edit/add. Verifiable by signing up a fresh test school and asserting the 14 default levels exist. | 2 days |
| 3 | **ClassArm + Subject + ClassSubject** — three models, migrations, RLS, CRUDs, matrix UI for class-subject mapping | Completes the academic skeleton. Owner can now describe "JSS 1A takes Maths, English, Civic Education." | 3 days |
| 4 | **Student manual CRUD** — model, migration, RLS, single-create endpoint, roster list UI, detail/edit forms | One student in, one student out. Shippable alone for tiny schools that won't use CSV. | 3 days |
| 5 | **Guardian + StudentGuardian** — models, RLS, link/unlink endpoints, guardian forms inline on student detail | Most schools want guardian capture from day one. | 2 days |
| 6 | **CSV import — upload + mapping + validate** — `ImportJob` model, R2 wiring, BullMQ validate worker, Zod row schemas, in-file + external dedup, wizard steps 1–2 | First half of the import flow. Admin can upload + see preview but can't commit yet. Shippable as "preview mode". | 4 days |
| 7 | **CSV import — commit + error report** — commit worker, per-row transactions, error CSV generation, wizard steps 3–4 | Completes the import flow. Acceptance bar test 6 passes after this. | 2 days |
| 8 | **Guardian + Teacher imports** — reuse the import shell with different Zod schemas and different post-insert hooks (Guardian-link / Invitation-create) | Mostly schema swaps; the heavy lifting is in slices 6–7. | 2 days |
| 9 | **Enrollment** — model (per-TERM uniqueness, denormalized academicYearId), RLS, single + bulk endpoints, current-term roster + bulk-enroll wizard with carry-over from previous term | Closes the student loop. Now we know which student is in which arm in which term. | 2 days |
| 10 | **TeacherProfile + class teacher assignment** — model, RLS, CRUD endpoints, `ClassArm.classTeacherId` wiring, staff UI | Phase 1 staff branch begins. Class teachers can be assigned even before subject assignments exist. | 2 days |
| 11 | **TeacherAssignment + teacher portal** — model, RLS, CRUD endpoints, service-layer scope filter, `(teacher)` route group with dashboard + classes + profile screens | The teacher-scope filter is the most testable security property of Phase 1. End-to-end test: admin assigns, teacher sees only assigned. | 4 days |
| 12 | **AI foundation tables** — `MasteryRecord` + `AIInteractionLog` models, migration, RLS, extend RLS isolation spec | Tiny slice, but easy to forget. Land it after teacher assignments so it doesn't lengthen the critical path. | 1 day |
| 13 | **Phase 1 RBAC, audit coverage, RLS spec, E2E** — wire all new permissions into seed; gather every Phase 1 slice's permission constants in `packages/types/src/permissions.ts` (canonical rollup — slices 1/2 deferred this so every slice's strings arrive in one auditable diff; slice 3 already landed `PHASE_1_SLICE_3_PERMISSIONS` as a forward declaration); update `admin` role on existing schools; verify every Phase 1 mutation writes its expected synchronous audit row (no BullMQ migration in this slice — that stays deferred); extend RLS isolation spec to all 15 new tables; add Playwright E2E for the CSV import wizard | Phase 1 closes here. All deliverables green. | 3 days |

Total: **32 days** raw, ~5 calendar weeks at observed pace. Buffer: 1 week. **Phase 1 target: 6 weeks elapsed, ~26 working days.**

## First prompts for Claude Code

Run in slice order. Don't paste the whole spec — each prompt names the section to read.

**Prompt 1 — slice 1 (AcademicYear + Term):**

> Read `docs/modules/phase-1.md` (Data model → AcademicYear, Term; RLS policies; API endpoints → Academic year + term) and `CLAUDE.md`. Implement slice 1 end-to-end: Prisma models, migration including the RLS policies for academic_years and terms, NestJS module under `apps/api/src/modules/academic-years/` with controller + service + Zod DTOs in `packages/types/src/academic-years/`, plus the `/settings/academic/years` and term sub-routes UI in `apps/web/src/app/(admin)/settings/academic/`. Write the service spec first. Cover: happy path, unique-label-per-school violation, set-current flips siblings, deletion blocked by enrollments.

**Prompt 2 — slice 2 (ClassLevel + seed-on-signup):**

> Read `docs/modules/phase-1.md` (Data model → ClassLevel; the "ClassLevel seeding" note in SECURITY DEFINER functions; API endpoints → Class levels). Implement slice 2: ClassLevel model, migration with RLS, CRUD endpoints, settings UI. Then extend the existing signup transaction in `apps/api/src/modules/auth/auth.service.ts` to seed the 14 standard Nigerian class levels via `withTenant(newSchool.id, ...)` after the school is created. List the 14 levels in `packages/db/src/seeds/class-levels.ts`. Write a regression test that signs up a fresh school and asserts on the seeded rows.

(Continue scoping one slice per prompt — slice 3 covers ClassArm + Subject + ClassSubject; slice 4 Student manual CRUD; etc. Don't run more than one slice per prompt.)

## What's deferred to later phases

These belong in Phase 1 or its neighbours *eventually* but are intentionally not in scope:

- **Admission application workflow** — applicants applying online, document upload, accept/reject decisions. Phase 1 assumes students are already admitted; admins type them into the roster or upload via CSV. Tracked in `docs/deferred.md`. **Trigger: first pilot school that wants the new-admission funnel managed in-platform.**
- **AI dedup on import** — fuzzy name matching, near-duplicate detection. Phase 1 uses exact-match only. **Phase 5.**
- **Auto-generated admission numbers with school-configurable format** — Phase 1 treats admission number as free-text required-unique. **Phase 2 if a pilot asks.**
- **Student photo upload** — Phase 1 stores `photoUrl` as a string; upload UI deferred. R2 already wired for logos in Phase 0. **Phase 2 or 4.**
- **Branch / multi-campus** — `Branch` table exists from Phase 0 but Phase 1 entities do not yet carry `branch_id`. Adding `branch_id` later is purely additive (nullable column + index + policy extension), so deferring is safe. **Trigger: first multi-campus pilot school.**
- **Promotion engine** — at end-of-year, bulk-promote each arm to the next level (e.g. JSS 1A → JSS 2A). The data model supports it (`Enrollment.promotedFromArmId`); the UI workflow does not. **End of Phase 2 or start of Phase 3.**
- **Withdrawal / graduation parent-notification workflow** — withdrawal endpoint exists but doesn't notify guardians. **Phase 4 communications.**
- **Audit-log writes via BullMQ queue** — remains deferred per `docs/deferred.md`. Synchronous audit writes worked through Phase 0 and continue in Phase 1; the queue migration is a dedicated future slice triggered when import or mutation volume justifies it, not a rider on a feature phase.
- **Teacher BVN capture** — needed for Phase 3 payroll, not Phase 1. Defer to keep PII surface narrow.
- **Per-row audit on bulk imports** — Phase 1 writes one audit row per import job. **Trigger: NDPR review or first compliance request.**
- **Bulk import savepoints instead of per-row transactions** — Phase 1 uses per-row. **Trigger: import latency > 30 s on > 5 000-row uploads.**
- **`AIInteractionLog.payload` and `MasteryRecord.status` taxonomy** — Phase 5 owns the shape. Phase 1 just locks in the column types + RLS.

## Risks and gotchas

- **`Enrollment` uniqueness on `(schoolId, studentId, termId)`** means a student can only be in one arm per term. Mid-year transfers manifest naturally: the new arm appears as next term's row, the old arm's row stays as historical truth. The denormalized `academicYearId` column **must** be kept in sync with `term.academicYearId` at write time — the service layer resolves it from the term; never let an API caller pass academicYearId directly. A future Phase 2 migration could enforce this with a Postgres CHECK constraint backed by a trigger; Phase 1 keeps it as a service-layer invariant to ship faster.
- **Class teacher dropdown UX** — when no teachers have accepted yet, the dropdown is empty. The settings/classes UI must show an inline "Invite a teacher" CTA, not just a useless empty dropdown.
- **CSV admission number collisions during commit** — between validate and commit, a manual student-create could insert the same admission number. The per-row transaction will fail; the row goes to the error report with `"Already exists in roster"`. Test this race.
- **ClassLevel seed idempotency** — if the signup transaction ever retries, the seed must not duplicate. The 14 templates use stable `code` values; the unique `(schoolId, code)` constraint enforces idempotency. Belt + braces: the seed function uses `upsert`, not `create`.
- **Teacher scope filter is enforced in the service layer, not in RLS** — a bug in the service code leaks within-school. Treat every endpoint a teacher can hit as a security-review surface. Specifically: the test suite for slice 11 must include "teacher tries to access another teacher's arm" assertions.
- **R2 cleanup on aborted imports** — `DELETE /imports/:jobId` must delete both the source CSV and any partial error report from R2. A leaked R2 object isn't a security problem (it's tenant-scoped by path), but it's a billing leak and a privacy concern for student PII.
- **NDPR PII in error-report CSVs** — the downloadable error CSV contains every rejected row's full content (names, DOBs, phone numbers). Admins downloading it constitutes data export. Phase 1 logs this via `imports.error-report.download` audit action so it shows up in compliance reviews. The R2 URL is signed with a 5-minute TTL.
- **Phone uniqueness on `users` (Phase 0 carry-over)** — Phase 1 still doesn't trigger it (guardians are NOT users yet). Phase 4 triggers the re-think. **Re-read CLAUDE.md "Risks and gotchas" before starting Phase 4.**
- **Audit log volume** — even with one-row-per-import, the Phase 1 audit table grows ~5× faster than Phase 0 (manual CRUDs across 14 new tables). Partitioning was noted in Phase 0 risks; Phase 3 finance will push it over the edge. **Watch row count weekly during Phase 1.**
- **Tests pass / runtime fails (Phase 0 lesson banked)** — every new module must be verified by a real call in dev before "done". CSV import especially: Zod schemas pass unit tests against synthetic rows but fail at the BOM / encoding layer that only real-Excel exports surface. **Use real Excel-saved fixture files in `apps/api/test/fixtures/imports/`, not hand-typed CSVs.**
- **The two AI-foundation tables are the most likely thing to ship and be forgotten** — slice 12 is small, late in the order, and easy to descope when running out of time. The deferred.md entry explicitly says "MUST be pulled into docs/modules/phase-1.md — failure mode is forgetting it and hitting a live-data migration at Phase 5." Treat slice 12 as a hard gate on Phase 1 closure.
