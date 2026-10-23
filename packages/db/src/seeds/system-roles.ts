// Static system-role seed data. Lives in src/seeds (alongside class-levels +
// grading) so it compiles into the package's public API and can be imported
// from tests (e.g. the permissions-coverage spec asserts the role grants)
// without running the seed routine as a side effect. Moved here from
// prisma/seed-data.ts in the Phase 2 slice 9 RBAC rollup — the old location was
// outside src/ and so couldn't be imported across packages (TS rootDir).

import {
  ADMIN_DASHBOARD_PERMISSIONS,
  ANNOUNCEMENT_MANAGE_PERMISSIONS,
  ANNOUNCEMENT_READ_PERMISSIONS,
  BEHAVIOUR_ADMIN_PERMISSIONS,
  HEALTH_NOTE_PERMISSIONS,
  ASSIGNMENT_PERMISSIONS,
  STUDENT_CHARGE_PERMISSIONS,
  TRANSPORT_PERMISSIONS,
  TRANSPORT_READ_PERMISSIONS,
  HEALTH_PERMISSIONS,
  LIBRARY_PERMISSIONS,
  LIBRARY_SETTINGS_PERMISSIONS,
  LIBRARY_RESOURCE_PERMISSIONS,
  HOSTEL_PERMISSIONS,
  HOSTEL_READ_PERMISSIONS,
  HOSTEL_HOUSE_PERMISSIONS,
  ADMISSION_PERMISSIONS,
  ADMISSION_SETTINGS_PERMISSIONS,
  ADMISSION_ADMIT_PERMISSIONS,
  MESSAGE_PERMISSIONS,
  MESSAGE_START_PERMISSIONS,
  MESSAGE_SETTINGS_PERMISSIONS,
  MESSAGE_OVERSEE_PERMISSIONS,
  BEHAVIOUR_PERMISSIONS_LIST,
  HOMEWORK_MANAGE_PERMISSIONS,
  HOMEWORK_READ_PERMISSIONS,
  CALENDAR_PERMISSIONS,
  CALENDAR_READ_PERMISSIONS,
  REPORTS_PERMISSIONS,
  TABLE_EXPORT_PERMISSIONS,
  TIMETABLE_PERMISSIONS,
  TIMETABLE_OWN_READ_PERMISSIONS,
  PROMOTION_PERMISSIONS,
  RESULT_PIN_PERMISSIONS,
  QUESTION_BANK_PERMISSIONS,
  EXAM_PAPER_PERMISSIONS,
  CBT_PERMISSIONS,
  ID_CARD_PERMISSIONS,
  STORE_PERMISSIONS,
  ASSET_PERMISSIONS,
  WEBSITE_MANAGE_PERMISSIONS,
  OWNER_ONLY_PERMISSIONS,
  PHASE_0_PERMISSIONS,
  PHASE_1_PERMISSIONS,
  PHASE_2_OWNER_ONLY_PERMISSIONS,
  PHASE_2_PERMISSIONS,
  PHASE_2_TEACHER_PERMISSIONS,
  PHASE_3_BURSAR_PERMISSIONS,
  PHASE_3_OWNER_ONLY_PERMISSIONS,
  PHASE_3_PERMISSIONS,
  PHASE_4_PERMISSIONS,
  PHASE_5_PERMISSIONS,
  PHASE_5_TEACHER_PERMISSIONS,
  PHASE_7_PERMISSIONS,
  PHASE_7_TEACHER_PERMISSIONS,
  SMART_IMPORT_PERMISSIONS,
} from "@school-kit/types";

export interface SystemRoleSeed {
  key: string;
  name: string;
  description: string;
  permissions: readonly string[];
}

