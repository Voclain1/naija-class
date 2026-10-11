import { z } from "zod";

// The school's own SMS sender name (docs/modules/school-identity.md slice 2).
//
// A sender name is approved by MTN, Airtel, Glo and 9mobile against the
// school's CAC registration, so a school cannot switch one on for itself: it
// asks, the platform operator submits the request and records the outcome, and
// only an APPROVED name is ever sent. Until then the school's SMS go out under
// SchoolKit's name, with the school's name at the start of the message.

export type SmsSenderStatus = "NONE" | "REQUESTED" | "APPROVED" | "REJECTED";

// 3 to 11 letters and digits, at least one letter: the networks' rule for an
// alphanumeric sender. No spaces or punctuation. The database CHECKs the same.
export const SMS_SENDER_ID_PATTERN = /^(?=.*[A-Za-z])[A-Za-z0-9]{3,11}$/;

// POST /schools/me/sms-sender — owner or admin asks for a sender name.
export const requestSmsSenderSchema = z.object({
  senderId: z
    .string()
    .trim()
    .regex(
      SMS_SENDER_ID_PATTERN,
      "Use 3 to 11 letters and numbers, with at least one letter and no spaces.",
    ),
});

export type RequestSmsSenderInput = z.infer<typeof requestSmsSenderSchema>;

// GET /schools/me/sms-sender and the POST's response.
export interface SmsSenderDto {
  senderId: string | null;
  status: SmsSenderStatus;
  requestedAt: string | null;
  decidedAt: string | null;
}

// PATCH /platform-admin/schools/:schoolId/sms-sender — the operator records
// what the networks decided about a REQUESTED name.
export const platformAdminDecideSmsSenderSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
});

export type PlatformAdminDecideSmsSenderInput = z.infer<typeof platformAdminDecideSmsSenderSchema>;

export interface PlatformAdminDecideSmsSenderResponse {
  schoolId: string;
  senderId: string;
  status: SmsSenderStatus;
}
