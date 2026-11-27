import { describe, expect, it } from "vitest";

import { resolveDashboardActions } from "./dashboard-actions";

// The gating is the whole point: a button that 403s on arrival is worse than
// no button. These cases mirror the three real principals that reach the admin
// shell (owner, admin, bursar) rather than hypothetical permission sets.

const BURSAR = [
  "invoice.read",
  "invoice.issue",
  "payment.read",
  "payment.record",
  "finance.debtors.read",
  "finance.dashboard.read",
];

describe("dashboard header quick actions", () => {
  it("gives an owner every shortcut, via the * wildcard", () => {
    // An owner's grant is literally ["*"] — verified live at /auth/me, which
    // returns exactly one permission for an owner. A gate that looked for the
    // specific strings would hide every button from the one role that can do
    // everything.
    const actions = resolveDashboardActions(["*"]);
    expect(actions.map((a) => a.key)).toEqual([
      "take-attendance",
      "record-payment",
      "add-student",
      "enter-scores",
      "report-cards",
      "students",
      "messages",
      "announcements",
    ]);
  });

  it("gives a bursar Record payment only", () => {
    // Bursar's real grant holds payment.record but neither insight.read nor
    // student.create, so this is the gate doing actual work rather than
    // decorating a role that already has everything.
    const actions = resolveDashboardActions(BURSAR);
    expect(actions.map((a) => a.key)).toEqual(["record-payment"]);
  });

  it("gives an admin the daily tasks covered by their explicit grants", () => {
    const actions = resolveDashboardActions([
      "attendance.read",
      "payment.record",
      "student.create",
      "assessment-score.create",
    ]);
    expect(actions.map((a) => a.key)).toEqual(["take-attendance", "record-payment", "add-student", "enter-scores"]);
  });

  it("returns nothing for a permission set that admits none of them", () => {
    expect(resolveDashboardActions(["dashboard.read"])).toEqual([]);
  });

  it("keeps Take attendance as the only primary action", () => {
    const actions = resolveDashboardActions(["*"]);
    const primary = actions.filter((a) => a.emphasis === "primary");
    expect(primary.map((a) => a.key)).toEqual(["take-attendance"]);
  });

  it("points every action at a real admin-reachable route", () => {
    // Destinations confirmed against the app: /finance/invoices exists (the
    // per-invoice page inside it carries the Record payment form),
    // /insights is the shipped admin insights page, and
    // /students/intake is the single front door for every student-add method.
    const byKey = Object.fromEntries(resolveDashboardActions(["*"]).map((a) => [a.key, a.href]));
    expect(byKey["take-attendance"]).toBe("/teacher/attendance");
    expect(byKey["record-payment"]).toBe("/finance/payments/record");
    expect(byKey["add-student"]).toBe("/students/intake");
    expect(byKey["enter-scores"]).toBe("/gradebook");
    expect(byKey["students"]).toBe("/students");
    expect(byKey["report-cards"]).toBe("/report-cards");
    expect(byKey["messages"]).toBe("/messages");
    expect(byKey["announcements"]).toBe("/announcements");
  });

  it("labels attendance plainly and hides modules a school switched off", () => {
    const labels = Object.fromEntries(resolveDashboardActions(["*"]).map((a) => [a.key, a.label]));
    expect(labels["take-attendance"]).toBe("Attendance");
    expect(labels["record-payment"]).toBe("Payments");
    const noComms = resolveDashboardActions(["*"], ["attendance", "fees", "students", "results"]);
    expect(noComms.map((a) => a.key)).not.toContain("messages");
    expect(noComms.map((a) => a.key)).not.toContain("announcements");
  });
});
