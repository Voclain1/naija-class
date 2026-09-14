import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { withTenant } from "@school-kit/db";

import { findTimetableClashes, lockSchoolTimetables } from "./timetable-clash";
import { createTimetableFixture, MON, type TimetableFixture } from "./timetable.fixture-spec";

// Phase 8 / CP3 — the advisory lock (D32) is NECESSARY, proven not asserted.
// docs/modules/phase-8.md §17.6 item 3.
//
// THE RACE. Two admins save lessons for two different classes: Tunde Bello on
// Monday P1 in JSS 1A, and Tunde Bello on Monday P1 in JSS 1B. Each is fine on
// its own; together they are a clash. Under READ COMMITTED, if both transactions
// write BEFORE either runs its clash query, neither sees the other's uncommitted
// lesson — both checks pass and both commit.
//
// FORCING THE DANGEROUS INTERLEAVING, deterministically. The service's
// afterWriteHook runs after a mutation's writes and before its clash query. The
// hook below is a BARRIER: the first transaction to reach it waits until the
// second also arrives (or a timeout passes). So:
//
//   * WITHOUT the lock, both transactions reach the barrier together — the
//     worst case is guaranteed, not hoped for — and both commit. The clash
//     query, run afterwards, finds the clash that was let in.
//
//   * WITH the lock, the second transaction is blocked at its FIRST statement
//     (pg_advisory_xact_lock) while the first holds the lock, so it can never
//     reach the barrier while the first is waiting there. The first times out
//     of the barrier, checks, commits; only then does the second acquire the
//     lock, write, see the first's committed lesson, and fail TIMETABLE_CLASH.
//
// The same two specs run the SAME operations; the only difference is lockFn.
// If the lock were decorative, the "with lock" case would also commit both.

const BARRIER_TIMEOUT_MS = 1_500;

function makeBarrier() {
  const arrivals: number[] = [];
  let release: (() => void) | null = null;
  const bothArrived = new Promise<void>((r) => (release = r));
  return {
    arrivals,
    hook: async () => {
      arrivals.push(Date.now());
      if (arrivals.length >= 2) release!();
      await Promise.race([bothArrived, new Promise((r) => setTimeout(r, BARRIER_TIMEOUT_MS))]);
    },
  };
}

describe("timetable advisory lock (D32) — real concurrent transactions", () => {
  let fx: TimetableFixture;
  let aId: string;
  let bId: string;

  beforeAll(async () => {
    fx = await createTimetableFixture("conc");
  }, 60_000);

  afterAll(async () => {
    await fx?.cleanup();
  });

  beforeEach(async () => {
    fx.service.lockFn = lockSchoolTimetables;
    fx.service.afterWriteHook = null;
    await fx.reset();
    aId = (await fx.timetable("a", null)).id;
    bId = (await fx.timetable("b", null)).id;
  });

  const race = () =>
    Promise.allSettled([
      fx.lesson(aId, MON, "p1", [fx.teachers.tunde]),
      fx.lesson(bId, MON, "p1", [fx.teachers.tunde]),
    ]);

  const committedLessons = () =>
    withTenant(fx.schoolId, (db) => db.timetableEntry.count({ where: { timetableId: { in: [aId, bId] } } }));
  const clashes = () => withTenant(fx.schoolId, (db) => findTimetableClashes(db, fx.schoolId, fx.year));

  it("CONTROL — with the lock REMOVED, both transactions pass their checks and COMMIT A CLASH", async () => {
    fx.service.lockFn = async () => undefined; // the mutation under test
    const barrier = makeBarrier();
    fx.service.afterWriteHook = barrier.hook;

    const results = await race();

    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(barrier.arrivals).toHaveLength(2);
    // Both reached the write/check gap together — well inside the barrier timeout.
    expect(Math.abs(barrier.arrivals[1]! - barrier.arrivals[0]!)).toBeLessThan(BARRIER_TIMEOUT_MS);
    expect(await committedLessons()).toBe(2);
    const found = await clashes();
    expect(found.length).toBe(3); // one per term of the year
    expect(found[0]).toMatchObject({ teacherName: "Tunde Bello", dayOfWeek: MON, slotLabel: "P1" });
  });

  it("WITH the lock, the same race commits exactly one lesson; the other fails TIMETABLE_CLASH and no clash exists", async () => {
    const barrier = makeBarrier();
    fx.service.afterWriteHook = barrier.hook;

    const results = await race();

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toMatchObject({ code: "TIMETABLE_CLASH" });

    // Serialised: the second transaction reached the barrier only AFTER the first
    // had given up waiting there — it could not arrive while the lock was held.
    expect(barrier.arrivals).toHaveLength(2);
    expect(barrier.arrivals[1]! - barrier.arrivals[0]!).toBeGreaterThanOrEqual(BARRIER_TIMEOUT_MS - 50);

    expect(await committedLessons()).toBe(1);
    expect(await clashes()).toEqual([]);
  });

  it("the lock is per school: another school's timetable write is not blocked while this school's lock is held", async () => {
    const other = await createTimetableFixture("conc-other");
    try {
      const otherTt = await other.timetable("a", null);
      let releaseHeld!: () => void;
      const held = new Promise<void>((r) => (releaseHeld = r));
      let holderLocked!: () => void;
      const locked = new Promise<void>((r) => (holderLocked = r));

      // Hold THIS school's timetable lock in an open transaction.
      const holder = withTenant(
        fx.schoolId,
        async (db) => {
          await lockSchoolTimetables(db, fx.schoolId);
          holderLocked();
          await held;
        },
        { timeoutMs: 15_000 },
      );
      await locked;

      // CONTROL: a write to THIS school must queue behind the held lock.
      let sameSchoolDone = false;
      const sameSchool = fx.lesson(aId, MON, "p2", [fx.teachers.tunde]).then(() => (sameSchoolDone = true));
      await new Promise((r) => setTimeout(r, 1_000));
      expect(sameSchoolDone, "same-school write should be blocked by the held lock").toBe(false);

      // Another school's write is not blocked.
      const started = Date.now();
      await other.lesson(otherTt.id, MON, "p1", [other.teachers.tunde]);
      const elapsed = Date.now() - started;
      expect(sameSchoolDone, "still blocked after the other school's write finished").toBe(false);

      releaseHeld();
      await holder;
      await sameSchool; // released → completes

      expect(sameSchoolDone).toBe(true);
      expect(elapsed).toBeLessThan(1_000); // not queued behind a lock it does not share
    } finally {
      await other.cleanup();
    }
  }, 60_000);
});
