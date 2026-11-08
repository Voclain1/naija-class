import { describe, expect, it } from "vitest";

import { getWorkflowGuidance } from "./workflow-guidance-copy";

describe("getWorkflowGuidance", () => {
  it.each([
    ["DRAFT", false, false, "Results are still being prepared.", "each subject teacher has signed off"],
    ["SUBJECT_REVIEWED", false, false, "All subjects have been reviewed.", "Save the teacher’s comment"],
    ["FORM_REVIEWED", true, false, "Submitted for principal approval.", "Approve report cards"],
    ["PRINCIPAL_APPROVED", true, false, "Approved and ready to release.", "Nothing is published until you confirm"],
    ["RELEASED", true, true, "Results have been released to families and students.", "you can reopen the arm"],
    ["RELEASED", true, false, "Results have been released to families and students.", "ask the school owner to reopen"],
    ["RELEASED", false, false, "Results have been released to families and students.", "do not need to take action now"],
    ["MIXED", false, false, "This arm needs administrator attention.", "no further action"],
  ] as const)("explains %s for the relevant viewer", (status, canManage, isOwner, heading, detail) => {
    const guidance = getWorkflowGuidance(status, canManage, isOwner);
    expect(guidance.heading).toBe(heading);
    expect(guidance.detail).toContain(detail);
  });

  it("does not ask a teacher to carry out management approval", () => {
    const copy = getWorkflowGuidance("FORM_REVIEWED", false, false);
    expect(copy.detail).toContain("You do not need to take action now");
    expect(copy.detail).not.toContain("choose “Approve");
  });
});
