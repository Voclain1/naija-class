import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, Prisma, PrismaClient, withTenant } from "@school-kit/db";

import { createTimetableFixture, MON, type TimetableFixture } from "../modules/timetable/timetable.fixture-spec";

// Phase 8 / CP3 — timetable isolation. docs/modules/phase-8.md §17.6 item 1.
// Phase 8 / CP4 — extended to timetable_publications (§18 D45): what FAMILIES see
// must be isolated exactly like the live timetable.
//
// Runs against a REAL Postgres as the runtime role (app_user), because every
// claim here is a property of the database.
//
// TWO KINDS OF CLAIM:
//
// 1. Ordinary RLS on the four tables: no-GUC reads see nothing, each school sees
//    only itself, and a write carrying another school's school_id is rejected by
//    WITH CHECK — with a control write under the correct GUC succeeding.
//
// 2. COMPOSITE FOREIGN KEYS (D29). Postgres referential checks BYPASS row-level
//    security. So under school A's own GUC, a row with school_id = A that names
//    school B's slot/subject/class/teacher/year/term id passes WITH CHECK
//    (school_id really is A) — the only thing that can stop it is the foreign
//    key. Each case asserts the named constraint rejects it, with a control
//    referencing A's own row succeeding.
//
//    And, so the composite FK is shown to be NECESSARY rather than merely
//    present: in a migration-role transaction that is always rolled back, the
//    bell-slot FK is swapped for a PLAIN one (bell_slot_id → bell_slots.id),
//    the session drops to app_user under A's GUC, and the same cross-school
//    insert SUCCEEDS. RLS alone does not protect a reference.

const DIRECT_URL = process.env.DIRECT_URL;
const TABLES = ["bell_slots", "timetables", "timetable_entries", "timetable_entry_teachers", "timetable_publications"] as const;

class Rollback extends Error {}

function fkName(e: unknown): string | null {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003") {
    const meta = e.meta as { field_name?: string } | undefined;
    return meta?.field_name ?? e.message;
  }
  if (e instanceof Prisma.PrismaClientUnknownRequestError || e instanceof Error) return `UNEXPECTED: ${e.message}`;
  return "UNEXPECTED";
}

