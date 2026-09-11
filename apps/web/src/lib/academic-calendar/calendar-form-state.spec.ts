import { describe, expect, it } from "vitest";

import { proposeAcademicCalendar } from "@school-kit/types";

import {
  hasCalendarErrors,
  hasTermErrors,
  initialCalendarState,
  validateCalendarState,
  type CalendarFormState,
} from "./calendar-form-state";
import { apiErrorLines, extractValidationIssues } from "../errors/api-error-lines";

// REGRESSION SPEC for the 2026-09-11 onboarding incident.
//
// A real school was blocked at onboarding step 5. The owner changed the
// academic year's dates, left the pre-filled term dates alone, and the only
// thing the screen said was "Invalid request payload". The server had in fact
// computed "First Term must fall within the academic year." and put it in
// details.issues[]; the UI read err.message and dropped it.
//
// The existing API spec asserted only `status === 400`, which is why it never
// caught this: the status was always right. These tests assert the TEXT.

// A fixed "today" so the proposed calendar is stable regardless of when CI
// runs. September 2026 puts us inside the 2026/2027 year.
const TODAY = new Date(Date.UTC(2026, 8, 15));

function defaults(): CalendarFormState {
  return initialCalendarState(TODAY).state;
}

describe("validateCalendarState", () => {
  it("accepts the pre-filled defaults untouched", () => {
    const errors = validateCalendarState(defaults());
    expect(hasCalendarErrors(errors)).toBe(false);
    expect(errors.all).toEqual([]);
  });

  it("the defaults it validates are the ones the form actually renders", () => {
    // Guards against the mirror drifting onto a different calendar than the
    // one proposeAcademicCalendar() hands the form.
    const p = proposeAcademicCalendar(TODAY);
    const state = defaults();
    expect(state.yearStartDate).toBe(p.yearStartDate.toISOString().slice(0, 10));
    expect(state.yearEndDate).toBe(p.yearEndDate.toISOString().slice(0, 10));
    expect(state.terms).toHaveLength(3);
  });

  // ---------------------------------------------------------------------
  // The incident itself.
  // ---------------------------------------------------------------------

  it("catches the exact edit that blocked the signup: year moved, terms untouched", () => {
    const state = {
      ...defaults(),
      yearStartDate: "2026-10-01",
      yearEndDate: "2027-08-31",
    };

    const errors = validateCalendarState(state);

    expect(hasCalendarErrors(errors)).toBe(true);
    // The specific sentence, not a generic failure.
    expect(errors.all).toContain("First Term must fall within the academic year.");
    expect(errors.all).not.toContain("Invalid request payload");
    // Attached to the offending row, so the field can be highlighted.
    expect(errors.terms[0]?.row).toBe("First Term must fall within the academic year.");
    // ...and the rows that are still fine are not flagged.
    expect(errors.terms[1]?.row).toBeUndefined();
    expect(errors.terms[2]?.row).toBeUndefined();
  });

  it("flags every offending term when shortening the year invalidates two", () => {
    const errors = validateCalendarState({ ...defaults(), yearEndDate: "2027-03-31" });

    expect(errors.terms[0]?.row).toBeUndefined();
    expect(errors.terms[1]?.row).toBe("Second Term must fall within the academic year.");
    expect(errors.terms[2]?.row).toBe("Third Term must fall within the academic year.");
    expect(errors.all).toHaveLength(2);
  });

  it("reports term errors so the collapsed term section can auto-expand", () => {
    // hasTermErrors is what drives the reveal. Without it the invalidated
    // fields stay hidden behind the "Check or edit term dates" toggle, which
    // was half of why the original error was impossible to act on.
    expect(hasTermErrors(validateCalendarState(defaults()))).toBe(false);
    expect(
      hasTermErrors(validateCalendarState({ ...defaults(), yearStartDate: "2026-09-15" })),
    ).toBe(true);
  });

  it("attaches a year-level error to the year field, not to a term", () => {
    const errors = validateCalendarState({
      ...defaults(),
      yearStartDate: "2027-09-01",
      yearEndDate: "2026-07-31",
    });
    expect(errors.yearEndDate).toBe("Academic year end date must be after its start date.");
  });

  it("catches overlapping terms on the term's own start field", () => {
    const state = defaults();
    const terms = state.terms.map((t, i) =>
      // Pull Second Term's start back before First Term ends.
      i === 1 ? { ...t, startDate: "2026-12-01" } : t,
    );
    const errors = validateCalendarState({ ...state, terms });
    expect(errors.terms[1]?.startDate).toBe("Second Term must start after First Term ends.");
  });

  it("does not crash on a cleared date input", () => {
    // An empty <input type="date"> yields "", which becomes an Invalid Date.
    const errors = validateCalendarState({ ...defaults(), yearStartDate: "" });
    expect(hasCalendarErrors(errors)).toBe(true);
    expect(errors.yearStartDate).toBeTruthy();
  });
});

describe("apiErrorLines", () => {
  // The exact envelope the API returned in the reproduction, captured from a
  // real HTTP response against the real Nest app.
  const REAL_STEP5_ENVELOPE = {
    message: "Invalid request payload",
    details: {
      issues: [
        {
          path: "calendar.terms.0",
          code: "custom",
          message: "First Term must fall within the academic year.",
        },
      ],
    },
  };

  it("surfaces the issue text instead of the generic envelope message", () => {
    const lines = apiErrorLines(REAL_STEP5_ENVELOPE, "network fallback");
    expect(lines).toEqual(["First Term must fall within the academic year."]);
    expect(lines).not.toContain("Invalid request payload");
  });

  it("returns one line per issue, in server order", () => {
    const lines = apiErrorLines(
      {
        message: "Invalid request payload",
        details: {
          issues: [
            { path: "calendar.terms.1", code: "custom", message: "Second Term must fall within the academic year." },
            { path: "calendar.terms.2", code: "custom", message: "Third Term must fall within the academic year." },
          ],
        },
      },
      "network fallback",
    );
    expect(lines).toEqual([
      "Second Term must fall within the academic year.",
      "Third Term must fall within the academic year.",
    ]);
  });

  it("falls back to the envelope message for a non-validation error", () => {
    // Every other error in the API already carries a specific message.
    expect(
      apiErrorLines({ message: "Session is invalid or has been revoked." }, "network fallback"),
    ).toEqual(["Session is invalid or has been revoked."]);
  });

  it("uses the fallback when there is no response at all", () => {
    expect(apiErrorLines(null, "Could not reach the server.")).toEqual([
      "Could not reach the server.",
    ]);
  });

  it("ignores malformed details rather than rendering junk", () => {
    for (const details of [null, undefined, "nope", { issues: "nope" }, { issues: [{}] }, {}]) {
      expect(extractValidationIssues(details)).toEqual([]);
      expect(apiErrorLines({ message: "Something failed.", details }, "fb")).toEqual([
        "Something failed.",
      ]);
    }
  });
});
