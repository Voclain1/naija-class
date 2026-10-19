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
  housesHostels: false,
  webConfigured: true,
};

const TEACHER: StaffContext = {
  ...base,
  roles: [{ key: "teacher" }],
  permissions: ["assessment-score.create", "lesson-plan.create", "calendar-event.read", "homework.create"],
  formArms: [{ id: "arm-1", name: "JSS 2A" }],
  teachesSubjects: true,
};

const OWNER: StaffContext = { ...base, roles: [{ key: "owner" }], permissions: ["*"] };

const BURSAR: StaffContext = {
  ...base,
  roles: [{ key: "bursar" }],
  // A bursar holds announcement.read (they read what the school sends; they
  // cannot send it) — see PHASE_3_BURSAR_PERMISSIONS.
  permissions: ["finance.dashboard.read", "finance.debtors.read", "calendar-event.read", "announcement.read", "homework.read"],
};

const keys = (ctx: StaffContext) => staffDestinations(ctx).map((d) => d.key);

describe("a teacher", () => {
  it("gets the teaching jobs, their class and their profile", () => {
    expect(keys(TEACHER)).toEqual(
      expect.arrayContaining(["marks", "attendance-arm-1", "lesson-notes", "curriculum", "comments-arm-1", "classes", "homework", "timetable", "calendar", "profile"]),
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

  it("gets the behaviour decisions queue; a teacher and a bursar never do", () => {
    expect(staffDestinations(OWNER).find((d) => d.key === "discipline")?.route).toBe("/staff/discipline");
    expect(keys(TEACHER)).not.toContain("discipline");
    expect(keys(BURSAR)).not.toContain("discipline");
  });

  it("gets the Store; so do the Storekeeper and a bursar holding store.read, and a teacher does not", () => {
    expect(staffDestinations(OWNER).find((d) => d.key === "store")?.route).toBe("/staff/store");
    const storekeeper = staffDestinations({ ...base, roles: [{ key: "storekeeper" }], permissions: ["store.read", "store.manage", "asset.read", "asset.manage"] });
    expect(storekeeper.map((d) => d.key)).toContain("store");
    for (const key of ["students", "approvals", "collections", "library"]) expect(storekeeper.map((d) => d.key)).not.toContain(key);
    expect(keys({ ...BURSAR, permissions: [...BURSAR.permissions, "store.read"] })).toContain("store");
    expect(keys(TEACHER)).not.toContain("store");
  });

  it("gets the Library; so does the Librarian, and nothing from school or money besides", () => {
    expect(staffDestinations(OWNER).find((d) => d.key === "library")?.route).toBe("/staff/library");
    const librarian = staffDestinations({ ...base, roles: [{ key: "librarian" }], permissions: ["library.read", "library.manage", "library.lend"] });
    expect(librarian.map((d) => d.key)).toContain("library");
    for (const key of ["students", "approvals", "collections", "discipline", "health"]) expect(librarian.map((d) => d.key)).not.toContain(key);
    expect(keys(TEACHER)).not.toContain("library");
    expect(keys(BURSAR)).not.toContain("library");
  });

  it("gets Health; so does the Health officer, and nothing from school or money besides", () => {
    expect(staffDestinations(OWNER).find((d) => d.key === "health")?.route).toBe("/staff/health");
    const officer = staffDestinations({ ...base, roles: [{ key: "health_officer" }], permissions: ["health.read", "health.manage", "sickbay.manage"] });
    expect(officer.map((d) => d.key)).toContain("health");
    for (const key of ["students", "approvals", "collections", "discipline"]) expect(officer.map((d) => d.key)).not.toContain(key);
    expect(keys(TEACHER)).not.toContain("health");
    expect(keys(BURSAR)).not.toContain("health");
  });

  it("gets Bus routes with transport.read; so does the bursar, and a teacher never does", () => {
    expect(staffDestinations(OWNER).find((d) => d.key === "transport")?.route).toBe("/staff/transport");
    expect(keys({ ...BURSAR, permissions: [...BURSAR.permissions, "transport.read"] })).toContain("transport");
    expect(keys(TEACHER)).not.toContain("transport");
  });

  it("does not get a website link when this build has no website address", () => {
    expect(keys({ ...OWNER, webConfigured: false })).not.toContain("website");
  });
});

describe("a bursar", () => {
  it("gets money, the calendar and the homework lookup only", () => {
    expect(keys(BURSAR).sort()).toEqual(["announcements", "calendar", "collections", "debtors", "homework"]);
  });

  it("never gets Result PINs, which are owner/admin only", () => {
    expect(keys(BURSAR)).not.toContain("result-pins");
    expect(keys(OWNER)).toContain("result-pins");
    expect(staffDestinations(OWNER).find((d) => d.key === "result-pins")?.route).toBe("/staff/report-cards/pins");
  });

  it("gets the read-only homework lookup, never the screen that sets work", () => {
    const homework = staffDestinations(BURSAR).find((d) => d.key === "homework");
    expect(homework?.route).toBe("/staff/homework/lookup");
    expect(staffDestinations(TEACHER).find((d) => d.key === "homework")?.route).toBe("/staff/homework");
  });
});

describe("families", () => {
  it("gives a parent their children, messages and the calendar", () => {
    expect(guardianDestinations().map((d) => d.route)).toEqual(["/students", "/announcements", "/messages", "/calendar", "/settings"]);
  });

  it("gives a student every part of their own school work", () => {
    expect(studentDestinations().map((d) => d.route)).toEqual([
      "/me",
      "/me/results",
      "/me/attendance",
      "/me/fees",
      "/me/homework",
      "/me/announcements",
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

describe("boarding (Phase 9 / CP6b.2)", () => {
  it("shows Boarding to admin, the House master, and a teacher who keeps a hostel — no one else", () => {
    expect(staffDestinations(OWNER).find((d) => d.key === "boarding")?.route).toBe("/staff/boarding");
    expect(keys({ ...base, roles: [{ key: "house_master" }], permissions: ["hostel.house"] })).toEqual(["boarding"]);
    const teacher = { ...TEACHER, permissions: [...TEACHER.permissions, "hostel.house"] };
    expect(keys(teacher)).not.toContain("boarding");
    expect(keys({ ...teacher, housesHostels: true })).toContain("boarding");
    expect(keys(BURSAR)).not.toContain("boarding");
  });
});

describe("messages (Phase 9 / CP8.1)", () => {
  it("shows Messages to whoever holds messages.read, and to no one else", () => {
    expect(keys({ ...base, roles: [{ key: "principal" }], permissions: ["messages.read", "messages.reply"] })).toEqual(["messages"]);
    expect(staffDestinations(OWNER).find((d) => d.key === "messages")?.route).toBe("/staff/messages");
    expect(keys({ ...base, roles: [{ key: "house_master" }], permissions: ["hostel.house"] })).not.toContain("messages");
  });
});

describe("Incidents (Phase 9 / CP11.2)", () => {
  it("is offered on behaviour.read, under Teaching for a teacher and School otherwise", () => {
    const teacher = staffDestinations({ ...TEACHER, permissions: [...TEACHER.permissions, "behaviour.read"] }).find((d) => d.key === "incidents");
    expect(teacher).toMatchObject({ route: "/staff/behaviour", group: "Teaching" });
    expect(staffDestinations(OWNER).find((d) => d.key === "incidents")).toMatchObject({ group: "School" });
    expect(keys(BURSAR)).not.toContain("incidents");
  });
});
