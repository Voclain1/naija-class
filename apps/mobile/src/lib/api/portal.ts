import type {
  GuardianLoginInput,
  GuardianLoginResponse,
  PaystackInitResponseDto,
  PortalInvoiceListResponse,
  PortalPaymentDto,
  PortalStudentDto,
  PortalStudentListResponse,
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
    { method: "POST" },
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
