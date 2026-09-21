import type { AdminDashboardDto } from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "../api/client";
import { staffAdminDashboard } from "../api/staff-admin";
import { hasRole, isTeacher } from "../auth/roles";
import { webOrigin, webUrl } from "../web-handoff";
import { resetServerClock } from "./server-date";
import { TAB_CANDIDATES, visibleStaffTabs } from "./tabs";

// CP4a — the owner/admin foundations, and the bug they fix.
//
// Before this, a pure owner or admin who signed in was sent to
// /teacher-scope/me, which the server refuses without the teacher ROLE, and
// the first screen they saw said "We couldn't load your classes". These pin
// who is offered what, so that cannot come back.

const TEACHER = [{ key: "teacher" }];
const OWNER = [{ key: "owner" }];
const OWNER_WHO_TEACHES = [{ key: "owner" }, { key: "teacher" }];

describe("roles (D32)", () => {
  it("recognises a teacher by the role the server's own gate checks", () => {
    expect(isTeacher(TEACHER)).toBe(true);
    expect(isTeacher(OWNER_WHO_TEACHES)).toBe(true);
  });

  it("does NOT treat an owner as a teacher, whatever their permissions", () => {
    // An owner holds "*" permissions, but /teacher-scope/* checks the ROLE.
    // Treating "*" as "teacher" is exactly the bug CP4 fixes.
    expect(isTeacher(OWNER)).toBe(false);
    expect(isTeacher(undefined)).toBe(false);
    expect(isTeacher([])).toBe(false);
  });

  it("matches role keys exactly", () => {
    expect(hasRole([{ key: "teacher-assistant" }], "teacher")).toBe(false);
  });
});

describe("tab bar by person", () => {
  it("gives a teacher the full daily bar", () => {
    expect([...visibleStaffTabs(TEACHER)].sort()).toEqual(
      ["classes", "gradebook", "index", "lesson-notes"].sort(),
    );
  });

  it("gives an owner only what works for them — never a tab that can only fail", () => {
    // Marks, Classes and Notes all read /teacher-scope/*, which refuses an
    // owner. Offering them would put three broken screens one tap away.
    expect([...visibleStaffTabs(OWNER)]).toEqual(["index"]);
    // An owner holds "*", so report card approval — a head's job — is theirs.
    expect([...visibleStaffTabs(OWNER, ["*"])].sort()).toEqual(["approvals", "index"]);
  });

  it("does not give a plain teacher the approvals tab", () => {
    expect(visibleStaffTabs(TEACHER, ["assessment-score.create"]).has("approvals")).toBe(false);
  });

  it("gives an owner who also teaches the teacher's bar", () => {
    expect(visibleStaffTabs(OWNER_WHO_TEACHES).has("classes")).toBe(true);
  });

  it("only ever offers tab candidates, and never more than five (D29)", () => {
    for (const roles of [TEACHER, OWNER, OWNER_WHO_TEACHES, undefined]) {
      // Worst case: every permission, on every role combination.
      const visible = visibleStaffTabs(roles, ["*"]);
      for (const name of visible) expect(TAB_CANDIDATES).toContain(name);
      expect(visible.size).toBeLessThanOrEqual(5);
    }
  });
});

describe("web handoff (D36)", () => {
  it("builds an absolute website link from the configured origin", () => {
    expect(webUrl("/settings", "https://app.schoolkit.ng")).toBe("https://app.schoolkit.ng/settings");
    expect(webUrl("report-cards", "https://app.schoolkit.ng")).toBe(
      "https://app.schoolkit.ng/report-cards",
    );
  });

  it("strips a trailing slash so links never double up", () => {
    expect(webOrigin("https://app.schoolkit.ng/")).toBe("https://app.schoolkit.ng");
  });

  it("reports UNCONFIGURED rather than falling back to anything", () => {
    // This codebase has shipped "config in the repo, never set on the real
    // environment" four times. A localhost fallback would make the fifth a
    // button that silently opens nothing on a head teacher's phone.
    expect(webOrigin(undefined)).toBeNull();
    expect(webOrigin("")).toBeNull();
    expect(webUrl("/settings", null)).toBeNull();
  });

  it("refuses a value that is not a plain http(s) origin", () => {
    expect(webOrigin("app.schoolkit.ng")).toBeNull();
    expect(webOrigin("https://app.schoolkit.ng/some/path")).toBeNull();
    expect(webOrigin("javascript:alert(1)")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The overview binding. The fixture covers the fields the dashboard READS and
// is typed from the API's own DTO, so a server shape change on any of them
// fails typecheck here — the curriculum-crash rule.
type OverviewFields = Pick<
  AdminDashboardDto,
  "termId" | "termName" | "enrolled" | "fees" | "attendanceToday" | "outstanding" | "needsYouToday"
>;

const OVERVIEW: OverviewFields = {
  termId: "term-1",
  termName: "First Term",
  enrolled: { count: 412, previousTermCount: 398 },
  fees: { collected: 1_250_000_00, billed: 2_000_000_00, percent: 63 },
  attendanceToday: {
    date: "2026-09-21",
    presentCount: 380,
    absentCount: 20,
    totalMarked: 400,
    percentPresent: 95,
  },
  outstanding: { amount: 750_000_00, debtorCount: 41 },
  needsYouToday: [{ type: "pending_report_card_approval", count: 3, href: "/report-cards" }],
};

describe("school overview binding", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetServerClock();
    setTokenProvider(() => "test-token");
    fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify(OVERVIEW), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTokenProvider(() => null);
  });

  it("reads the same endpoint the website dashboard does, for one term", async () => {
    const result = await staffAdminDashboard("term-1");
    const [url] = fetchMock.mock.calls.at(-1) as unknown as [string];
    expect(new URL(url).pathname).toMatch(/\/dashboard$/);
    expect(new URL(url).searchParams.get("termId")).toBe("term-1");
    expect(result.enrolled.count).toBe(412);
    // Money arrives in kobo and stays in kobo: the phone never computes it.
    expect(result.fees.collected).toBe(125_000_000);
  });

  it("carries the alerts with the website path each one points at", async () => {
    const result = await staffAdminDashboard("term-1");
    expect(result.needsYouToday[0]).toEqual({
      type: "pending_report_card_approval",
      count: 3,
      href: "/report-cards",
    });
  });
});
