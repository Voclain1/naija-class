import { describe, expect, it } from "vitest";

import { parseInvoiceArmBackfillArgs } from "./invoice-arm-backfill.args.js";

describe("invoice arm backfill arguments", () => {
  it("defaults one reviewed school to dry-run", () => {
    expect(parseInvoiceArmBackfillArgs(["--school-id", "school-a"])).toEqual({
      apply: false,
      schoolId: "school-a",
      actorUserId: undefined,
      actorSchoolId: undefined,
    });
  });

  it("rejects zero and multiple schools", () => {
    expect(() => parseInvoiceArmBackfillArgs([])).toThrow(/exactly one/i);
    expect(() =>
      parseInvoiceArmBackfillArgs([
        "--school-id", "school-a", "--school-id", "school-b",
      ]),
    ).toThrow(/one school/i);
  });

  it("requires an audited actor and exact typed confirmation before apply", () => {
    const base = ["--apply", "--school-id", "school-a"];
    expect(() => parseInvoiceArmBackfillArgs(base)).toThrow(/actor-user-id/i);
    expect(() => parseInvoiceArmBackfillArgs([
      ...base,
      "--actor-user-id", "operator",
      "--actor-school-id", "operator-school",
      "--confirm-school-id", "school-b",
    ])).toThrow(/matching/i);
    expect(parseInvoiceArmBackfillArgs([
      ...base,
      "--actor-user-id", "operator",
      "--actor-school-id", "operator-school",
      "--confirm-school-id", "school-a",
    ])).toMatchObject({ apply: true, schoolId: "school-a", actorUserId: "operator" });
  });
});