// admin gets every Phase 0 + Phase 1 + Phase 2 + Phase 3 permission EXCEPT the
// owner-only ones — the Phase 1 history-bearing deletes (academic-year/term/
// enrollment), the Phase 2 `report-card.reopen`, and the Phase 3
// `auth.2fa.manage` (owners manage their own 2FA). Phase 1 slice 13 + Phase 2
// slice 9 + Phase 3 slice 2 RBAC rollups. Keep IN SYNC with the migrations that
// update the existing global admin role row.
const ADMIN_PERMISSIONS: readonly string[] = [
  ...PHASE_0_PERMISSIONS,
  ...PHASE_1_PERMISSIONS.filter(
    (p) => !(OWNER_ONLY_PERMISSIONS as readonly string[]).includes(p),
  ),
  ...PHASE_2_PERMISSIONS.filter(
    (p) => !(PHASE_2_OWNER_ONLY_PERMISSIONS as readonly string[]).includes(p),
  ),
  ...PHASE_3_PERMISSIONS.filter(
    (p) => !(PHASE_3_OWNER_ONLY_PERMISSIONS as readonly string[]).includes(p),
  ),
  // Phase 4 / Slice 2 — guardian.invite; Slice 6 — notification-preferences.
  // read/update. No owner-only subset to exclude (unlike Phases 1-3, this
  // phase hasn't needed one yet).
  ...PHASE_4_PERMISSIONS,
  // Phase 5 / Slice 2 — lesson-plan CRUD + ai-usage.read. No owner-only
  // subset: nothing here moves money or deletes an academic record.
  ...PHASE_5_PERMISSIONS,
  // Phase 7 / CP2 — the curriculum library. Migration
  // 20260903090000_phase_7_cp2_curriculum_ingestion grants these to the admin
  // row and says this seed does the same, but it never did (found
  // 2026-10-19 by the role audit): a freshly seeded admin had no Curriculum.
  ...PHASE_7_PERMISSIONS,
  // Admin dashboard (2026-08-21). ADMIN_DASHBOARD_PERMISSIONS was spliced into
  // ALL_PERMISSIONS when the dashboard shipped and GET /dashboard has always
  // been guarded by it, but the admin role was never granted it — so every
  // INVITED admin 403'd on the page login routes them to. Owners were
  // unaffected (their grant is "*"). It stayed invisible because the dashboard
  // page only calls the API once a termId exists, and schools had no terms
  // (#198); fixing that is what surfaced this. Kept IN SYNC with the
  // idempotent append in
  // prisma/migrations/20260821000000_admin_dashboard_read_permission.
  ...ADMIN_DASHBOARD_PERMISSIONS,
  // Smart Student Import (2026-08-20) — `student.scan`. Admin/owner only;
  // deliberately absent from the teacher and bursar grants, because the
  // permission that COMMITS a scan's output (`student.import`) is already
  // admin/owner, and granting the spend more widely than the write would let
  // someone burn the school's AI budget on rows they cannot import.
  //
  // Kept IN SYNC with the idempotent append in
  // prisma/migrations/20260820000000_smart_student_import (which covers
  // existing and CI databases via `migrate deploy`; this covers a fresh
  // `db:seed`). If you edit one, edit both.
  ...SMART_IMPORT_PERMISSIONS,
  // Phase 8 / CP1 — Event Calendar: read, create/update/delete school events,
  // and hide national events. Owner/admin manage the calendar (D28). Kept IN
  // SYNC with the idempotent append in
  // prisma/migrations/20260913120200_phase_8_cp1_calendar_permissions.
  ...CALENDAR_PERMISSIONS,
  // Announcements (A1): owner and admin send; every staff role reads.
  ...ANNOUNCEMENT_MANAGE_PERMISSIONS,
  // Homework (B8): owner/admin may post for any class, as they may enter
  // marks for any. Kept IN SYNC with the idempotent append in
  // prisma/migrations/20260926120000_homework.
  ...HOMEWORK_MANAGE_PERMISSIONS,
  // Behaviour records (C14/C16). Kept IN SYNC with the idempotent append in
  // prisma/migrations/20260927120000_behaviour_records.
  ...BEHAVIOUR_PERMISSIONS_LIST,
  // Phase 9 / CP2.1 — behaviour settings and points categories. Owner/admin
  // only. Kept IN SYNC with prisma/migrations/20261019120000_behaviour_points.
  ...BEHAVIOUR_ADMIN_PERMISSIONS,
  // Phase 9 / CP3 — health records, the sickbay, and the teacher note. Kept IN
  // SYNC with prisma/migrations/20261022120000_health_profiles.
  ...HEALTH_PERMISSIONS,
  ...HEALTH_NOTE_PERMISSIONS,
  // Phase 9 / CP4 — submitted work and marking. Kept IN SYNC with
  // prisma/migrations/20261025120000_assignment_submissions.
  ...ASSIGNMENT_PERMISSIONS,
  // Phase 9 / CP5.1 — student charges. Kept IN SYNC with
  // prisma/migrations/20261029120000_student_charges.
  ...STUDENT_CHARGE_PERMISSIONS,
  // Phase 9 / CP5.2 — transport. Kept IN SYNC with
  // prisma/migrations/20261030120000_transport.
  ...TRANSPORT_PERMISSIONS,
  // Phase 9 / CP6.1 — the library, and its settings (owner/admin only). Kept
  // IN SYNC with prisma/migrations/20261031120000_library.
  ...LIBRARY_PERMISSIONS,
  ...LIBRARY_SETTINGS_PERMISSIONS,
  // Phase 9 / CP6.3 — digital resources. Kept IN SYNC with
  // prisma/migrations/20261102120000_library_resources.
  ...LIBRARY_RESOURCE_PERMISSIONS,
  // Phase 9 / CP6b.1 — hostels and boarding. Kept IN SYNC with
  // prisma/migrations/20261103120000_hostels.
  ...HOSTEL_PERMISSIONS,
  ...HOSTEL_HOUSE_PERMISSIONS,
  ...ADMISSION_PERMISSIONS,
  ...ADMISSION_SETTINGS_PERMISSIONS,
  // CP7.2: kept IN SYNC with prisma/migrations/20261107120000_admission_decisions.
  ...ADMISSION_ADMIT_PERMISSIONS,
  // CP8.1: kept IN SYNC with prisma/migrations/20261108120000_messaging.
  ...MESSAGE_PERMISSIONS,
  ...MESSAGE_START_PERMISSIONS,
  ...MESSAGE_SETTINGS_PERMISSIONS,
  // CP8.2: kept IN SYNC with prisma/migrations/20261109120000_message_safety.
  ...MESSAGE_OVERSEE_PERMISSIONS,
  // Phase 8 / CP2 — Recording Completeness: the school-wide report and the
  // per-teacher recording-activity view (audited per read). Owner/admin only;
  // never teacher or bursar (§16 D39, pinned in permissions-coverage.spec.ts).
  // Kept IN SYNC with the idempotent append in
  // prisma/migrations/20260914120000_phase_8_cp2_reports_permissions.
  ...REPORTS_PERMISSIONS,
  // Phase 9 / CP1.3 — Excel/PDF of a list already on screen; every staff role.
  // Kept IN SYNC with prisma/migrations/20261018120000_table_export_permission.
  ...TABLE_EXPORT_PERMISSIONS,
  // Phase 8 / CP3 — Timetable builder: read + manage (bell schedule, school week,
  // timetables, lessons). Owner/admin only in CP3 (§17 D35). Kept IN SYNC with
  // prisma/migrations/20260914140100_phase_8_cp3_timetable_permissions.
  ...TIMETABLE_PERMISSIONS,
  // Promotion engine (2026-09-17) — preview + commit the whole-school
  // end-of-year roll. Owner/admin only; never teacher or bursar. Kept IN SYNC
  // with the idempotent append in
  // prisma/migrations/20260917120000_promotion_permissions.
  ...PROMOTION_PERMISSIONS,
  // Phase 8c / CP6b — Result Checker PINs: generate, list, void. Owner/admin
  // only. Kept IN SYNC with the idempotent append in
  // prisma/migrations/20261003120000_result_checker.
  ...RESULT_PIN_PERMISSIONS,
  // Phase 8c / CP5b — the question bank. Kept IN SYNC with the idempotent
  // append in prisma/migrations/20261004120000_cp5b_question_bank.
  ...QUESTION_BANK_PERMISSIONS,
  // Phase 8c / CP5c — exam papers. Kept IN SYNC with
  // prisma/migrations/20261005120000_cp5c_exam_papers.
  ...EXAM_PAPER_PERMISSIONS,
  // Online exams (CBT1). Kept IN SYNC with
  // prisma/migrations/20261008120000_cbt1_sittings.
  ...CBT_PERMISSIONS,
  // ID cards (2026-10-19). Kept IN SYNC with
  // prisma/migrations/20261114120000_id_cards.
  ...ID_CARD_PERMISSIONS,
  // The Store and fixed assets (2026-10-19). Kept IN SYNC with
  // prisma/migrations/20261115120000_store.
  ...STORE_PERMISSIONS,
  ...ASSET_PERMISSIONS,
  // The school's public website (2026-10-22). Kept IN SYNC with
  // prisma/migrations/20261118120000_school_website.
  ...WEBSITE_MANAGE_PERMISSIONS,
];

