import type {
  FamilyLibraryDto,
  PortalStudentTransportDto,
  PortalBankDetailsResponse,
  FamilyTimetableDto,
  GuardianForgotPasswordInput,
  GuardianForgotPasswordResponse,
  GuardianLoginInput,
  GuardianLoginResponse,
  PaystackInitResponseDto,
  PortalInvoiceListResponse,
  PortalPaymentDto,
  PortalStudentDto,
  PortalStudentListResponse,
  ReleasedResultDetailDto,
  ReleasedResultListResponse,
  StudentPortalStatusDto,
  IssueStudentInvitationResponse,
  DeactivateStudentPortalResponse,
  CalendarResponse,
} from "@school-kit/types";
import type {
  AnnouncementFeedResponse,
  HomeworkFeedResponse,
  PortalDisciplineNoticeListResponse,
  HealthDocumentUrlDto,
  PortalHealthProfileDto,
  PortalSickbayVisitListResponse,
  FamilyAssignmentListResponse,
  AssignmentFileUrlDto,
} from "@school-kit/types";

import { apiFetch } from "./client";

// Typed bindings for the guardian portal API.
//
// EVERY endpoint here already exists and is in production — this module adds
// no server surface. That is the point of running guardian mobile before the
// student principal (phase-6.md §3): it proves the slice-1 foundation against
// a real backend without also debugging new endpoints.
//
// A note on who calls these: PortalAuthController's header comment says the
// portal endpoints are called "ONLY by apps/portal's own Next.js server-side
// proxy route, never directly by a browser", with CORS_ORIGIN_PORTAL as
// defence in depth. apps/mobile is now a SECOND caller, and it calls them
// DIRECTLY. That is correct rather than a violation: ADR-002 assigns mobile
// `Authorization: Bearer` with no cookie and no proxy, and CORS is a browser
// concept that does not apply to a native runtime. The API needs no change;
// the controller comments do, and are updated in this slice.

export function guardianLogin(
  input: GuardianLoginInput,
): Promise<GuardianLoginResponse> {
  return apiFetch<GuardianLoginResponse>("/portal/login", {
    method: "POST",
    body: input,
    // A failed login is a 401 by design. Firing the unauthorized listener
    // here would tear down a session the user is in the middle of creating.
    notifyOnUnauthorized: false,
  });
}

/** Starts the existing guardian recovery flow without exposing account existence. */
export function guardianForgotPassword(
  input: GuardianForgotPasswordInput,
): Promise<GuardianForgotPasswordResponse> {
  return apiFetch<GuardianForgotPasswordResponse>("/portal/forgot-password", {
    method: "POST",
    body: input,
    notifyOnUnauthorized: false,
  });
}

export function listStudents(): Promise<PortalStudentListResponse> {
  return apiFetch<PortalStudentListResponse>("/portal/students");
}

export function getStudent(studentId: string): Promise<PortalStudentDto> {
  return apiFetch<PortalStudentDto>(
    `/portal/students/${encodeURIComponent(studentId)}`,
  );
}

export function listInvoices(
  studentId: string,
): Promise<PortalInvoiceListResponse> {
  return apiFetch<PortalInvoiceListResponse>(
    `/portal/students/${encodeURIComponent(studentId)}/invoices`,
  );
}

/**
 * Start a Paystack checkout. Returns the hosted-checkout URL to open.
 *
 * This is the app's only money-mutating call, and it is a MUTATION in the
 * TanStack sense — which is what makes phase-6.md D9 load-bearing rather than
 * theoretical. See src/lib/query/client.ts: mutations run with
 * networkMode "always" and retry 0, so with no connection this fails
 * immediately instead of being queued and replayed later against a balance
 * that may have moved.
 */
export function initiatePayment(
  studentId: string,
  invoiceId: string,
): Promise<PaystackInitResponseDto> {
  return apiFetch<PaystackInitResponseDto>(
    `/portal/students/${encodeURIComponent(studentId)}/invoices/${encodeURIComponent(invoiceId)}/pay`,
    // "app": Paystack returns the browser to a portal page that hands straight
    // back to schoolkit://payments/callback (see lib/payments/checkout.ts).
    { method: "POST", body: { returnTo: "app" } },
  );
}

