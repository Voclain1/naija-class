import { describe, expect, it } from "vitest";

import { alertInAppRoute, lastDigits, type AlertRouteContext } from "./messages";

const all: AlertRouteContext = { canApprove: true, canCheckTermHealth: true, canReadMessages: true, canOverseeMessages: true };
const none: AlertRouteContext = { canApprove: false, canCheckTermHealth: false, canReadMessages: false, canOverseeMessages: false };

describe("lastDigits", () => {
  it("keeps the last four digits only", () => {
    expect(lastDigits("+234 803 123 4567")).toBe("4567");
    expect(lastDigits("12")).toBe("12");
  });
});

describe("alertInAppRoute (CP11.1)", () => {
  it("opens the message alerts in the app's inbox", () => {
    expect(alertInAppRoute("unread_messages", all)).toBe("/staff/messages");
    expect(alertInAppRoute("flagged_messages", all)).toBe("/staff/messages?box=FLAGGED");
  });

  it("keeps the earlier in-app alerts", () => {
    expect(alertInAppRoute("pending_report_card_approval", all)).toBe("/staff/approvals");
    expect(alertInAppRoute("term_health", all)).toBe("/staff/reports");
  });

  it("sends website work to the website, and nothing to someone without the permission", () => {
    expect(alertInAppRoute("new_admission_applications", all)).toBeNull();
    expect(alertInAppRoute("overdue_fees", all)).toBeNull();
    expect(alertInAppRoute("pending_staff_invitations", all)).toBeNull();
    for (const type of ["unread_messages", "flagged_messages", "pending_report_card_approval", "term_health"] as const) {
      expect(alertInAppRoute(type, none)).toBeNull();
    }
  });
});
