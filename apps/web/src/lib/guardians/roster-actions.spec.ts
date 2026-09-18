import { describe, expect, it } from "vitest";

import { PORTAL_STATUS_FILTERS, PORTAL_STATUS_LABEL, rosterActions } from "./roster-actions";

describe("rosterActions", () => {
  it("offers Invite to a guardian who has never been invited", () => {
    expect(rosterActions("NOT_INVITED")).toEqual(["invite"]);
  });

  it("offers Invite — not Resend — once an invitation has expired", () => {
    expect(rosterActions("EXPIRED")).toEqual(["invite"]);
  });

  it("offers Resend and Cancel while an invitation is live, and never a plain Invite", () => {
    expect(rosterActions("INVITED")).toEqual(["resend", "revoke"]);
  });

  it("offers nothing to an active parent — staff must never be handed a set-password link for them", () => {
    expect(rosterActions("ACTIVE")).toEqual([]);
  });

  it("offers nothing without an email", () => {
    expect(rosterActions("NO_EMAIL")).toEqual([]);
  });
});

describe("portal status labels and filters", () => {
  it("labels every status, and offers every status as a filter plus All", () => {
    const statuses = ["NO_EMAIL", "NOT_INVITED", "INVITED", "EXPIRED", "ACTIVE"] as const;
    for (const s of statuses) expect(PORTAL_STATUS_LABEL[s]).toBeTruthy();
    expect(PORTAL_STATUS_FILTERS.map((f) => f.value).sort()).toEqual(["ALL", ...statuses].sort());
  });

  it("lists the actionable statuses first", () => {
    expect(PORTAL_STATUS_FILTERS.slice(0, 3).map((f) => f.value)).toEqual(["ALL", "NOT_INVITED", "EXPIRED"]);
  });
});
