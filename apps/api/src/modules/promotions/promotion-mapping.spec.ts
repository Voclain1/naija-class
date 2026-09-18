import { describe, expect, it } from "vitest";

import {
  armIndexWithinLevel,
  nextLevel,
  resolveYearDestination,
  sortArms,
  suggestArm,
  type LadderArm,
  type LadderLevel,
} from "./promotion-mapping";

// The rules that decide which class a child lands in next year. These are the
// calculations the 2026-08-25 incident is a warning about, so they are tested
// directly rather than only through the service.

function level(
  id: string,
  name: string,
  code: string,
  orderIndex: number,
  isActive = true,
): LadderLevel {
  return { id, name, code, orderIndex, isActive };
}

function arm(
  id: string,
  classLevelId: string,
  name: string,
  code: string,
  isActive = true,
): LadderArm {
  return { id, classLevelId, name, code, isActive };
}

const pri1 = level("l1", "Primary 1", "pri1", 1);
const pri2 = level("l2", "Primary 2", "pri2", 2);
const pri3 = level("l3", "Primary 3", "pri3", 3);

function armMap(arms: LadderArm[]): Map<string, LadderArm[]> {
  const map = new Map<string, LadderArm[]>();
  for (const a of arms) {
    const list = map.get(a.classLevelId) ?? [];
    list.push(a);
    map.set(a.classLevelId, list);
  }
  return map;
}

describe("sortArms", () => {
  it("orders by code, not by name", () => {
    const arms = [
      arm("a3", "l1", "Primary 1 Zebra", "pri1-a"),
      arm("a1", "l1", "Primary 1 Apple", "pri1-c"),
      arm("a2", "l1", "Primary 1 Mango", "pri1-b"),
    ];
    expect(sortArms(arms).map((a) => a.code)).toEqual([
      "pri1-a",
      "pri1-b",
      "pri1-c",
    ]);
  });

  it("does not mutate its input", () => {
    const arms = [
      arm("a2", "l1", "B", "pri1-b"),
      arm("a1", "l1", "A", "pri1-a"),
    ];
    sortArms(arms);
    expect(arms[0].id).toBe("a2");
  });
});

describe("armIndexWithinLevel", () => {
  it("counts a retired arm's position rather than closing the gap", () => {
    // If the retired 1B were skipped, 1C's index would become 1 and its
    // children would be promoted into 2B — somebody else's class.
    const arms = [
      arm("a", "l1", "Primary 1A", "pri1-a"),
      arm("b", "l1", "Primary 1B", "pri1-b", false),
      arm("c", "l1", "Primary 1C", "pri1-c"),
    ];
    expect(armIndexWithinLevel(arms, "c")).toBe(2);
  });

  it("returns -1 for an arm that is not in the level", () => {
    expect(armIndexWithinLevel([arm("a", "l1", "A", "pri1-a")], "zzz")).toBe(-1);
  });
});

describe("nextLevel", () => {
  it("returns the next level by orderIndex", () => {
    expect(nextLevel([pri3, pri1, pri2], "l1")?.id).toBe("l2");
  });

  it("skips a retired level in the middle of the ladder", () => {
    const retired = level("l2", "Primary 2", "pri2", 2, false);
    expect(nextLevel([pri1, retired, pri3], "l1")?.id).toBe("l3");
  });

  it("returns null at the top of the ladder", () => {
    expect(nextLevel([pri1, pri2], "l2")).toBeNull();
  });
});

describe("resolveYearDestination", () => {
  const arms = [
    arm("1a", "l1", "Primary 1A", "pri1-a"),
    arm("1b", "l1", "Primary 1B", "pri1-b"),
    arm("2a", "l2", "Primary 2A", "pri2-a"),
    arm("2b", "l2", "Primary 2B", "pri2-b"),
  ];

  it("maps an arm to the same position in the next level", () => {
    const result = resolveYearDestination(
      [pri1, pri2],
      armMap(arms),
      "l1",
      1,
    );
    expect(result).toMatchObject({ kind: "ARM" });
    if (result.kind !== "ARM") throw new Error("unreachable");
    expect(result.arm.id).toBe("2b");
    expect(result.level.id).toBe("l2");
  });

  it("reports NO_LEVEL at the top of the ladder", () => {
    expect(
      resolveYearDestination([pri1, pri2], armMap(arms), "l2", 0).kind,
    ).toBe("NO_LEVEL");
  });

  it("reports NO_ARM when the next level has fewer arms", () => {
    const narrow = arms.filter((a) => a.id !== "2b");
    const result = resolveYearDestination([pri1, pri2], armMap(narrow), "l1", 1);
    expect(result.kind).toBe("NO_ARM");
    if (result.kind !== "NO_ARM") throw new Error("unreachable");
    expect(result.level.id).toBe("l2");
  });

  it("never proposes an inactive destination arm", () => {
    const withRetiredTarget = arms.map((a) =>
      a.id === "2b" ? { ...a, isActive: false } : a,
    );
    expect(
      resolveYearDestination([pri1, pri2], armMap(withRetiredTarget), "l1", 1)
        .kind,
    ).toBe("NO_ARM");
  });
});

describe("suggestArm", () => {
  it("carries the source arm's own suffix into the next level", () => {
    expect(
      suggestArm(pri2, pri1, arm("1b", "l1", "Primary 1B", "pri1-b")),
    ).toEqual({ name: "Primary 2B", code: "pri2-b" });
  });

  it("keeps a school's own arm vocabulary instead of inventing letters", () => {
    expect(
      suggestArm(pri2, pri1, arm("1g", "l1", "Primary 1 Gold", "pri1-gold")),
    ).toEqual({ name: "Primary 2 Gold", code: "pri2-gold" });
  });

  it("falls back to the whole arm name when it does not embed the level", () => {
    expect(
      suggestArm(pri2, pri1, arm("1x", "l1", "Sunflower", "sunflower")),
    ).toEqual({ name: "Primary 2 Sunflower", code: "pri2-sunflower" });
  });

  it("produces a code the class-arm schema accepts", () => {
    const suggestion = suggestArm(
      pri2,
      pri1,
      arm("1x", "l1", "Primary 1 Red & Gold", "pri1-RED GOLD"),
    );
    expect(suggestion.code).toMatch(/^[a-z0-9-]+$/);
    expect(suggestion.code.length).toBeLessThanOrEqual(20);
    expect(suggestion.name.length).toBeLessThanOrEqual(40);
  });
});
