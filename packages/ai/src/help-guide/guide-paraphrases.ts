// ---------------------------------------------------------------------------
// FD-5a — realistic paraphrase cases for guide search: questions in the words
// staff use, not the guide's own headings ("log in" where the guide says "sign
// in", "pupils", "scratch cards", "debtors", "roll call"). Each lists every
// section that would be a correct place to send the person. Used by the search
// spec as a measured floor, and by FD-5c's evals as a starting set.
//
// These are written by us, not taken from schools (F-12 supplies real support
// questions later). Adding a case that fails is the point: fix the search,
// do not drop the case.
// ---------------------------------------------------------------------------

export interface ParaphraseCase {
  readonly question: string;
  /** Any of these is a correct answer. */
  readonly accept: readonly string[];
}

const WEB_ADDRESS = "your-schools-web-address";
const PROBLEMS = "problems-and-questions";

export const GUIDE_PARAPHRASE_CASES: readonly ParaphraseCase[] = [
  // Signing in, in the words people use for it.
  { question: "my teacher cannot log in", accept: [PROBLEMS, WEB_ADDRESS, "step-7-invite-your-teachers-and-office-staff"] },
  { question: "where do staff log in", accept: [WEB_ADDRESS, "who-does-what-in-your-school"] },
  { question: "what is the login link for teachers", accept: [WEB_ADDRESS, "who-does-what-in-your-school"] },
  { question: "how do parents log in to see results", accept: ["what-parents-see", WEB_ADDRESS] },
  { question: "a parent forgot her password", accept: [PROBLEMS, "what-parents-see"] },
  { question: "it keeps asking me to choose a new password when I login", accept: [PROBLEMS] },
  { question: "turn on two factor authentication", accept: ["more-things-schoolkit-can-do"] },
  { question: "what is our school's url", accept: [WEB_ADDRESS] },
  // Students and classes.
  { question: "how do I add a new pupil", accept: ["step-4-add-your-students"] },
  { question: "upload my students from an excel sheet", accept: ["step-4-add-your-students"] },
  { question: "put the kids in their classes", accept: ["step-5-put-your-students-in-their-classes"] },
  { question: "move a child to another class", accept: ["step-5-put-your-students-in-their-classes"] },
  { question: "class shows no children", accept: [PROBLEMS, "step-5-put-your-students-in-their-classes"] },
  // Staff.
  { question: "create accounts for my teachers", accept: ["step-7-invite-your-teachers-and-office-staff"] },
  { question: "I lost the invite link for a teacher", accept: [PROBLEMS, "step-7-invite-your-teachers-and-office-staff"] },
  { question: "who is the class teacher for JSS 1", accept: ["step-8-choose-a-form-teacher-for-each-class"] },
  { question: "assign subjects to teachers", accept: ["step-9-say-who-teaches-what"] },
  { question: "teacher logs in but sees no classes", accept: [PROBLEMS, "step-9-say-who-teaches-what"] },
  { question: "what can the bursar see", accept: ["who-does-what-in-your-school"] },
  // Parents.
  { question: "invite parents to the portal", accept: ["step-10-add-parents"] },
  { question: "parent did not receive the invitation email", accept: [PROBLEMS, "step-10-add-parents"] },
  // Money.
  { question: "set up tuition for the term", accept: ["step-6-set-your-school-fees"] },
  { question: "send bills to parents", accept: ["billing-parents-for-school-fees"] },
  { question: "generate invoices for every class", accept: ["billing-parents-for-school-fees"] },
  { question: "record a cash payment", accept: ["when-a-parent-pays-at-the-school"] },
  { question: "a parent paid by bank transfer", accept: ["when-a-parent-pays-at-the-school", "letting-parents-pay-online"] },
  { question: "list of debtors who are owing", accept: ["following-up-unpaid-fees"] },
  { question: "remind parents who have not paid", accept: ["following-up-unpaid-fees"] },
  { question: "can parents pay with their atm card", accept: ["letting-parents-pay-online", PROBLEMS] },
  { question: "pay staff salaries", accept: ["more-things-schoolkit-can-do"] },
  // Daily jobs.
  { question: "mark attendance", accept: ["taking-the-daily-register"] },
  { question: "do the morning roll call", accept: ["taking-the-daily-register"] },
  { question: "send an sms to all parents", accept: ["sending-a-message-to-parents-or-staff", PROBLEMS] },
  { question: "broadcast a message to staff", accept: ["sending-a-message-to-parents-or-staff"] },
  { question: "add the mid-term break dates", accept: ["the-school-calendar"] },
  // Results.
  { question: "enter CA and exam marks", accept: ["entering-scores"] },
  { question: "print report sheets", accept: ["making-the-report-cards"] },
  { question: "publish results so parents can see them", accept: ["releasing-results-to-parents"] },
  { question: "scratch cards for checking results", accept: ["result-pin-cards"] },
  { question: "change the grading to WAEC grades", accept: ["already-done-for-you"] },
  // New term and session.
  { question: "start second term", accept: ["a-new-term"] },
  { question: "promote students to the next class", accept: ["a-new-session"] },
  { question: "begin a new academic year", accept: ["a-new-session"] },
  // Getting help.
  { question: "whatsapp number for support", accept: ["getting-help", "getting-started-with-schoolkit"] },
];

