import { describe, expect, it } from "vitest";

import { HOME, routeForNotification } from "./routes";

// Where a tapped notification takes you. The server sends only an opaque
// hint (N3 keeps names, grades and amounts out of the payload), so this is
// the whole of the mapping and worth pinning.

describe("routing a tapped notification", () => {
  it("sends the same hint to a different screen for each principal", () => {
    expect(routeForNotification({ screen: "results" }, "guardian")).toBe("/students");
    expect(routeForNotification({ screen: "results" }, "student")).toBe("/me/results");
    expect(routeForNotification({ screen: "results" }, "staff")).toBe("/staff/approvals");
  });

  it("takes a teacher to the work the reminder was about", () => {
    expect(routeForNotification({ screen: "attendance" }, "staff")).toBe("/staff");
    expect(routeForNotification({ screen: "gradebook" }, "staff")).toBe("/staff/gradebook");
  });

  it("takes a family to fees", () => {
    expect(routeForNotification({ screen: "fees" }, "guardian")).toBe("/students");
    expect(routeForNotification({ screen: "fees" }, "student")).toBe("/me/fees");
  });

  it("opens the announcement each principal can actually read", () => {
    // The server has sent this hint since the announcements rail shipped; it
    // fell through to HOME until these three screens existed.
    expect(routeForNotification({ screen: "announcements" }, "guardian")).toBe("/announcements");
    expect(routeForNotification({ screen: "announcements" }, "student")).toBe("/me/announcements");
    expect(routeForNotification({ screen: "announcements" }, "staff")).toBe("/staff/announcements");
  });

  it("goes HOME for an unknown or missing hint — a tap that does nothing reads as broken", () => {
    expect(routeForNotification({ screen: "something-new" }, "student")).toBe(HOME.student);
    expect(routeForNotification({}, "guardian")).toBe(HOME.guardian);
    expect(routeForNotification(undefined, "staff")).toBe(HOME.staff);
    expect(routeForNotification({ screen: 42 as unknown as string }, "staff")).toBe(HOME.staff);
  });

  it("routes nowhere when nobody is signed in — the tray keeps the notification", () => {
    expect(routeForNotification({ screen: "results" }, null)).toBeNull();
  });
});