// System roles are global (school_id = NULL, is_system = true) and referenced
// by `key`. Per docs/modules/phase-0.md → RBAC → Seeded roles.
//
// `owner` is the wildcard role attached to the user who signs up the school.
// `admin` carries every Phase 0 permission. The spec calls out "except
// school.delete", which doesn't exist yet as a permission — preserved here as
// a TODO comment so the intent isn't lost when school.delete lands.
export const SYSTEM_ROLE_SEEDS: SystemRoleSeed[] = [
  {
    key: "owner",
    name: "Owner",
    description: "School owner — full access to everything in the tenant.",
    permissions: ["*"],
  },
  {
    key: "admin",
    name: "Administrator",
    description:
      "School administrator — every Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4 permission except the owner-only ones (history-bearing deletes, report-card.reopen, auth.2fa.manage) and school deletion (TODO when school.delete lands).",
    permissions: ADMIN_PERMISSIONS,
  },
  // Phase 1 / Slice 10 — minimal `teacher` role. Read-scoped access to a
  // teacher's own arms/subjects/roster + self-service on their profile (per
  // phase-1.md:1087). Pulled forward into slice 10 (rather than the slice-13
  // RBAC rollup) because without it invitation-accept of a teacher rolls back
  // and class-arms' assertUserIsTeacher always fails — the whole staff branch
  // is untestable. Kept IN SYNC with the idempotent seed in
  // prisma/migrations/20260530120000_phase_1_slice_10_teacher_profiles
  // (the migration covers existing/CI DBs via `migrate deploy`; this covers a
  // fresh `db:seed`). If you edit one permission list, edit both. The Phase 2
  // additions land via the slice-9 RBAC rollup migration; `grading-scheme.read`
  // was added to PHASE_2_TEACHER_PERMISSIONS on 2026-07-28 (a slice-9 gap, not
  // a new grant here) via the 20260728000000_teacher_grading_scheme_read_permission
  // migration — see that const's own header comment for why.
  {
    key: "teacher",
    name: "Teacher",
    description:
      "Teaching staff — read-scoped access to their assigned arms, subjects, and roster, self-service on their own profile, plus the Phase 2 score/attendance/report-card actions for their own arms (the service narrows these to scope). Phase 2 slice 9 RBAC rollup (grading-scheme.read added 2026-07-28, closing a slice-9 gap).",
    permissions: [
      "class-arm.read",
      "class-level.read",
      "subject.read",
      "class-subject.read",
      "teacher-assignment.read",
      "teacher-profile.self.read",
      "teacher-profile.self.update",
      "student.read",
      "enrollment.read",
      // Phase 2 (slice 9) — granted at the guard; getTeacherScope narrows them
      // to the teacher's own (arm, subject). See PHASE_2_TEACHER_PERMISSIONS.
      // Phase 9 / CP8.1 — messages a parent addresses to their child's form
      // or class teacher. Kept IN SYNC with 20261108120000_messaging.
      ...MESSAGE_PERMISSIONS,
      ...PHASE_2_TEACHER_PERMISSIONS,
      // Phase 5 / Slice 2 — the lesson-plan generator is teacher-facing by
      // definition. Deliberately excludes ai-usage.read: school-level AI spend
      // is operator information, not teaching workflow.
      ...PHASE_5_TEACHER_PERMISSIONS,
      // Phase 7 — curriculum read + upload + delete. Teacher-facing for the
      // same reason lesson plans are: the person who knows whether a scheme of
      // work is the CURRENT one is the teacher who works from it.
      //
      // curriculum.delete is OWNERSHIP-SCOPED in CurriculumService.remove — a
      // teacher may delete only what they uploaded. See
      // PHASE_7_TEACHER_PERMISSIONS for why it moved from excluded to scoped.
      ...PHASE_7_TEACHER_PERMISSIONS,
      // Phase 8 / CP1 — the calendar is visible to all users (D4); teachers
      // read it and never manage it (D28).
      ...CALENDAR_READ_PERMISSIONS,
      ...ANNOUNCEMENT_READ_PERMISSIONS,
      // Homework (B8): a teacher SETS work, unlike announcements, which are
      // the school speaking. Scoped in the service to their own classes and
      // subjects, exactly as the gradebook is.
      ...HOMEWORK_MANAGE_PERMISSIONS,
      // A conduct note is the judgement of the person who was in the room.
      ...BEHAVIOUR_PERMISSIONS_LIST,
      // Phase 8 / CP4 — the teacher's own timetable (§18 D38). NOT
      // timetable.read: the whole-school builder stays owner/admin. Kept IN SYNC
      // with prisma/migrations/20260915120100_phase_8_cp4_timetable_own_read_permission.
      ...TIMETABLE_OWN_READ_PERMISSIONS,
      // Phase 8c / CP5b — the question bank. All four, held by the service to
      // the subjects the teacher teaches at each level (D62: the subject
      // teacher approves). Kept IN SYNC with
      // prisma/migrations/20261004120000_cp5b_question_bank.
      ...QUESTION_BANK_PERMISSIONS,
      // Phase 8c / CP5c — exam papers, held to the same subjects by the service.
      // Kept IN SYNC with prisma/migrations/20261005120000_cp5c_exam_papers.
      ...EXAM_PAPER_PERMISSIONS,
      // Online exams (CBT1), held to the same subjects by the service. Kept IN
      // SYNC with prisma/migrations/20261008120000_cbt1_sittings.
      ...CBT_PERMISSIONS,
      // Phase 9 / CP1.3 — Excel/PDF of the teacher's own lists (gradebook).
      ...TABLE_EXPORT_PERMISSIONS,
      // Phase 9 / CP3 — the "For teachers" health note, for a child they teach
      // (the service checks that). Nothing else from the health record.
      ...HEALTH_NOTE_PERMISSIONS,
      // Phase 9 / CP4 — submitted work and marking, held by the service to the
      // class and subject pairs the teacher teaches. Kept IN SYNC with
      // prisma/migrations/20261025120000_assignment_submissions.
      ...ASSIGNMENT_PERMISSIONS,
      // Phase 9 / CP6.3 — digital resources for the subjects the teacher
      // teaches (the service checks that). Kept IN SYNC with
      // prisma/migrations/20261102120000_library_resources.
      ...LIBRARY_RESOURCE_PERMISSIONS,
      // Phase 9 / CP6b.1 — a teacher may be a hostel's house master without
      // changing role (§15.8); the service checks the assignment. Kept IN SYNC
      // with prisma/migrations/20261103120000_hostels.
      ...HOSTEL_HOUSE_PERMISSIONS,
    ],
  },
  // Phase 9 / CP3 — the Health officer (docs/modules/phase-9.md §10 CP3-D1).
  // Health records and the sickbay only: no academic, finance, staff or
  // settings access. Kept IN SYNC with the INSERT in
  // prisma/migrations/20261022120000_health_profiles.
  {
    key: "health_officer",
    name: "Health officer",
    description:
      "School health officer — reads and keeps students' health records and the sickbay log, and writes the note teachers see. No academic, finance, staff or settings access.",
    permissions: [...HEALTH_PERMISSIONS],
  },
  // Phase 9 / CP6.1 — the Librarian (docs/modules/phase-9.md §14 CP6-D8). The
  // catalogue and lending only; not library.settings (owner/admin). No
  // academic, finance, health, staff or settings access: the library's own
  // routes return the student, staff, subject and class-level names its
  // screens need. Kept IN SYNC with the INSERT in
  // prisma/migrations/20261031120000_library.
  {
    key: "librarian",
    name: "Librarian",
    description:
      "School librarian — keeps the catalogue and lends books to students and staff. No academic, finance, health, staff or settings access.",
    // CP6.3 adds the digital resources (20261102120000_library_resources).
    permissions: [...LIBRARY_PERMISSIONS, ...LIBRARY_RESOURCE_PERMISSIONS],
  },
  // The Storekeeper (2026-10-19, docs/modules/id-cards-and-store.md §4,
  // owner's answer 5): runs the store and the asset register day to day. Not
  // store.sell (billing a child is the bursar's) or store.approve (a count is
  // approved by someone other than the person who counted). Kept IN SYNC with
  // the INSERT in prisma/migrations/20261115120000_store.
  {
    key: "storekeeper",
    name: "Storekeeper",
    description:
      "Runs the school store and the asset register: items, receiving, issuing, stock takes and assets. No academic, finance, health, staff or settings access.",
    permissions: ["store.read", "store.manage", "asset.read", "asset.manage", ...TABLE_EXPORT_PERMISSIONS],
  },
  // Phase 9 / CP6b.1 — the optional House master (docs/modules/phase-9.md
  // §15.8): boarding staff who are not teachers. hostel.house only, scoped by
  // the service to the hostels they are assigned to. Kept IN SYNC with the
  // INSERT in prisma/migrations/20261103120000_hostels.
  {
    key: "house_master",
    name: "House master",
    description:
      "Boarding house master — sees the boarders of the hostels they are assigned to, keeps the visitor log and decides leave-out requests. No academic, finance, health, staff or settings access.",
    permissions: [...HOSTEL_HOUSE_PERMISSIONS],
  },
  // Phase 9 / CP7 — the optional Admissions officer (docs/modules/phase-9.md
  // §16.8 answer 1). Nobody holds it by default; an admin grants it to staff
  // who keep their own role. Kept IN SYNC with the INSERT in
  // prisma/migrations/20261106120000_admissions.
  {
    key: "admission_officer",
    name: "Admissions officer",
    description:
      "Handles admission applications: reads them and moves them through review, offer and admission. Given by an admin to staff alongside their own role.",
    permissions: [...ADMISSION_PERMISSIONS],
  },
  // Phase 9 / CP8.1 — the appointed messaging roles (docs/modules/phase-9.md
  // §17.8). Nobody holds them by default; an admin appoints them in Settings
  // → Messaging, alongside the person's own role. Kept IN SYNC with the INSERT
  // in prisma/migrations/20261108120000_messaging.
  {
    key: "principal",
    name: "Principal",
    description:
      "Receives and answers messages parents send to the principal (JSS and SSS). Appointed by an admin, alongside the person's own role.",
    permissions: [...MESSAGE_PERMISSIONS],
  },
  {
    key: "head_teacher",
    name: "Head teacher",
    description:
      "Receives and answers messages parents send to the head teacher (nursery and primary). Appointed by an admin, alongside the person's own role.",
    permissions: [...MESSAGE_PERMISSIONS],
  },
  {
    key: "inbox_officer",
    name: "Inbox officer",
    description:
      "Answers messages parents send to the school office, and may start a conversation with a parent. Appointed by an admin, alongside the person's own role.",
    permissions: [...MESSAGE_PERMISSIONS, ...MESSAGE_START_PERMISSIONS],
  },
  // Phase 3 / Slice 15 — `bursar` role wire-up + RBAC close-out. Finance-only
  // system role: fee catalog, discounts, invoices, payments (not refunds),
  // payment plans, debtor reminders, expenses, the finance dashboard, and
  // (payroll CP3) running payroll — no academic, roster, staff, or
  // school-settings access, and no payroll.transfer (moving real money is
  // owner+admin only). Brand-new role row (unlike the admin/refund/BVN
  // migrations, which UPDATE an existing row), so it needs an
  // INSERT-if-not-exists migration for already-provisioned DBs alongside
  // this seed entry. See PHASE_3_BURSAR_PERMISSIONS for the exclusion
  // rationale (auth.2fa.*, staff-bvn.*, payment.refund, payroll.transfer) and
  // its 2026-08-02 addendum (academic-year.read/term.read/class-arm.read —
  // read-only scoping context every finance page's year/term/class-arm
  // selector needs; not "academic access").
  {
    key: "bursar",
    name: "Bursar",
    description:
      "Finance operator — fee catalog, discounts, invoices, payments (excluding refunds), payment plans, debtor reminders, expenses, the finance dashboard, and running payroll (excluding the actual bank transfer). Read-only access to academic years/terms/class arms to scope finance work. No staff or school-settings access. Phase 3 slice 15 RBAC close-out, extended payroll CP3.",
    // Phase 8 / CP1 — plus calendar read (D4 "visible to all users", D28). The
    // one non-finance grant bursar holds; the calendar carries no academic,
    // roster or financial data.
    permissions: [
      ...PHASE_3_BURSAR_PERMISSIONS,
      ...CALENDAR_READ_PERMISSIONS,
      ...ANNOUNCEMENT_READ_PERMISSIONS,
      // Read only: a bursar at the counter can answer "what homework does my
      // child have?" and can set none.
      ...HOMEWORK_READ_PERMISSIONS,
      // Phase 9 / CP1.3 — Excel/PDF of the finance lists the bursar works from.
      ...TABLE_EXPORT_PERMISSIONS,
      // The Store (2026-10-19, owner's answer 5): sees stock and its value,
      // sells to students and approves stock-take adjustments; does not edit
      // items or assets. Kept IN SYNC with 20261115120000_store.
      "store.read",
      "store.sell",
      "store.approve",
      "asset.read",
      // Phase 9 / CP5.1 — student charges. Kept IN SYNC with
      // prisma/migrations/20261029120000_student_charges.
      ...STUDENT_CHARGE_PERMISSIONS,
      // Phase 9 / CP5.2 — transport, read only; route fees via charge.raise.
      // Kept IN SYNC with prisma/migrations/20261030120000_transport.
      ...TRANSPORT_READ_PERMISSIONS,
      // Phase 9 / CP6b.1 — hostels, read only; hostel fees via charge.raise.
      // Kept IN SYNC with prisma/migrations/20261103120000_hostels.
      ...HOSTEL_READ_PERMISSIONS,
      // Phase 9 / CP8.1 — messages a parent addresses to the bursar. Kept IN
      // SYNC with 20261108120000_messaging.
      ...MESSAGE_PERMISSIONS,
    ],
  },
];
