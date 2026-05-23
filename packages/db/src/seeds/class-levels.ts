// Phase 1 / Slice 2 — default ClassLevel seed.
//
// Every new school created via signupOwner is auto-populated with these 14
// rows inside the same transaction that creates the school. Schools can then
// rename them, deactivate them, or add custom levels.
//
// Naming convention (locked 2026-05-23): KG 1 / KG 2 for the two pre-primary
// years. Some Nigerian private schools prefer "Nursery 1 / Nursery 2" — we
// picked KG because it matches the more common naming in modern Nigerian
// private schools and reduces day-one renaming for the majority of pilots.
// Schools that want Nursery just rename via the settings UI.
//
// Codes are stable per school and back the unique `(school_id, code)` index.
// They are the upsert key for idempotency: a hypothetical retry of the seed
// inserts no duplicates because `createMany({ skipDuplicates: true })`
// silently ignores conflicts on this constraint.

export interface DefaultClassLevel {
  code: string;
  name: string;
  stage: "NURSERY" | "PRIMARY" | "JSS" | "SSS";
  orderIndex: number;
}

export const DEFAULT_CLASS_LEVELS: readonly DefaultClassLevel[] = [
  { code: "kg1",  name: "KG 1",      stage: "NURSERY", orderIndex: 1 },
  { code: "kg2",  name: "KG 2",      stage: "NURSERY", orderIndex: 2 },
  { code: "pri1", name: "Primary 1", stage: "PRIMARY", orderIndex: 3 },
  { code: "pri2", name: "Primary 2", stage: "PRIMARY", orderIndex: 4 },
  { code: "pri3", name: "Primary 3", stage: "PRIMARY", orderIndex: 5 },
  { code: "pri4", name: "Primary 4", stage: "PRIMARY", orderIndex: 6 },
  { code: "pri5", name: "Primary 5", stage: "PRIMARY", orderIndex: 7 },
  { code: "pri6", name: "Primary 6", stage: "PRIMARY", orderIndex: 8 },
  { code: "jss1", name: "JSS 1",     stage: "JSS",     orderIndex: 9 },
  { code: "jss2", name: "JSS 2",     stage: "JSS",     orderIndex: 10 },
  { code: "jss3", name: "JSS 3",     stage: "JSS",     orderIndex: 11 },
  { code: "sss1", name: "SSS 1",     stage: "SSS",     orderIndex: 12 },
  { code: "sss2", name: "SSS 2",     stage: "SSS",     orderIndex: 13 },
  { code: "sss3", name: "SSS 3",     stage: "SSS",     orderIndex: 14 },
] as const;
