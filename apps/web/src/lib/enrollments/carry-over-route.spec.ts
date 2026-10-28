import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const { readSearch } = vi.hoisted(() => ({ readSearch: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: readSearch }));

import BulkEnrollmentWizardPage from "@/app/(admin)/enrollments/bulk/page";

// A disabled wizard must not mount its context/candidate loader. This is a
// server-render check, not a DOM harness; Playwright covers browser behavior.
describe("disabled carry-over route", () => {
  afterEach(() => vi.unstubAllGlobals());

  for (const query of ["", "armId=old-class&termId=old-term"]) {
    it(`renders recovery before reading ${query ? "a bookmarked context" : "missing parameters"}`, () => {
      readSearch.mockReset();
      readSearch.mockReturnValue(new URLSearchParams(query));
      // This Node-only runner uses classic JSX; Next supplies the automatic
      // runtime in production. Supply React only within this render test.
      vi.stubGlobal("React", React);
      const html = renderToStaticMarkup(React.createElement(BulkEnrollmentWizardPage));

      expect(html).toContain("Carry over is temporarily unavailable");
      expect(html).toContain("Add students to a class");
      expect(html).toContain("Find an existing student");
      expect(html).not.toContain("Missing armId");
      expect(html).not.toContain("Working out who is eligible");
      expect(readSearch).not.toHaveBeenCalled();
    });
  }
});
