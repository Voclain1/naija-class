import { describe, expect, it } from "vitest";

import { PORTAL_STATUS_FILTERS, PORTAL_STATUS_LABEL, rosterActions } from "./roster-actions";

describe("rosterActions", () => {
  it("offers Invite to a guardian who has never been invited", () => {
    expect(rosterActions("NOT_INVITED")).toEqual(["invite"]);
  });

  it("offers Invite — not Resend — once an invitation has expired", () => {
    expect(rosterActions("EXPIRED")).toEqual(["invite"]);
  });

  it("offers Resend and Cancel while an invitation is live, never a plain Invite — and Switch off", () => {
    expect(rosterActions("INVITED")).toEqual(["resend", "revoke", "deactivate"]);
  });

  it("offers an active parent no link — staff must never be handed a set-password link for them — only Switch off", () => {
    expect(rosterActions("ACTIVE")).toEqual(["deactivate"]);
  });

  it("offers a switched-off parent only Turn back on — the API refuses invitations until then", () => {
    expect(rosterActions("DEACTIVATED")).toEqual(["reactivate"]);
  });

  it("offers nothing without an email", () => {
    expect(rosterActions("NO_EMAIL")).toEqual([]);
  });
});

describe("portal status labels and filters", () => {
  it("labels every status, and offers every status as a filter plus All", () => {
    const statuses = ["NO_EMAIL", "NOT_INVITED", "INVITED", "EXPIRED", "ACTIVE", "DEACTIVATED"] as const;
    for (const s of statuses) expect(PORTAL_STATUS_LABEL[s]).toBeTruthy();
    expect(PORTAL_STATUS_FILTERS.map((f) => f.value).sort()).toEqual(["ALL", ...statuses].sort());
  });

  it("lists the actionable statuses first", () => {
    expect(PORTAL_STATUS_FILTERS.slice(0, 3).map((f) => f.value)).toEqual(["ALL", "NOT_INVITED", "EXPIRED"]);
  });
});
