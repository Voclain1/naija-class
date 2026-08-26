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

  it("explains itself to a school user without jargon or blame", () => {
    // The person reading this is an administrator who just lost a feature
    // mid-term. They need to know it is deliberate, that their data is safe,
    // and what still works.
    expect(CARRY_OVER_DISABLED_TITLE.length).toBeGreaterThan(10);
    expect(CARRY_OVER_DISABLED_BODY).toContain("wrong class");
    expect(CARRY_OVER_DISABLED_BODY).toContain("individually");
    expect(CARRY_OVER_DISABLED_BODY.toLowerCase()).not.toContain("bug");
    expect(CARRY_OVER_DISABLED_BODY.toLowerCase()).not.toContain("error");
  });
});
