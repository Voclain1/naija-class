import { describe, expect, it } from "vitest";

import { queryKeys } from "./keys";
import { mayPersistQuery } from "./persist-policy";

// Gate 3 of CP2.
//
// This deliberately does NOT test mayPersistQuery in the abstract — there is
// already a spec for that, and it would pass just as happily if the attendance
// screens used a key the policy never sees. What is asserted here is that the
// ACTUAL keys those screens build resolve to non-persistable, and that the set
// of staff keys is exactly the ones enumerated below. A future staff key added
// without the "staff" prefix becomes silently persistable, which on a shared
// staffroom handset means a class register — real children, by name — written
// to plaintext AsyncStorage. This spec is what makes that a build failure
// instead of a discovery.

const SCHOOL = "school_abc";
const USER = "user_xyz";

const STAFF_KEYS: Record<string, readonly unknown[]> = {
  staffScope: queryKeys.staffScope(SCHOOL, USER),
  staffRegister: queryKeys.staffRegister(SCHOOL, USER, "arm_1", "2026-08-25"),
  // CP3 — collections. staffDebtors is the single most sensitive cache entry
  // in the app: every family in the school that owes money, by name and
  // amount.
  staffTermContext: queryKeys.staffTermContext(SCHOOL, USER),
  staffCollections: queryKeys.staffCollections(SCHOOL, USER, "term_1"),
  staffDebtors: queryKeys.staffDebtors(SCHOOL, USER, "term_1"),
  // CP6a — a gradebook column is a whole class, by name, with marks.
  staffGradingScheme: queryKeys.staffGradingScheme(SCHOOL, USER),
  staffGradebook: queryKeys.staffGradebook(SCHOOL, USER, "term_1", "arm_1", "subject_1"),
  staffSubjectComments: queryKeys.staffSubjectComments(SCHOOL, USER, "term_1", "arm_1", "subject_1"),
  // CP7 — a roster is every child in the class, by name.
  staffFormComments: queryKeys.staffFormComments(SCHOOL, USER, "term_1", "arm_1"),
  staffRoster: queryKeys.staffRoster(SCHOOL, USER, "arm_1"),
  staffLessonPlans: queryKeys.staffLessonPlans(SCHOOL, USER),
  staffLessonPlan: queryKeys.staffLessonPlan(SCHOOL, USER, "plan_1"),
  staffCurriculum: queryKeys.staffCurriculum(SCHOOL, USER),
  staffProfile: queryKeys.staffProfile(SCHOOL, USER),
  staffTimetable: queryKeys.staffTimetable(SCHOOL, USER),
  staffCalendar: queryKeys.staffCalendar(SCHOOL, USER, "2026-09-01", "2027-03-01"),
  // CP4 — whole-school figures.
  staffAdminDashboard: queryKeys.staffAdminDashboard(SCHOOL, USER, "term_1"),
  staffSetupState: queryKeys.staffSetupState(SCHOOL, USER),
  staffSchoolPlan: queryKeys.staffSchoolPlan(SCHOOL, USER),
  staffResultPinBatches: queryKeys.staffResultPinBatches(SCHOOL, USER),
  staffTermOptions: queryKeys.staffTermOptions(SCHOOL, USER),
  // Unreleased exam content.
  staffQuestionScope: queryKeys.staffQuestionScope(SCHOOL, USER),
  staffQuestions: queryKeys.staffQuestions(SCHOOL, USER, "level_1|subject_1"),
  staffExamPapers: queryKeys.staffExamPapers(SCHOOL, USER),
  staffExamPaper: queryKeys.staffExamPaper(SCHOOL, USER, "paper_1"),
  staffCbtExams: queryKeys.staffCbtExams(SCHOOL, USER),
  staffCbtExam: queryKeys.staffCbtExam(SCHOOL, USER, "exam_1"),
  staffCbtResults: queryKeys.staffCbtResults(SCHOOL, USER, "exam_1"),
  staffCompleteness: queryKeys.staffCompleteness(SCHOOL, USER, null),
  staffReportCardBoard: queryKeys.staffReportCardBoard(SCHOOL, USER, "term_1", "arm_1"),
  // CP4c — full student records, including medical notes.
  staffStudents: queryKeys.staffStudents(SCHOOL, USER, ""),
  staffStudent: queryKeys.staffStudent(SCHOOL, USER, "student_1"),
  staffCalendarAll: queryKeys.staffCalendarAll(SCHOOL, USER),
  staffSchoolEvents: queryKeys.staffSchoolEvents(SCHOOL, USER, "2026-10-01", "2026-10-31"),
  staffGuardianSearch: queryKeys.staffGuardianSearch(SCHOOL, USER, "Okafor"),
  staffGuardian: queryKeys.staffGuardian(SCHOOL, USER, "guardian_1"),
  staffPaymentLink: queryKeys.staffPaymentLink(SCHOOL, USER, "invoice_1"),
  staffExpenseCategories: queryKeys.staffExpenseCategories(SCHOOL, USER),
  staffReceipts: queryKeys.staffReceipts(SCHOOL, USER, ""),
  staffClassArms: queryKeys.staffClassArms(SCHOOL, USER),
  staffAdmissionNumbers: queryKeys.staffAdmissionNumbers(SCHOOL, USER),
  // CP4d — named colleagues' activity; an audited read.
  staffTeacherActivity: queryKeys.staffTeacherActivity(SCHOOL, USER),
  // Phase 9 / CP1.3b — the analytics summaries name students.
  staffAcademicReport: queryKeys.staffAcademicReport(SCHOOL, USER),
  staffAttendanceReport: queryKeys.staffAttendanceReport(SCHOOL, USER),
  staffEnrolmentReport: queryKeys.staffEnrolmentReport(SCHOOL, USER),
  // Announcements — the sent list names its sender, and a STAFF-audience
  // message is internal.
  staffAnnouncements: queryKeys.staffAnnouncements(SCHOOL, USER),
  staffAnnouncementFeed: queryKeys.staffAnnouncementFeed(SCHOOL, USER),
  staffHomework: queryKeys.staffHomework(SCHOOL, USER, ""),
  // A named child and a written judgement — the single most sensitive thing
  // the staff app caches.
  staffBehaviour: queryKeys.staffBehaviour(SCHOOL, USER, "student_1"),
  staffBehaviourSettings: queryKeys.staffBehaviourSettings(SCHOOL, USER),
  staffIncidentOptions: queryKeys.staffIncidentOptions(SCHOOL, USER),
  staffIncidentRoster: queryKeys.staffIncidentRoster(SCHOOL, USER, "arm_1"),
  staffDiscipline: queryKeys.staffDiscipline(SCHOOL, USER, "stu_1"),
  staffDisciplineQueue: queryKeys.staffDisciplineQueue(SCHOOL, USER),
  staffHealthList: queryKeys.staffHealthList(SCHOOL, USER, "", "all"),
  staffHealthProfile: queryKeys.staffHealthProfile(SCHOOL, USER, "stu_1"),
  staffHealthNote: queryKeys.staffHealthNote(SCHOOL, USER, "stu_1"),
  staffClassHealthNotes: queryKeys.staffClassHealthNotes(SCHOOL, USER, "arm_1"),
  staffSickbayVisits: queryKeys.staffSickbayVisits(SCHOOL, USER, "stu_1"),
  staffTransportRoutes: queryKeys.staffTransportRoutes(SCHOOL, USER),
  staffTransportDaily: queryKeys.staffTransportDaily(SCHOOL, USER, "route_1", "2026-10-17"),
  staffBoardingHostels: queryKeys.staffBoardingHostels(SCHOOL, USER),
  staffBoardingBoarders: queryKeys.staffBoardingBoarders(SCHOOL, USER, "hostel_1"),
  staffBoardingVisits: queryKeys.staffBoardingVisits(SCHOOL, USER, "hostel_1", "2026-10-17"),
  staffBoardingExeats: queryKeys.staffBoardingExeats(SCHOOL, USER, "hostel_1"),
  staffLibraryLoans: queryKeys.staffLibraryLoans(SCHOOL, USER, "OVERDUE"),
  staffLibraryCopy: queryKeys.staffLibraryCopy(SCHOOL, USER, "42"),
  staffAssignmentMarking: queryKeys.staffAssignmentMarking(SCHOOL, USER, "hw_1"),
  staffStudentWork: queryKeys.staffStudentWork(SCHOOL, USER, "hw_1", "stu_1"),
};

