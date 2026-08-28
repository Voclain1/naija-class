import { describe, expect, it } from "vitest";

import { isTerminalAuthFailure, partialSaveNotice } from "./bulk-create";

describe("isTerminalAuthFailure — when to stop the row loop", () => {
  it("stops on 401", () => {
    // The defect this closes: a 401 on row 2 of 40 used to leave 38 doomed
    // requests still to fire, each one dispatching another unauthorized event.
    expect(isTerminalAuthFailure({ status: 401 })).toBe(true);
  });

  it("does NOT stop on a per-row failure", () => {
    // Stopping here would strand rows the user could have had. A bad date on
    // row 3 says nothing about row 4.
    expect(isTerminalAuthFailure({ status: 400 })).toBe(false);
    expect(isTerminalAuthFailure({ status: 409 })).toBe(false);
    expect(isTerminalAuthFailure({ status: 422 })).toBe(false);
    expect(isTerminalAuthFailure({ status: 500 })).toBe(false);
  });

  it("does NOT stop on 403 — a permission refusal is not a lost session", () => {
    expect(isTerminalAuthFailure({ status: 403 })).toBe(false);
  });

  it("does not stop on a network error with no status", () => {
    expect(isTerminalAuthFailure({})).toBe(false);
    expect(isTerminalAuthFailure({ status: undefined })).toBe(false);
  });
});

describe("partialSaveNotice — what the user is told", () => {
  it("names the exact count that landed", () => {
    const notice = partialSaveNotice(11, 40);
    expect(notice).toContain("11 of 40");
  });

  it("states the created rows as fact, not as a possibility", () => {
    // Those rows returned 201 with an id. Hedging a fact we hold ("may have
    // been created") would send the user to check something we already know.
    const notice = partialSaveNotice(11, 40);
    expect(notice).toMatch(/are saved/);
    expect(notice).not.toMatch(/may have|might have|possibly/i);
  });

  it("points at the roster rather than at the grid", () => {
    // The grid is about to be replaced by the login screen. The roster is the
    // only place the answer survives.
    expect(partialSaveNotice(11, 40)).toMatch(/roster/i);
  });

  it("never tells the user to fix rows or submit again", () => {
    // The rows are fine and re-submitting cannot work — the credential is
    // gone. This is the generic failure copy that must NOT leak into this path.
    for (const notice of [partialSaveNotice(0, 5), partialSaveNotice(3, 5)]) {
      expect(notice).not.toMatch(/fix the highlighted/i);
      expect(notice).not.toMatch(/submit again/i);
    }
  });

  it("says plainly when nothing was saved, and does not mention a roster to check", () => {
    const notice = partialSaveNotice(0, 5);
    expect(notice).toMatch(/before any students were added/i);
    expect(notice).not.toMatch(/roster/i);
  });

  it("reads correctly for a single student", () => {
    const notice = partialSaveNotice(1, 4);
    expect(notice).toContain("1 of 4 student was added");
    expect(notice).not.toContain("students was");
    expect(notice).not.toContain("student were");
  });

  it("always attributes the loss to being signed out", () => {
    for (const notice of [partialSaveNotice(0, 3), partialSaveNotice(2, 3)]) {
      expect(notice).toMatch(/signed out/i);
    }
  });
});
