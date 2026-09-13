import { afterAll, describe, expect, it } from "vitest";

import { basePrisma } from "@school-kit/db";
import { lagosTodayIso } from "@school-kit/types";

// Phase 8 / CP1 — the national events seed obeys D24 (docs/modules/phase-8.md §15).
//
// Reads the real table as app_user (national_events is readable by everyone).
// Keys, date ranges and a non-empty source are ALSO enforced by the database
// (unique index, CHECK constraints); these assertions pin the sourcing POLICY,
// which the database cannot express.

const CORE_KEYS = [
  "new-year",
  "eid-el-fitr",
  "good-friday",
  "easter-monday",
  "workers-day",
  "eid-el-kabir",
  "democracy-day",
  "eid-el-maulud",
  "independence-day",
  "christmas-day",
  "boxing-day",
];

describe("national_events seed (D24)", () => {
  afterAll(async () => {
    await basePrisma.$disconnect();
  });

  it("covers every federal holiday for 2026 and 2027", async () => {
    const keys = new Set((await basePrisma.nationalEvent.findMany({ select: { key: true } })).map((r) => r.key));
    for (const year of [2026, 2027]) {
      for (const k of CORE_KEYS) expect(keys.has(`${k}-${year}`), `${k}-${year}`).toBe(true);
    }
  });

  it("every row has a source, and every confirmed 2026 lunar holiday cites the Ministry of Interior", async () => {
    const rows = await basePrisma.nationalEvent.findMany({ select: { key: true, source: true, dateConfirmed: true } });
    for (const r of rows) expect(r.source.trim().length, r.key).toBeGreaterThan(0);
    for (const k of ["eid-el-fitr-2026", "eid-el-kabir-2026", "eid-el-maulud-2026"]) {
      const r = rows.find((x) => x.key === k)!;
      expect(r.dateConfirmed, k).toBe(true);
      expect(r.source, k).toMatch(/^https:\/\/interior\.gov\.ng\//);
    }
  });

  it("the 2027 Eids are seeded as unconfirmed estimates", async () => {
    const rows = await basePrisma.nationalEvent.findMany({
      where: { key: { in: ["eid-el-fitr-2027", "eid-el-kabir-2027", "eid-el-maulud-2027"] } },
      select: { key: true, dateConfirmed: true, source: true },
    });
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.dateConfirmed, r.key).toBe(false);
      expect(r.source, r.key).toMatch(/^ESTIMATE/);
    }
  });

  it("no unconfirmed estimate has already started — a forgotten confirmation fails CI rather than showing families a stale guess", async () => {
    // Deliberately time-dependent, as approved in §15.4: when an estimated Eid
    // arrives without its confirming migration, this starts failing. The fix is
    // the one-line confirmation migration D24 describes, not editing this test.
    const today = lagosTodayIso();
    const stale = await basePrisma.nationalEvent.findMany({
      where: { dateConfirmed: false, startDate: { lte: new Date(`${today}T00:00:00Z`) } },
      select: { key: true, startDate: true },
    });
    expect(
      stale.map((s) => s.key),
      "unconfirmed national events whose date has arrived — confirm or correct them by migration",
    ).toEqual([]);
  });
});