describe("staff query keys", () => {
  it.each(Object.entries(STAFF_KEYS))("%s is refused by the persister", (_name, key) => {
    expect(mayPersistQuery(key)).toBe(false);
  });

  it.each(Object.entries(STAFF_KEYS))("%s starts with the staff prefix", (_name, key) => {
    expect(key[0]).toBe("staff");
  });

  it.each(Object.entries(STAFF_KEYS))("%s is scoped to school and user", (_name, key) => {
    // Two staff accounts on one handset must not share a cache entry, and the
    // lock teardown drops the subtree by prefix.
    expect(key[1]).toBe(SCHOOL);
    expect(key[2]).toBe(USER);
  });

  it("every staff-prefixed key on the queryKeys object is covered above", () => {
    // Guards against a new staff key being added and quietly escaping this
    // spec: enumerate what queryKeys actually exposes rather than trusting the
    // table to have been updated.
    const built = Object.entries(queryKeys).flatMap(([name, value]) => {
      const key =
        typeof value === "function"
          ? (value as (...args: string[]) => readonly unknown[])(
              SCHOOL,
              USER,
              "arm_1",
              "2026-08-25",
            )
          : value;
      return key[0] === "staff" ? [name] : [];
    });
    expect(built.sort()).toEqual(Object.keys(STAFF_KEYS).sort());
  });

  it("the lock teardown predicate matches every staff key", () => {
    // session.tsx drops staff cache on lock with
    // `queryKey[0] === "staff"`. If a staff key ever failed that test it would
    // survive the lock and be readable after re-entry by someone else.
    for (const key of Object.values(STAFF_KEYS)) expect(key[0] === "staff").toBe(true);
  });

  it("guardian and student keys are unaffected by the staff prefix rule", () => {
    expect(mayPersistQuery(queryKeys.myAttendance)).toBe(true);
    expect(mayPersistQuery(queryKeys.students)).toBe(true);
  });
});