describe("Phase 8 CP3 — timetable RLS and composite foreign keys", () => {
  let A: TimetableFixture;
  let B: TimetableFixture;
  let aTimetable: string;
  let bTimetable: string;
  let aEntry: string;
  let bEntry: string;
  let migrator: PrismaClient;

  beforeAll(async () => {
    if (!DIRECT_URL) throw new Error("DIRECT_URL is required: the necessity test needs the migration role.");
    migrator = new PrismaClient({ datasources: { db: { url: DIRECT_URL } } });
    A = await createTimetableFixture("rls-a");
    B = await createTimetableFixture("rls-b");
    aTimetable = (await A.timetable("a", null)).id;
    bTimetable = (await B.timetable("a", null)).id;
    aEntry = (await A.lesson(aTimetable, MON, "p1", [A.teachers.tunde])).lessons[0]!.id;
    bEntry = (await B.lesson(bTimetable, MON, "p1", [B.teachers.tunde])).lessons[0]!.id;
    // CP4: one published snapshot per school, so the publications table has rows in both.
    await A.service.publishTimetable(A.owner, aTimetable, { ipAddress: "127.0.0.1" });
    await B.service.publishTimetable(B.owner, bTimetable, { ipAddress: "127.0.0.1" });
  }, 120_000);

  afterAll(async () => {
    await A?.cleanup();
    await B?.cleanup();
    await migrator?.$disconnect();
  });

  const countAll = (db: Pick<PrismaClient, "$queryRawUnsafe">, table: string) =>
    db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${table}"`).then((r) => r[0]!.n);

  // ===========================================================================
  // 1. RLS
  // ===========================================================================

  it("RLS is ENABLED and FORCED, with a tenant_isolation policy, on all four tables", async () => {
    const rows = await migrator.$queryRawUnsafe<Array<{ relname: string; rls: boolean; forced: boolean; policies: string[] }>>(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
              ARRAY(SELECT polname::text FROM pg_policy p WHERE p.polrelid = c.oid ORDER BY 1) AS policies
       FROM pg_class c WHERE c.relname = ANY($1::text[]) ORDER BY c.relname`,
      [...TABLES],
    );
    expect(rows).toEqual(
      [...TABLES].sort().map((relname) => ({ relname, rls: true, forced: true, policies: ["tenant_isolation"] })),
    );
  });

  it("with NO tenant GUC, app_user sees no rows in any of the four tables (control: the migration role sees both schools')", async () => {
    for (const t of TABLES) {
      expect(await countAll(basePrisma, t), `${t} without GUC`).toBe(0);
      expect(await countAll(migrator, t), `${t} as migrator`).toBeGreaterThanOrEqual(2);
    }
  });

  it("each school sees only its own rows", async () => {
    for (const [me, other] of [
      [A, B],
      [B, A],
    ] as const) {
      await withTenant(me.schoolId, async (db) => {
        for (const t of TABLES) {
          const foreign = await db.$queryRawUnsafe<Array<{ n: number }>>(
            `SELECT count(*)::int AS n FROM "${t}" WHERE school_id = $1`,
            other.schoolId,
          );
          expect(foreign[0]!.n, `${t}: other school's rows visible`).toBe(0);
          const mine = await db.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM "${t}"`);
          expect(mine[0]!.n, `${t}: own rows`).toBeGreaterThan(0);
        }
      });
    }
  });

  it("a write carrying ANOTHER school's school_id is rejected by WITH CHECK; the control under the right GUC succeeds", async () => {
    const slot = (schoolId: string, position: number) => ({
      schoolId, position, label: "RLS probe", kind: "OTHER" as const, startMinute: 1300, endMinute: 1310,
    });
    await expect(withTenant(A.schoolId, (db) => db.bellSlot.create({ data: slot(B.schoolId, 90) }))).rejects.toThrow(/row-level security/);
    await expect(
      withTenant(A.schoolId, (db) =>
        db.timetable.create({
          data: { schoolId: B.schoolId, classArmId: B.arms.b, academicYearId: B.year, termId: null, createdBy: "x" },
        }),
      ),
    ).rejects.toThrow(/row-level security/);

    const control = await withTenant(A.schoolId, (db) => db.bellSlot.create({ data: slot(A.schoolId, 90), select: { id: true } }));
    await withTenant(A.schoolId, (db) => db.bellSlot.delete({ where: { id: control.id } }));
  });

  // ===========================================================================
  // 2. Composite foreign keys (D29)
  // ===========================================================================

  describe("under school A's own GUC, a reference to school B's row is rejected by the composite foreign key", () => {
    // Each case: [constraint, insert naming B's row, the same insert naming A's row].
    type Insert = (db: PrismaClient) => Promise<{ id: string }>;
    const entry = (fx: () => TimetableFixture, over: { bellSlotId?: string; subjectId?: string; timetableId?: string }): Insert =>
      (db) =>
        db.timetableEntry.create({
          data: {
            schoolId: A.schoolId,
            timetableId: over.timetableId ?? aTimetable,
            dayOfWeek: 3,
            bellSlotId: over.bellSlotId ?? A.slots.p4,
            subjectId: over.subjectId ?? A.subjects.maths,
            updatedBy: fx().owner.userId,
          },
          select: { id: true },
        });
    const timetable = (over: { classArmId?: string; academicYearId?: string; termId?: string }): Insert =>
      (db) =>
        db.timetable.create({
          data: {
            schoolId: A.schoolId,
            classArmId: over.classArmId ?? A.arms.c,
            academicYearId: over.academicYearId ?? A.year,
            termId: over.termId ?? A.terms.third,
            createdBy: A.owner.userId,
          },
          select: { id: true },
        });

    const publication = (over: { classArmId?: string; termId?: string }): Insert =>
      (db) =>
        db.timetablePublication.create({
          data: {
            schoolId: A.schoolId,
            classArmId: over.classArmId ?? A.arms.c,
            termId: over.termId ?? A.terms.third,
            grid: { slots: [], days: [], lessons: [] },
            contentHash: "0".repeat(64),
            publishedBy: A.owner.userId,
            publishedAt: new Date(),
          },
          select: { id: true },
        });

    const cases: Array<[string, () => Insert, () => Insert]> = [
      ["timetable_entries_school_id_bell_slot_id_fkey", () => entry(() => A, { bellSlotId: B.slots.p4 }), () => entry(() => A, {})],
      ["timetable_entries_school_id_subject_id_fkey", () => entry(() => A, { subjectId: B.subjects.maths }), () => entry(() => A, {})],
      ["timetable_entries_school_id_timetable_id_fkey", () => entry(() => A, { timetableId: bTimetable }), () => entry(() => A, {})],
      ["timetables_school_id_class_arm_id_fkey", () => timetable({ classArmId: B.arms.c }), () => timetable({})],
      ["timetables_school_id_academic_year_id_fkey", () => timetable({ academicYearId: B.year }), () => timetable({})],
      ["timetables_school_id_term_id_fkey", () => timetable({ termId: B.terms.third }), () => timetable({})],
      [
        "timetable_entry_teachers_school_id_teacher_id_fkey",
        () => (db) => db.timetableEntryTeacher.create({ data: { schoolId: A.schoolId, entryId: aEntry, teacherId: B.teachers.uche }, select: { id: true } }),
        () => (db) => db.timetableEntryTeacher.create({ data: { schoolId: A.schoolId, entryId: aEntry, teacherId: A.teachers.uche }, select: { id: true } }),
      ],
      [
        "timetable_publications_school_id_class_arm_id_fkey",
        () => publication({ classArmId: B.arms.c }),
        () => publication({}),
      ],
      [
        "timetable_publications_school_id_term_id_fkey",
        () => publication({ termId: B.terms.third }),
        () => publication({}),
      ],
      [
        "timetable_entry_teachers_school_id_entry_id_fkey",
        () => (db) => db.timetableEntryTeacher.create({ data: { schoolId: A.schoolId, entryId: bEntry, teacherId: A.teachers.uche }, select: { id: true } }),
        () => (db) => db.timetableEntryTeacher.create({ data: { schoolId: A.schoolId, entryId: aEntry, teacherId: A.teachers.uche }, select: { id: true } }),
      ],
    ];

    for (const [constraint, crossSchool, own] of cases) {
      it(constraint, async () => {
        const err = await withTenant(A.schoolId, (db) => crossSchool()(db)).catch((e: unknown) => e);
        expect(err, "cross-school insert must fail").toBeInstanceOf(Error);
        expect(fkName(err)).toContain(constraint);

        // Control: the identical insert naming A's own row succeeds (then removed).
        await withTenant(A.schoolId, async (db) => {
          const ok = await own()(db);
          expect(ok.id).toBeTruthy();
          throw new Rollback();
        }).catch((e: unknown) => {
          if (!(e instanceof Rollback)) throw e;
        });
      });
    }
  });

  it("NECESSITY: with a PLAIN bell_slot_id foreign key instead, the same cross-school insert SUCCEEDS under A's GUC (rolled back)", async () => {
    const inserted = await migrator
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`ALTER TABLE timetable_entries DROP CONSTRAINT timetable_entries_school_id_bell_slot_id_fkey`);
        await tx.$executeRawUnsafe(
          `ALTER TABLE timetable_entries ADD CONSTRAINT probe_plain_bell_slot_fk FOREIGN KEY (bell_slot_id) REFERENCES bell_slots(id)`,
        );
        await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
        await tx.$executeRawUnsafe(`SELECT set_config('app.current_school_id', $1, true)`, A.schoolId);
        // Sanity: under A's GUC, B's slot is invisible to reads…
        const visible = await tx.$queryRawUnsafe<Array<{ n: number }>>(
          `SELECT count(*)::int AS n FROM bell_slots WHERE id = $1`,
          B.slots.p4,
        );
        expect(visible[0]!.n).toBe(0);
        // …and yet the referential check finds it.
        const n = await tx.$executeRawUnsafe(
          `INSERT INTO timetable_entries (id, school_id, timetable_id, day_of_week, bell_slot_id, subject_id, updated_by, updated_at)
           VALUES (gen_random_uuid()::text, $1, $2, 4, $3, $4, 'probe', now())`,
          A.schoolId,
          aTimetable,
          B.slots.p4,
          A.subjects.maths,
        );
        throw Object.assign(new Rollback(), { n });
      })
      .catch((e: unknown) => {
        if (e instanceof Rollback) return (e as Rollback & { n: number }).n;
        throw e;
      });
    expect(inserted).toBe(1);

    // Rolled back: the composite constraint is still in place.
    const still = await migrator.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM pg_constraint WHERE conname = 'timetable_entries_school_id_bell_slot_id_fkey'`,
    );
    expect(still[0]!.n).toBe(1);
  });
});
