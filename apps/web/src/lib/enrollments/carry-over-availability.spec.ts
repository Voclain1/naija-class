import { describe, expect, it } from "vitest";

import {
  CARRY_OVER_DISABLED_BODY,
  CARRY_OVER_DISABLED_TITLE,
  CARRY_OVER_ENABLED,
} from "./carry-over-availability";

// Guards the kill switch itself. It is a one-line constant, which is exactly
// the kind of thing that gets flipped back by an unrelated refactor or a
// merge; this makes that a failing test rather than a silent re-opening of a
// data-integrity incident.

describe("carry-over kill switch", () => {
  it("is OFF — flipping it back must be a deliberate, visible act", () => {
    expect(CARRY_OVER_ENABLED).toBe(false);
  });

  it("points to where carry over went, without jargon, blame or alarm", () => {
    // Since 2026-11-12: the fault was fixed in August and the job moved to
    // Bring students forward. The notice shows on every empty class, so it
    // must not tell a school its product is broken.
    expect(CARRY_OVER_DISABLED_TITLE).toBe("Carry over has moved");
    expect(CARRY_OVER_DISABLED_BODY).toContain("Bring students forward");
    expect(CARRY_OVER_DISABLED_BODY).toContain("one at a time still works");
    for (const word of ["bug", "error", "fault", "temporarily", "wrong class"]) {
      expect(`${CARRY_OVER_DISABLED_TITLE} ${CARRY_OVER_DISABLED_BODY}`.toLowerCase()).not.toContain(word);
    }
  });
});
