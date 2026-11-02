import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReportCardBoardResponse } from "@school-kit/types";

import { ReportCardRoster } from "./report-card-roster";

const roster: ReportCardBoardResponse["roster"] = {
  enrolledCount: 4,
  missingStudents: [{ id: "late", firstName: "Ada", middleName: null, lastName: "Pupil", admissionNumber: "ADM-4", gender: "FEMALE", dateOfBirth: "2012-01-01", photoUrl: null }],
};
const defaults = { roster, cardCount: 3, status: "DRAFT" as const, canManage: true, isOwner: true, busy: false, onBuild: vi.fn() };
function render(overrides: Partial<React.ComponentProps<typeof ReportCardRoster>> = {}) {
  vi.stubGlobal("React", React);
  return renderToStaticMarkup(React.createElement(ReportCardRoster, { ...defaults, ...overrides }));
}

afterEach(() => vi.unstubAllGlobals());
describe("report-card roster recovery", () => {
  it("names missing students and offers a safe draft rebuild", () => {
    const html = render();
    expect(html).toContain("4 enrolled students");
    expect(html).toContain("3 report cards");
    expect(html).toContain("Ada Pupil (ADM-4)");
    expect(html).toContain("Rebuild draft report cards");
    expect(html).toContain("Existing comments are kept");
  });
  it("keeps teachers informed without exposing a build action", () => {
    const html = render({ canManage: false, isOwner: false });
    expect(html).toContain("Ask an administrator");
    expect(html).not.toContain("<button");
  });
  for (const status of ["SUBJECT_REVIEWED", "FORM_REVIEWED", "PRINCIPAL_APPROVED", "RELEASED"] as const) {
    it(`requires explicit reopening for ${status}`, () => {
      expect(render({ status })).toContain("Use Reopen arm with a reason");
      expect(render({ status })).not.toContain("<button");
      expect(render({ status, isOwner: false })).toContain("Ask the school owner");
    });
  }
  it("disables rebuild while another action is pending", () => {
    expect(render({ busy: true })).toMatch(/<button[^>]*disabled/);
  });
  it("allows rebuild after a late enrollment even during an API rolling deploy", () => {
    expect(render({ roster: null })).toContain("Rebuild draft report cards");
  });
});
