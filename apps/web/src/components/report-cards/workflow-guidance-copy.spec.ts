import { describe, expect, it } from "vitest";

import { getWorkflowGuidance } from "./workflow-guidance-copy";

describe("getWorkflowGuidance", () => {
  it.each([
    ["DRAFT", false, false, "Results are still being prepared.", "Subject teachers need to sign off"],
    ["SUBJECT_REVIEWED", false, false, "All subjects have been reviewed.", "form teacher reviews"],
    ["FORM_REVIEWED", true, false, "Submitted for principal approval.", "owner or administrator needs to approve"],
    ["PRINCIPAL_APPROVED", true, false, "Approved and ready to release.", "publish this arm's results"],
    ["RELEASED", true, true, "Results have been released to families and students.", "you can reopen the arm"],
    ["RELEASED", true, false, "Results have been released to families and students.", "ask the school owner to reopen"],
    ["RELEASED", false, false, "Results have been released to families and students.", "do not need to take action now"],
    ["MIXED", false, false, "This arm needs administrator attention.", "no further action"],
  ] as const)("explains %s for the relevant viewer", (status, canManage, isOwner, heading, detail) => {
    const guidance = getWorkflowGuidance(status, canManage, isOwner);
    expect(guidance.heading).toBe(heading);
    expect(guidance.detail).toContain(detail);
  });
});