/**
 * Poll the outcome of a checkout by its reference.
 *
 * The redirect back from Paystack is NOT authoritative — the Paystack webhook
 * is, and it lands on the API independently of whatever the user's browser
 * does. So the app treats the browser closing as "time to ask the server",
 * never as "the payment succeeded". apps/portal's own callback page polls for
 * the same reason.
 */
export function verifyPayment(reference: string): Promise<PortalPaymentDto> {
  return apiFetch<PortalPaymentDto>(
    `/portal/payments/${encodeURIComponent(reference)}`,
  );
}

// Phase 6 / Slice 4 — released results.
//
// These two ARE new server surface, unlike everything above: they shipped in
// the same slice (PR #184). Both hit ReleasedResultsService, the single place
// the RELEASED gate is applied, which is also what the student endpoints call
// — so a guardian and their child cannot be shown different things.
export function listResults(
  studentId: string,
): Promise<ReleasedResultListResponse> {
  return apiFetch<ReleasedResultListResponse>(
    `/portal/students/${encodeURIComponent(studentId)}/results`,
  );
}

export function getResult(
  studentId: string,
  termId: string,
): Promise<ReleasedResultDetailDto> {
  return apiFetch<ReleasedResultDetailDto>(
    `/portal/students/${encodeURIComponent(studentId)}/results/${encodeURIComponent(termId)}`,
  );
}

// Phase 8c / CP6b (D54) — redeem a result PIN on a locked term. One use of the
// card, once; the term then stays open here, in the portal and on the checker.
export function unlockResult(
  studentId: string,
  termId: string,
  pin: string,
): Promise<ReleasedResultDetailDto> {
  return apiFetch<ReleasedResultDetailDto>(
    `/portal/students/${encodeURIComponent(studentId)}/results/${encodeURIComponent(termId)}/unlock`,
    { method: "POST", body: { pin } },
  );
}

// Phase 6 — the guardian's control over their child's portal access.
//
// All three are guardian-authenticated and take the child's id in the path,
// because a guardian must name WHICH child. That is the exact opposite of the
// student surface, where naming anyone is impossible by design.
//
// D27: the server raises 404 for an unknown student and 403 for one this
// guardian is not linked to, rather than a silent no-op — so these can surface
// a real failure instead of appearing to succeed.
export function getPortalStatus(
  studentId: string,
): Promise<StudentPortalStatusDto> {
  return apiFetch<StudentPortalStatusDto>(
    `/portal/students/${encodeURIComponent(studentId)}/portal-status`,
  );
}

export function issueStudentInvitation(
  studentId: string,
): Promise<IssueStudentInvitationResponse> {
  return apiFetch<IssueStudentInvitationResponse>(
    `/portal/students/${encodeURIComponent(studentId)}/portal-invitation`,
    { method: "POST" },
  );
}

export function requestStudentPasswordReset(
  studentId: string,
): Promise<IssueStudentInvitationResponse> {
  return apiFetch<IssueStudentInvitationResponse>(
    `/portal/students/${encodeURIComponent(studentId)}/password-reset`,
    { method: "POST" },
  );
}

export function deactivateStudentPortal(
  studentId: string,
): Promise<DeactivateStudentPortalResponse> {
  return apiFetch<DeactivateStudentPortalResponse>(
    `/portal/students/${encodeURIComponent(studentId)}/deactivate`,
    { method: "POST" },
  );
}

/** Phase 8 / CP1 — the school calendar for a date window (the school comes from the session). */
/** The school's bank account for a transfer, when the school takes transfers. */
export function getBankDetails(): Promise<PortalBankDetailsResponse> {
  return apiFetch<PortalBankDetailsResponse>("/portal/bank-details");
}

export function getGuardianCalendar(window: { from: string; to: string }): Promise<CalendarResponse> {
  return apiFetch<CalendarResponse>(
    `/portal/calendar?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`,
  );
}

