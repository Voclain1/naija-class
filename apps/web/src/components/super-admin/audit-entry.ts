import type { PlatformAdminAuditEntryDto } from "@school-kit/types";

// One platform audit entry as a sentence an operator can read (platform-admin
// tools, slice 3). Pure, so it is unit-tested. An action this file does not
// know falls back to its raw name — never hidden, just less friendly.

const fmt = (n: number) => n.toLocaleString("en-NG");
const onOff = (v: unknown) => (v ? "on" : "off");

export function describeAuditEntry(e: Pick<PlatformAdminAuditEntryDto, "action" | "metadata">): string {
  const m = e.metadata ?? {};
  switch (e.action) {
    case "platform_admin.login":
      return "Signed in to the platform dashboard";
    case "platform_admin.schools.create":
      return "Created the school and invited its owner";
    case "platform_admin.schools.set-early-access":
      return m.to ? "Marked as early access" : "Removed early access";
    case "platform_admin.schools.set-ai-enabled":
      return m.from === m.to ? `Confirmed AI is ${onOff(m.to)}` : `Turned AI ${onOff(m.to)}`;
    case "platform_admin.schools.set-staff-mobile":
      return `Turned staff mobile ${onOff(m.to)}`;
    case "platform_admin.schools.set-ai-budget":
      return typeof m.to === "number"
        ? `Set the AI budget to ${fmt(m.to)} tokens a month`
        : "Put the AI budget back to the platform default";
    case "platform_admin.owner-invitation.resend":
      return m.emailChanged ? "Sent a new owner invitation to a corrected address" : "Sent a new owner invitation";
    case "platform_admin.owner-invitation.cancel":
      return "Cancelled the owner invitation";
    case "platform_admin.schools.suspend":
      return typeof m.reason === "string" ? `Suspended the school — “${m.reason}”` : "Suspended the school";
    case "platform_admin.schools.reactivate":
      return "Reactivated the school";
    case "platform_admin.schools.delete": {
      const students = typeof m.studentCount === "number" ? m.studentCount : null;
      return students === null
        ? "Deleted the school"
        : `Deleted the school and its ${students} student${students === 1 ? "" : "s"}`;
    }
    case "platform_admin.schools.list":
      return "Viewed the schools list";
    case "platform_admin.users.list":
      return "Viewed the staff list";
    case "platform_admin.paystack-setup.list":
      return "Viewed the Paystack setup queue";
    case "platform_admin.schools.deletion-check":
      return "Checked whether the school can be deleted";
    case "platform_admin.audit-log.read":
      return "Viewed this activity log";
    default:
      return e.action;
  }
}
