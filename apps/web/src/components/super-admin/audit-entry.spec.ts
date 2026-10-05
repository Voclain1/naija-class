import { describe, expect, it } from "vitest";

import { describeAuditEntry } from "./audit-entry";

const d = (action: string, metadata: Record<string, unknown> | null = null) => describeAuditEntry({ action, metadata });

describe("describeAuditEntry", () => {
  it("says what changed, in words", () => {
    expect(d("platform_admin.schools.set-ai-enabled", { from: false, to: true })).toBe("Turned AI on");
    expect(d("platform_admin.schools.set-ai-enabled", { from: true, to: true })).toBe("Confirmed AI is on");
    expect(d("platform_admin.schools.set-ai-budget", { from: null, to: 750000 })).toBe("Set the AI budget to 750,000 tokens a month");
    expect(d("platform_admin.schools.set-ai-budget", { from: 750000, to: null })).toBe("Put the AI budget back to the platform default");
    expect(d("platform_admin.schools.suspend", { reason: "Unpaid" })).toBe("Suspended the school — “Unpaid”");
    expect(d("platform_admin.schools.delete", { studentCount: 1 })).toBe("Deleted the school and its 1 student");
    expect(d("platform_admin.owner-invitation.resend", { emailChanged: true })).toBe(
      "Sent a new owner invitation to a corrected address",
    );
    expect(d("platform_admin.schools.set-early-access", { from: null, to: "2026-10-07T00:00:00.000Z" })).toBe("Marked as early access");
  });

  it("copes with missing metadata", () => {
    expect(d("platform_admin.schools.suspend")).toBe("Suspended the school");
    expect(d("platform_admin.schools.delete")).toBe("Deleted the school");
  });

  it("shows an unknown action by its name rather than hiding it", () => {
    expect(d("platform_admin.something-new")).toBe("platform_admin.something-new");
  });
});