/** Phase 8 / CP4 — a linked child's PUBLISHED class timetable for the current term (§18 D39, D45). */
export function getChildTimetable(studentId: string): Promise<FamilyTimetableDto> {
  return apiFetch<FamilyTimetableDto>(`/portal/students/${encodeURIComponent(studentId)}/timetable`);
}

// Announcements the school has sent this family
// (docs/modules/announcements.md). Reading the feed does not mark anything —
// the screen marks each item once it is on screen, one call per item, so a
// parent who opens the list and scrolls past three messages has read three.

export function guardianAnnouncements(): Promise<AnnouncementFeedResponse> {
  return apiFetch<AnnouncementFeedResponse>("/portal/announcements");
}

export function markGuardianAnnouncementRead(id: string): Promise<void> {
  return apiFetch<void>(`/portal/announcements/${encodeURIComponent(id)}/read`, { method: "POST" });
}

// One child's homework (the-school-day.md Part B). Read-only: a parent sees
// what is due, and there is nothing to submit.
export function guardianHomework(studentId: string): Promise<HomeworkFeedResponse> {
  return apiFetch<HomeworkFeedResponse>(`/portal/students/${encodeURIComponent(studentId)}/homework`);
}

// Phase 9 / CP4.1 — what the child handed in, and the mark once the teacher
// released it. No answer text.
export function guardianAssignments(studentId: string): Promise<FamilyAssignmentListResponse> {
  return apiFetch<FamilyAssignmentListResponse>(`/portal/students/${encodeURIComponent(studentId)}/assignments`);
}

// Phase 9 / CP4.2 — a five-minute link to a file the child handed in.
export function guardianAssignmentFileUrl(studentId: string, fileId: string): Promise<AssignmentFileUrlDto> {
  return apiFetch<AssignmentFileUrlDto>(
    `/portal/students/${encodeURIComponent(studentId)}/assignment-files/${encodeURIComponent(fileId)}`,
  );
}

// Phase 9 / CP2.3 — approved suspensions and exclusions for one child. The
// response type has no field for a reason, a note or who proposed it.
export function guardianDisciplineNotices(studentId: string): Promise<PortalDisciplineNoticeListResponse> {
  return apiFetch<PortalDisciplineNoticeListResponse>(
    `/portal/students/${encodeURIComponent(studentId)}/discipline-notices`,
  );
}

// Phase 9 / CP3.1 — the child's health record, read-only.
export function guardianHealthRecord(studentId: string): Promise<PortalHealthProfileDto> {
  return apiFetch<PortalHealthProfileDto>(`/portal/students/${encodeURIComponent(studentId)}/health`);
}

// Phase 9 / CP3.3 — the child's sickbay visits: the time, whether they were
// sent home, and the details only when the school shared them.
export function guardianSickbayVisits(studentId: string): Promise<PortalSickbayVisitListResponse> {
  return apiFetch<PortalSickbayVisitListResponse>(`/portal/students/${encodeURIComponent(studentId)}/sickbay-visits`);
}

// Phase 9 / CP3.2 — a five-minute link to a vaccination's document.
export function guardianVaccinationDocumentUrl(studentId: string, vaccinationId: string): Promise<HealthDocumentUrlDto> {
  return apiFetch<HealthDocumentUrlDto>(
    `/portal/students/${encodeURIComponent(studentId)}/vaccinations/${encodeURIComponent(vaccinationId)}/document`,
  );
}

// Phase 9 / CP5.3 — the child's school bus this term; null with no place.
// Phase 9 / CP6.2 — the child's library books out (CP6-D6).
export function guardianLibrary(studentId: string): Promise<FamilyLibraryDto> {
  return apiFetch<FamilyLibraryDto>(`/portal/students/${encodeURIComponent(studentId)}/library`);
}

export function guardianTransport(studentId: string): Promise<PortalStudentTransportDto | null> {
  return apiFetch<PortalStudentTransportDto | null>(`/portal/students/${encodeURIComponent(studentId)}/transport`);
}
