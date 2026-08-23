import { describe, expect, it } from "vitest";

import { parsePaystackSplitBackfillArgs } from "./paystack-split-backfill.args.js";

describe("Paystack split backfill rollout arguments", () => {
  it("accepts one reviewed school in dry-run mode", () => {
    expect(parsePaystackSplitBackfillArgs(["--school-id", "school-a"])).toEqual({
      apply: false,
      schoolId: "school-a",
      actorUserId: undefined,
      actorSchoolId: undefined,
    });
  });

  it("rejects both zero schools and a multi-school invocation", () => {
    expect(() => parsePaystackSplitBackfillArgs([])).toThrow(/exactly one/i);
    expect(() =>
      parsePaystackSplitBackfillArgs([
        "--school-id",
        "school-a",
        "--school-id",
        "school-b",
      ]),
    ).toThrow(/one school per invocation/i);
  });

  it("requires an exact school confirmation and audited actor for apply", () => {
    const base = ["--apply", "--school-id", "school-a"];
    expect(() => parsePaystackSplitBackfillArgs(base)).toThrow(/actor-user-id/i);
    expect(() =>
      parsePaystackSplitBackfillArgs([
        ...base,
        "--actor-user-id",
        "operator",
        "--actor-school-id",
        "operator-school",
        "--confirm-school-id",
        "school-b",
      ]),
    ).toThrow(/matching/i);
    expect(
      parsePaystackSplitBackfillArgs([
        ...base,
        "--actor-user-id",
        "operator",
        "--actor-school-id",
        "operator-school",
        "--confirm-school-id",
        "school-a",
      ]),
    ).toEqual({
      apply: true,
      schoolId: "school-a",
      actorUserId: "operator",
      actorSchoolId: "operator-school",
    });
  });
});
