import type { SmsSenderStatus } from "@school-kit/types";

// The sender name to put on a school's SMS, or undefined for the platform's
// own TERMII_SENDER_ID (docs/modules/school-identity.md slice 2). Only an
// APPROVED name counts: a REQUESTED or REJECTED one was never cleared by the
// networks, and an SMS sent under it would be dropped.
export function smsSenderFor(school: {
  smsSenderId: string | null;
  smsSenderStatus: SmsSenderStatus;
}): string | undefined {
  return school.smsSenderStatus === "APPROVED" && school.smsSenderId ? school.smsSenderId : undefined;
}