/**
 * Written after the search was tuned on the cases above, and NOT tuned on.
 * Reported as a separate number, so the tuned figure is not mistaken for how
 * the search does on questions it has not seen.
 */
export const GUIDE_PARAPHRASE_HOLDOUT: readonly ParaphraseCase[] = [
  { question: "how do I sign in to the staff portal", accept: [WEB_ADDRESS, "who-does-what-in-your-school"] },
  { question: "teachers can't access the system", accept: [PROBLEMS, WEB_ADDRESS, "step-7-invite-your-teachers-and-office-staff"] },
  { question: "add students one by one", accept: ["step-4-add-your-students"] },
  { question: "import learners from a csv file", accept: ["step-4-add-your-students"] },
  { question: "student not showing in the register", accept: [PROBLEMS, "step-5-put-your-students-in-their-classes", "taking-the-daily-register"] },
  { question: "set the fees for JSS 3", accept: ["step-6-set-your-school-fees"] },
  { question: "print a receipt for a fee payment", accept: ["when-a-parent-pays-at-the-school"] },
  { question: "parents paying online with paystack", accept: ["letting-parents-pay-online"] },
  { question: "send fee reminders", accept: ["following-up-unpaid-fees"] },
  { question: "who can enter scores", accept: ["entering-scores", "who-does-what-in-your-school"] },
  { question: "approve the report cards", accept: ["making-the-report-cards", "releasing-results-to-parents"] },
  { question: "sell result checker pins to parents", accept: ["result-pin-cards"] },
  { question: "end of session promotion", accept: ["a-new-session"] },
  { question: "add holidays to the calendar", accept: ["the-school-calendar"] },
  { question: "post news on the school website", accept: ["your-schools-website"] },
  { question: "give a staff member admin access", accept: ["step-7-invite-your-teachers-and-office-staff", "who-does-what-in-your-school"] },
  { question: "a parent wants their account deleted", accept: [PROBLEMS] },
  { question: "it says could not reach the server", accept: [PROBLEMS] },
  { question: "make a teacher the form master of a class", accept: ["step-8-choose-a-form-teacher-for-each-class"] },
  { question: "what does SchoolKit set up for me automatically", accept: ["already-done-for-you"] },
];

/**
 * Questions the guide does NOT answer (FD-5c's honest-fallback cases). The
 * search still returns sections for every one of them: measured 2026-11-08,
 * their best scores (2.9–5.6) overlap the best scores of answerable questions
 * (from 4.0), so no score threshold can say "not covered". Saying so is the
 * prompt's job, and FD-5c's evals must show it does, without inventing steps,
 * features or citations.
 */
export const GUIDE_UNANSWERABLE_CASES: readonly string[] = [
  "how do I export my accounts to QuickBooks",
  "what is the current VAT rate in Nigeria",
  "can SchoolKit register my students for WAEC",
  "how do I connect a biometric fingerprint scanner",
  "does SchoolKit work with Moodle",
  "how much does a school bus cost",
  "can I change the colour of the menu to purple",
  "how do I install SchoolKit on my own server",
  "how do I set up a staff loan scheme",
  "which bank gives the best interest rate",
];
