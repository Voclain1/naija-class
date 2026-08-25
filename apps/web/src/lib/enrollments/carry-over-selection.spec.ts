import { describe, expect, it } from "vitest";

import {
  initialCarryOverSelection,
  type CarryOverGroup,
} from "./carry-over-selection";

// Regression guard for the 2026-08-25 carry-over incident.
//
// The API-side spec (apps/api/.../carry-over-incident.spec.ts) REPRODUCES what
// the server does once a school-wide studentIds array reaches it, and still
// passes — the server is not the defect and its behaviour is unchanged. This
// file is the inverse: it guards the rule that produced that array.

function rows(spec: Array<[string, CarryOverGroup]>) {
  return spec.map(([studentId, group]) => ({ studentId, group }));
}

describe("carry-over default selection", () => {
  it("NEVER pre-ticks the school-wide 'admitted' group — the incident's root cause", () => {
    // The pilot's exact shape: 3 students genuinely carrying into this arm,
    // plus 9 swept in from other arms because admittedAt > source.endDate.
    const selection = initialCarryOverSelection(
      rows([
        ["a1", "carried"],
        ["a2", "carried"],
        ["a3", "carried"],
        ...(["b1", "b2", "b3", "b4", "b5", "b6", "b7", "b8", "b9"].map(
          (id) => [id, "admitted"] as [string, CarryOverGroup],
        )),
      ]),
    );

    const ticked = [...selection.entries()].filter(([, v]) => v).map(([k]) => k);
    // Before the fix this was all 12, and one click enrolled the school into
    // one arm.
    expect(ticked.sort()).toEqual(["a1", "a2", "a3"]);
    for (const id of ["b1", "b5", "b9"]) expect(selection.get(id)).toBe(false);
  });

  it("a school where EVERY student is unplaced commits nothing by default", () => {
    // The precise pilot condition — admittedAt defaults to now(), so on a
    // recently onboarded school the whole roster lands in 'admitted'. With no
    // carried-over students, the default selection must be empty and Commit
    // must have nothing to send.
    const selection = initialCarryOverSelection(
      rows([
        ["s1", "admitted"],
        ["s2", "admitted"],
        ["s3", "admitted"],
        ["s4", "admitted"],
      ]),
    );
    expect([...selection.values()].some(Boolean)).toBe(false);
  });

  it("still pre-ticks the arm-scoped 'carried' group, so the happy path is unchanged", () => {
    expect(initialCarryOverSelection(rows([["s1", "carried"]])).get("s1")).toBe(true);
  });

  it("keeps 'withdrew' unticked, as it always was", () => {
    expect(initialCarryOverSelection(rows([["s1", "withdrew"]])).get("s1")).toBe(false);
  });

  it("returns an entry for every candidate, ticked or not", () => {
    const selection = initialCarryOverSelection(
      rows([["s1", "carried"], ["s2", "withdrew"], ["s3", "admitted"]]),
    );
    expect(selection.size).toBe(3);
  });
});
