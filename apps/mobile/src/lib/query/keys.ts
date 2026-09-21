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

  me: ["me"] as const,
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

  // CP4 — the owner/admin school overview: enrolment, fees and attendance for
  // the whole school. Never persisted, like every staff key.
  staffAdminDashboard: (schoolId: string, userId: string, termId: string) =>
    ["staff", schoolId, userId, "admin-dashboard", termId] as const,
} as const;
