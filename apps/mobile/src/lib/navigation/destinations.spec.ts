import { describe, expect, it } from "vitest";

import {
  groupDestinations,
  guardianDestinations,
  staffDestinations,
  studentDestinations,
  type StaffContext,
} from "./destinations";

// Who sees what in the menu and on the dashboard grid — one list, both views.

const base: StaffContext = {
  roles: [],
  permissions: [],
  formArms: [],
  teachesSubjects: false,
  webConfigured: true,
};

const TEACHER: StaffContext = {
  ...base,
  roles: [{ key: "teacher" }],
  permissions: ["assessment-score.create", "lesson-plan.create", "calendar-event.read"],
  formArms: [{ id: "arm-1", name: "JSS 2A" }],
  teachesSubjects: true,
};

const OWNER: StaffContext = { ...base, roles: [{ key: "owner" }], permissions: ["*"] };

const BURSAR: StaffContext = {
  ...base,
  roles: [{ key: "bursar" }],
  permissions: ["finance.dashboard.read", "finance.debtors.read", "calendar-event.read"],
};

const keys = (ctx: StaffContext) => staffDestinations(ctx).map((d) => d.key);

describe("a teacher", () => {
  it("gets the teaching jobs, their class and their profile", () => {
    expect(keys(TEACHER)).toEqual(
      expect.arrayContaining(["marks", "attendance-arm-1", "lesson-notes", "curriculum", "comments-arm-1", "classes", "timetable", "calendar", "profile"]),
    );
  });

  it("gets NONE of the school or money screens", () => {
    for (const key of ["approvals", "students", "reports", "collections", "debtors", "website"]) {
      expect(keys(TEACHER)).not.toContain(key);
    }
  });

  it("names each form class when there is more than one", () => {
    const labels = staffDestinations({
      ...TEACHER,
      formArms: [
        { id: "a", name: "JSS 2A" },
        { id: "b", name: "JSS 2B" },
      ],
    }).map((d) => d.label);
    expect(labels).toContain("Attendance · JSS 2A");
    expect(labels).toContain("Attendance · JSS 2B");
  });

  it("is not offered marks when the server lists no subject for them", () => {
    expect(keys({ ...TEACHER, teachesSubjects: false })).not.toContain("marks");
  });
});

describe("an owner", () => {
  it("gets the school, money and website — and no teaching screen", () => {
    // Holding "*" does not make an owner a teacher: /teacher-scope/* checks
    // the ROLE, so every teaching destination would fail for them.
    expect(keys(OWNER)).toEqual(
      expect.arrayContaining(["approvals", "students", "reports", "collections", "debtors", "calendar", "website"]),
    );
    for (const key of ["marks", "lesson-notes", "curriculum", "classes", "timetable", "profile"]) {
      expect(keys(OWNER)).not.toContain(key);
    }
  });

  it("does not get a website link when this build has no website address", () => {
    expect(keys({ ...OWNER, webConfigured: false })).not.toContain("website");
  });
});

describe("a bursar", () => {
  it("gets money and the calendar only", () => {
    expect(keys(BURSAR).sort()).toEqual(["calendar", "collections", "debtors"]);
  });
});

describe("families", () => {
  it("gives a parent their children and the calendar", () => {
    expect(guardianDestinations().map((d) => d.route)).toEqual(["/students", "/calendar"]);
  });

  it("gives a student every part of their own school work", () => {
    expect(studentDestinations().map((d) => d.route)).toEqual([
      "/me",
      "/me/results",
      "/me/attendance",
      "/me/fees",
      "/me/timetable",
      "/me/calendar",
      // Phase 7's tutor, present as an honest "coming soon" route so the
      // menu, the path and the expectation are all in place before it works.
      "/me/tutor",
    ]);
  });
});

describe("menu grouping", () => {
  it("orders groups consistently and drops empty ones", () => {
    const sections = groupDestinations(staffDestinations(OWNER)).map((s) => s.group);
    expect(sections).toEqual(["School", "Money", "Calendar", "Account"]);
  });

  it("never loses a destination while grouping", () => {
    for (const ctx of [TEACHER, OWNER, BURSAR]) {
      const flat = groupDestinations(staffDestinations(ctx)).flatMap((s) => s.items);
      expect(flat).toHaveLength(staffDestinations(ctx).length);
    }
  });

  it("gives every destination exactly one of a route or a website path", () => {
    for (const ctx of [TEACHER, OWNER, BURSAR]) {
      for (const d of staffDestinations(ctx)) {
        expect(Boolean(d.route) !== Boolean(d.web)).toBe(true);
      }
    }
  });
});
