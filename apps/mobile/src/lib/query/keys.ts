// Query keys, in one place.
//
// Centralised because the offline persister's `shouldDehydrateQuery` filter
// (src/lib/query/persist.ts) inspects the SERIALISED key to decide what is
// allowed onto disk — anything mentioning auth/session/token is excluded.
// Keys invented ad hoc at call sites would make that filter's behaviour
// impossible to reason about; here it can be read at a glance.
//
// Note there is deliberately NO key for the guardian session itself. The
// session lives in React state plus expo-secure-store, never in the query
// cache, so it cannot be persisted to plaintext AsyncStorage even by accident
// (phase-6.md D12).

export const queryKeys = {
  students: ["students"] as const,
  student: (studentId: string) => ["students", studentId] as const,
  invoices: (studentId: string) => ["students", studentId, "invoices"] as const,
  payment: (reference: string) => ["payments", reference] as const,
  // The school's bank account for transfers. Persistable like the rest of the
  // family surface, and it changes about never.
  bankDetails: ["bank-details"] as const,
  // Released results. Safe to persist and DELIBERATELY long-lived: a released
  // report card is frozen by released-guard.ts on the server, so a cached one
  // cannot be wrong, only absent (D32).
  results: (studentId: string) => ["students", studentId, "results"] as const,
  result: (studentId: string, termId: string) =>
    ["students", studentId, "results", termId] as const,

  // The student principal's own data. Keyed under "me" rather than under the
  // student's id on purpose: the id never appears in a student-surface URL or
  // request (phase-6.md §8), so introducing one here just to build a cache key
  // would reintroduce the identifier the API deliberately refuses to take.
  //
  // These cannot collide with the guardian keys above even on a shared
  // handset, and the cache is wiped on every sign-out regardless (D12).
  // A guardian's view of one child's portal access state.
  portalStatus: (studentId: string) =>
    ["students", studentId, "portal-status"] as const,
  // Phase 9 / CP2.3 — approved suspensions and exclusions for one child: the
  // action and its dates only, never a reason.
  disciplineNotices: (studentId: string) =>
    ["students", studentId, "discipline-notices"] as const,
  // Phase 9 / CP3.1 — the child's health record. Read with
  // `meta: { persist: false }`: special-category health data stays in memory.
  healthRecord: (studentId: string) => ["students", studentId, "health"] as const,
  // Phase 9 / CP5.3 — the child's school bus this term.
  studentTransport: (studentId: string) => ["students", studentId, "transport"] as const,
  studentHostel: (studentId: string) => ["students", studentId, "hostel"] as const,
  studentExeats: (studentId: string) => ["students", studentId, "exeats"] as const,
  // Phase 9 / CP6.2 — a parent's child's library books out.
  studentLibrary: (studentId: string) => ["students", studentId, "library"] as const,
  // Phase 9 / CP3.3 — the child's sickbay visits. Also `persist: false`.
  sickbayVisits: (studentId: string) => ["students", studentId, "sickbay"] as const,

  me: ["me"] as const,

  // The school's logo as a SIGNED URL that expires in an hour
  // (docs/modules/school-identity.md). Never persisted: the reading hook passes
  // `meta: { persist: false }`, because a URL restored from disk after the hour
  // is a broken image. Staff's key starts with "staff" like every staff key.
  schoolLogo: (principal: "guardian" | "student" | "staff") =>
    principal === "staff"
      ? (["staff", "school-logo"] as const)
      : principal === "student"
        ? (["me", "school-logo"] as const)
        : (["school-logo"] as const),
  myResults: ["me", "results"] as const,
  myResult: (termId: string) => ["me", "results", termId] as const,
  myAttendance: ["me", "attendance"] as const,
  myFees: ["me", "fees"] as const,

  // Phase 8 / CP1 — the school calendar. Persistable on purpose: it carries no
  // personal data (holidays, term dates, school events), and a family looking
  // up resumption day offline is exactly who the persisted cache is for. The
  // window is part of the key so a cached window is never shown for another.
  guardianCalendar: (from: string, to: string) => ["calendar", from, to] as const,
  myCalendar: (from: string, to: string) => ["me", "calendar", from, to] as const,

  // Phase 8 / CP4 — the class timetable families see: the school's PUBLISHED
  // snapshot (docs/modules/phase-8.md §18 D45). Persistable like released results:
  // it is published, not a draft, and the cache is wiped on sign-out (D12).
  studentTimetable: (studentId: string) => ["students", studentId, "timetable"] as const,
  myTimetable: ["me", "timetable"] as const,

  // Announcements the school has sent to this family
  // (docs/modules/announcements.md). Persistable, like the calendar and
  // released results: "the gate is closed tomorrow" is exactly the message a
  // parent needs to reread on a bus with no signal, and the cache is wiped on
  // sign-out (D12). Unlike the calendar it carries no window in the key — the
  // feed is short and the server decides what is still current.
  guardianAnnouncements: ["announcements"] as const,
  // Phase 9 / CP8.1 — the parent's own conversations.
  guardianMessages: ["messages"] as const,
  guardianMessage: (threadId: string) => ["messages", threadId] as const,
  // Phase 9 / CP11.1 — the parent's own announcement-email setting and the
  // address the school holds for them. Their own data; wiped on sign-out.
  guardianEmailPreferences: ["email-preferences"] as const,
  myAnnouncements: ["me", "announcements"] as const,
  // Phase 9 / CP6.2 — the student's own library books out.
  myLibrary: ["me", "library"] as const,
  // Phase 9 / CP6.3 — PDFs and links for the student's class.
  myLibraryResources: ["me", "library", "resources"] as const,

  // Homework (the-school-day.md Part B). Persisted like the calendar and
  // announcements: "questions 1 to 10 by Friday" is exactly what a child needs
  // at a kitchen table with no signal, and it is the whole point of the
  // feature. Keyed per child on the guardian side, because a parent switches
  // between them.
  guardianHomework: (studentId: string) => ["students", studentId, "homework"] as const,
  myHomework: ["me", "homework"] as const,
  // Phase 9 / CP4.1 — handed-in work and marks. Read with `persist: false`:
  // a child's answers and marks stay in memory.
  guardianAssignments: (studentId: string) => ["students", studentId, "assignments"] as const,
  myAssignments: ["me", "assignments"] as const,
  myAssignment: (homeworkId: string) => ["me", "assignments", homeworkId] as const,

  // --- staff (CP2) --------------------------------------------------------
  //
  // EVERY staff key begins with the literal "staff". That prefix is not
  // cosmetic: `mayPersistQuery` (src/lib/query/persist-policy.ts) refuses any
  // key whose first element is "staff", which is what keeps a teacher's
  // register — real students, by name — out of plaintext AsyncStorage on a
  // shared handset. schoolId and userId follow so a second staff account on
  // the same device cannot read the first one's cached register, and so the
  // background-lock teardown can drop the whole subtree by prefix.
  //
  // A new staff key that does not start with "staff" would silently become
  // persistable. `staff-keys.spec.ts` asserts the real keys these screens use,
  // not the policy function in the abstract, for exactly that reason.
  staffScope: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "scope"] as const,
  staffRegister: (schoolId: string, userId: string, classArmId: string, date: string) =>
    ["staff", schoolId, userId, "attendance", classArmId, date] as const,

  // CP3 — bursar collections. Same "staff" prefix rule, and it matters more
  // here than anywhere else in the app: a debtor list is every family in the
  // school that owes money, by name and amount. That must never reach
  // plaintext AsyncStorage on a shared staffroom handset.
  staffTermContext: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "term-context"] as const,
  staffCollections: (schoolId: string, userId: string, termId: string) =>
    ["staff", schoolId, userId, "collections", termId] as const,
  staffDebtors: (schoolId: string, userId: string, termId: string) =>
    ["staff", schoolId, userId, "debtors", termId] as const,
  // CP9b — a Paystack payment link carries a live pay URL; staff prefix.
  staffPaymentLink: (schoolId: string, userId: string, invoiceId: string) =>
    ["staff", schoolId, userId, "payment-link", invoiceId] as const,
  // Branded receipts — a child's name and a payment per row; staff prefix.
  staffReceipts: (schoolId: string, userId: string, search: string) =>
    ["staff", schoolId, userId, "receipts", search] as const,
  staffExpenseCategories: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "expense-categories"] as const,

  // CP6a — teacher gradebook. A column is every student in an arm, by name,
  // with their marks: same "staff" prefix rule, never persisted.
  staffGradingScheme: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "grading-scheme"] as const,
  staffGradebook: (
    schoolId: string,
    userId: string,
    termId: string,
    classArmId: string,
    subjectId: string,
  ) => ["staff", schoolId, userId, "gradebook", termId, classArmId, subjectId] as const,

  // CP6b — report-card comments for one column. Comment text about a named
  // child is at least as sensitive as the marks beside it; same prefix, same
  // refusal to persist.
  staffSubjectComments: (
    schoolId: string,
    userId: string,
    termId: string,
    classArmId: string,
    subjectId: string,
  ) => ["staff", schoolId, userId, "comments", termId, classArmId, subjectId] as const,

  // CP7 — the form teacher's overall comment, and the class list. Same "staff"
  // prefix rule: a roster is every child in the class by name, and a form
  // comment is a judgement about one of them.
  staffFormComments: (schoolId: string, userId: string, termId: string, classArmId: string) =>
    ["staff", schoolId, userId, "form-comments", termId, classArmId] as const,
  staffRoster: (schoolId: string, userId: string, classArmId: string) =>
    ["staff", schoolId, userId, "roster", classArmId] as const,

  // CP7 — lesson notes. A teacher's own work rather than student data, but the
  // same prefix rule applies without exception: a staff key that did not start
  // with "staff" would become persistable, and the rule is only usable if it
  // has no "except when" attached to it.
  staffLessonPlans: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "lesson-plans"] as const,
  staffLessonPlan: (schoolId: string, userId: string, id: string) =>
    ["staff", schoolId, userId, "lesson-plans", id] as const,

  // CP7 — curriculum documents and the teacher's own profile.
  staffCurriculum: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "curriculum"] as const,
  staffProfile: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "profile"] as const,

  // CP7 — the teacher's own timetable, and the staff calendar. The calendar
  // carries no personal data and the FAMILY copies of it are persistable, but
  // these are staff keys and the prefix rule has no exceptions: one exception
  // is how the rule stops being checkable.
  staffTimetable: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "timetable"] as const,
  staffCalendar: (schoolId: string, userId: string, from: string, to: string) =>
    ["staff", schoolId, userId, "calendar", from, to] as const,
  // Every month of the calendar at once — what an event write invalidates, since
  // an event can span a month boundary and the months on screen are separate
  // cache entries.
  staffCalendarAll: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "calendar"] as const,
  staffSchoolEvents: (schoolId: string, userId: string, from: string, to: string) =>
    ["staff", schoolId, userId, "calendar-events", from, to] as const,

  // CP4 — the owner/admin school overview: enrolment, fees and attendance for
  // the whole school. Never persisted, like every staff key.
  staffAdminDashboard: (schoolId: string, userId: string, termId: string) =>
    ["staff", schoolId, userId, "admin-dashboard", termId] as const,
  staffSetupState: (schoolId: string, userId: string) => ["staff", schoolId, userId, "setup-state"] as const,
  staffSchoolPlan: (schoolId: string, userId: string) => ["staff", schoolId, userId, "school-plan"] as const,
  // The batch list only: counts and status, never a PIN.
  staffResultPinBatches: (schoolId: string, userId: string) => ["staff", schoolId, userId, "result-pin-batches"] as const,
  staffTermOptions: (schoolId: string, userId: string) => ["staff", schoolId, userId, "term-options"] as const,
  // Question bank, exam papers and online exams (pre-build audit, 2026-10-14).
  // Unreleased exam content: staff-prefixed, so never persisted.
  staffQuestionScope: (schoolId: string, userId: string) => ["staff", schoolId, userId, "question-scope"] as const,
  staffQuestions: (schoolId: string, userId: string, filter: string) =>
    ["staff", schoolId, userId, "questions", filter] as const,
  staffExamPapers: (schoolId: string, userId: string) => ["staff", schoolId, userId, "exam-papers"] as const,
  staffExamPaper: (schoolId: string, userId: string, paperId: string) =>
    ["staff", schoolId, userId, "exam-paper", paperId] as const,
  staffCbtExams: (schoolId: string, userId: string) => ["staff", schoolId, userId, "cbt-exams"] as const,
  staffCbtExam: (schoolId: string, userId: string, examId: string) =>
    ["staff", schoolId, userId, "cbt-exam", examId] as const,
  staffCbtResults: (schoolId: string, userId: string, examId: string) =>
    ["staff", schoolId, userId, "cbt-results", examId] as const,

  // CP4b — report card approval. The completeness report is keyed "current"
  // when no term is named, matching the endpoint's own default.
  staffCompleteness: (schoolId: string, userId: string, termId: string | null) =>
    ["staff", schoolId, userId, "completeness", termId ?? "current"] as const,
  staffReportCardBoard: (schoolId: string, userId: string, termId: string, classArmId: string) =>
    ["staff", schoolId, userId, "report-card-board", termId, classArmId] as const,

  // CP4c — student records. A student's full record (address, phone, medical
  // notes) is the most sensitive thing staff mobile reads; the "staff" prefix
  // is what keeps it off the disk.
  staffStudents: (schoolId: string, userId: string, search: string) =>
    ["staff", schoolId, userId, "students", search] as const,
  // CP9a — parents. A guardian record carries contact details; staff prefix,
  // never persisted, like the student record beside it.
  staffGuardianSearch: (schoolId: string, userId: string, search: string) =>
    ["staff", schoolId, userId, "guardians", "search", search] as const,
  staffGuardian: (schoolId: string, userId: string, id: string) =>
    ["staff", schoolId, userId, "guardians", id] as const,
  staffStudent: (schoolId: string, userId: string, id: string) =>
    ["staff", schoolId, userId, "student", id] as const,
  staffClassArms: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "class-arms"] as const,
  staffAdmissionNumbers: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "admission-numbers"] as const,

  // CP4d — the per-teacher activity report. Every fetch is an AUDITED read
  // (D35), so the query using this key never refetches in the background.
  staffTeacherActivity: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "teacher-activity"] as const,
  // Phase 9 / CP1.3b — the analytics summaries. They name students (top and
  // bottom, often absent, joiners), so staff-prefixed and never persisted.
  staffAcademicReport: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "report-academic"] as const,
  staffAttendanceReport: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "report-attendance"] as const,
  staffEnrolmentReport: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "report-enrolment"] as const,

  // Announcements on the staff side. NOT persisted, like every staff key: a
  // STAFF-audience announcement is internal ("the head is away, do not admit
  // the contractor"), and the sent list names who sent what.
  staffAnnouncements: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "announcements"] as const,
  staffAnnouncementFeed: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "announcement-feed"] as const,
  // Phase 9 / CP8.3: how many parents "Also email families" would reach.
  staffAnnouncementEmailPreview: (schoolId: string, userId: string, audience: string, classArmId: string | null) =>
    ["staff", schoolId, userId, "announcement-email-preview", audience, classArmId ?? ""] as const,

  // Homework a teacher set. Staff-prefixed like everything else on that side:
  // the list names classes and the work set for them.
  staffHomework: (schoolId: string, userId: string, classArmId: string) =>
    ["staff", schoolId, userId, "homework", classArmId] as const,

  // Behaviour records. Staff-prefixed like everything else on that side, and
  // here the prefix earns its keep more than anywhere: this is a named child
  // and a written judgement about their conduct, and mayPersistQuery refuses
  // to write it to a shared staffroom handset's storage.
  staffBehaviour: (schoolId: string, userId: string, studentId: string) =>
    ["staff", schoolId, userId, "behaviour", studentId] as const,
  // Phase 9 / CP2.1 — the school's points categories. Not sensitive on its
  // own, but staff-prefixed like every staff key, so the lock teardown and the
  // persister treat it the same way.
  staffBehaviourSettings: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "behaviour-settings"] as const,
  // Phase 9 / CP2.2 — the incident form's classes, staff names and a class
  // roster. Names of children and colleagues, so staff-prefixed.
  staffIncidentOptions: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "incident-options"] as const,
  staffIncidentRoster: (schoolId: string, userId: string, armId: string) =>
    ["staff", schoolId, userId, "incident-roster", armId] as const,
  // Phase 9 / CP2.3 — discipline actions: one child's, and the decisions
  // queue. A named child and the reason for a sanction, so staff-prefixed.
  staffDiscipline: (schoolId: string, userId: string, studentId: string) =>
    ["staff", schoolId, userId, "discipline", studentId] as const,
  staffDisciplineQueue: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "discipline-queue"] as const,
  // Phase 9 / CP3.1 — health records (Health officer, owner, admin) and the
  // "For teachers" note. Health data, so staff-prefixed and never persisted.
  staffHealthList: (schoolId: string, userId: string, q: string, armId: string) =>
    ["staff", schoolId, userId, "health-list", q, armId] as const,
  staffHealthProfile: (schoolId: string, userId: string, studentId: string) =>
    ["staff", schoolId, userId, "health", studentId] as const,
  staffHealthNote: (schoolId: string, userId: string, studentId: string) =>
    ["staff", schoolId, userId, "health-note", studentId] as const,
  staffClassHealthNotes: (schoolId: string, userId: string, armId: string) =>
    ["staff", schoolId, userId, "class-health-notes", armId] as const,
  // Phase 9 / CP3.3 — one child's sickbay visits.
  // Phase 9 / CP11.2 — the sickbay's visits for one Lagos day.
  staffSickbayDay: (schoolId: string, userId: string, day: string) => ["staff", schoolId, userId, "sickbay-day", day] as const,
  // Phase 9 / CP11.2 — behaviour incidents this person may see.
  staffBehaviourIncidents: (schoolId: string, userId: string) => ["staff", schoolId, userId, "behaviour-incidents"] as const,
  staffSickbayVisits: (schoolId: string, userId: string, studentId: string) =>
    ["staff", schoolId, userId, "sickbay", studentId] as const,
  // Phase 9 / CP5.3 — bus routes and a route's day: children's names and
  // parents' phones, so staff-prefixed.
  // Phase 9 / CP6b.2 — boarding. Staff-prefixed, so never kept on the phone.
  staffBoardingHostels: (schoolId: string, userId: string) => ["staff", schoolId, userId, "boarding-hostels"] as const,
  // Phase 9 / CP8.1 — the conversations addressed or passed to this person.
  staffMessages: (schoolId: string, userId: string, box: "OPEN" | "CLOSED" | "FLAGGED") => ["staff", schoolId, userId, "messages", box] as const,
  staffMessage: (schoolId: string, userId: string, threadId: string) => ["staff", schoolId, userId, "message", threadId] as const,
  // Phase 9 / CP11.1 — parents found by name for "Write to a parent". Never
  // on disk ("staff" prefix): the rows carry a parent's phone number.
  staffMessageGuardians: (schoolId: string, userId: string, q: string) => ["staff", schoolId, userId, "message-guardians", q] as const,
  staffBoardingBoarders: (schoolId: string, userId: string, hostelId: string) =>
    ["staff", schoolId, userId, "boarding-boarders", hostelId] as const,
  staffBoardingVisits: (schoolId: string, userId: string, hostelId: string, day: string) =>
    ["staff", schoolId, userId, "boarding-visits", hostelId, day] as const,
  // CP11.2: "open" (waiting, approved, out) or "past" (refused, back, cancelled).
  staffBoardingExeats: (schoolId: string, userId: string, hostelId: string, view: "open" | "past" = "open") =>
    ["staff", schoolId, userId, "boarding-exeats", hostelId, view] as const,
  staffTransportRoutes: (schoolId: string, userId: string) =>
    ["staff", schoolId, userId, "transport-routes"] as const,
  staffTransportDaily: (schoolId: string, userId: string, routeId: string, date: string) =>
    ["staff", schoolId, userId, "transport-daily", routeId, date] as const,
  // Phase 9 / CP6.2 — the library's loans and the lending desk's look-ups:
  // children's names and books, so staff-prefixed.
  staffLibraryLoans: (schoolId: string, userId: string, state: string) =>
    ["staff", schoolId, userId, "library-loans", state] as const,
  staffLibraryCopy: (schoolId: string, userId: string, accessionNumber: string) =>
    ["staff", schoolId, userId, "library-copy", accessionNumber] as const,
  // Phase 9 / CP4.1 — handed-in work for one homework item, and one student's attempts.
  staffAssignmentMarking: (schoolId: string, userId: string, homeworkId: string) =>
    ["staff", schoolId, userId, "assignment-marking", homeworkId] as const,
  staffStudentWork: (schoolId: string, userId: string, homeworkId: string, studentId: string) =>
    ["staff", schoolId, userId, "student-work", homeworkId, studentId] as const,
} as const;
