import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, PrismaClient, withTenant } from "@school-kit/db";

// Phase 8 / CP1 — Event Calendar isolation. docs/modules/phase-8.md §15.4.
//
// Runs against a REAL Postgres, as the runtime role, on purpose. The claims
// under test are properties of the database (policies, grants, the GUC) and a
// mocked Prisma would test none of them.
//
// TWO DIFFERENT KINDS OF CLAIM:
//
// 1. national_events is PLATFORM data that the runtime role can read but can
//    never write — enforced twice (D22):
//      layer 1  FORCE RLS with a SELECT-only policy and no write policy
//      layer 2  REVOKE INSERT, UPDATE, DELETE FROM app_user
//    Proving "app_user cannot write" with both layers present would pass even
//    if one layer were silently missing. So each layer is ALSO proven ALONE:
//    in a migration-role transaction that is always rolled back, the OTHER
//    layer is removed, the session switches to app_user with SET LOCAL ROLE,
//    and the write must still be refused.
//
// 2. school_events and school_hidden_national_events are ordinary tenant
//    tables: no-GUC reads see nothing, a school sees only itself, and a
//    cross-tenant write is rejected by WITH CHECK — with a control write under
//    the correct GUC succeeding, so the rejection isn't passing for the wrong
//    reason (e.g. a broken table).

const DIRECT_URL = process.env.DIRECT_URL;

describe("Phase 8 CP1 — calendar RLS and the national-events write block", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  // The migration role. Needed only to remove one layer at a time inside a
  // rolled-back transaction; never used to assert anything app_user can do.
  let migrator: PrismaClient;
  let schoolA: { id: string };
  let schoolB: { id: string };
  let nationalEventId: string;
  let nationalEventKey: string;
  let eventA: string;

  beforeAll(async () => {
    if (!DIRECT_URL) {
      throw new Error("DIRECT_URL is required: the layer-isolation tests need the migration role.");
    }
    migrator = new PrismaClient({ datasources: { db: { url: DIRECT_URL } } });

    const ne = await basePrisma.nationalEvent.findFirst({
      where: { key: "democracy-day-2026" },
      select: { id: true, key: true },
    });
    if (!ne) throw new Error("Seed missing: democracy-day-2026 — run migrations first.");
    nationalEventId = ne.id;
    nationalEventKey = ne.key;

    // `schools` has no RLS, so these inserts are fine through basePrisma.
    schoolA = await basePrisma.school.create({
      data: { name: "Calendar A", slug: `cal-a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "Calendar B", slug: `cal-b-${runId}` },
      select: { id: true },
    });

    eventA = await withTenant(schoolA.id, async (db) => {
      const e = await db.schoolEvent.create({
        data: {
          schoolId: schoolA.id,
          title: `A sports day ${runId}`,
          category: "EVENT",
          startDate: new Date("2026-10-16T00:00:00Z"),
          endDate: new Date("2026-10-16T00:00:00Z"),
          createdBy: `user-${runId}`,
          updatedBy: `user-${runId}`,
        },
        select: { id: true },
      });
      return e.id;
    });
    await withTenant(schoolB.id, (db) =>
      db.schoolEvent.create({
        data: {
          schoolId: schoolB.id,
          title: `B PTA meeting ${runId}`,
          category: "MEETING",
          startDate: new Date("2026-10-16T00:00:00Z"),
          endDate: new Date("2026-10-16T00:00:00Z"),
          createdBy: `user-${runId}`,
          updatedBy: `user-${runId}`,
        },
      }),
    );
    await withTenant(schoolA.id, (db) =>
      db.schoolHiddenNationalEvent.create({
        data: { schoolId: schoolA.id, nationalEventId, hiddenBy: `user-${runId}` },
      }),
    );
  });

  afterAll(async () => {
    for (const s of [schoolA, schoolB]) {
      if (!s) continue;
      await withTenant(s.id, async (db) => {
        await db.schoolHiddenNationalEvent.deleteMany({ where: { schoolId: s.id } });
        await db.schoolEvent.deleteMany({ where: { schoolId: s.id } });
      });
    }
    await basePrisma.school.deleteMany({ where: { id: { in: [schoolA?.id, schoolB?.id].filter(Boolean) as string[] } } });
    await migrator?.$disconnect();
    await basePrisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Preconditions — if these fail, every "cannot write" below is meaningless.
  // -------------------------------------------------------------------------

  it("runs as app_user, which has neither SUPERUSER nor BYPASSRLS", async () => {
    const [row] = await basePrisma.$queryRawUnsafe<
      Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
    >(
      `SELECT current_user, r.rolsuper, r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user`,
    );
    // CLAUDE.md hard rule: if DATABASE_URL is ever a privileged role, this
    // suite must fail loudly rather than pass for the wrong reason.
    expect(row.current_user).toBe("app_user");
    expect(row.rolsuper).toBe(false);
    expect(row.rolbypassrls).toBe(false);
  });

  it("national_events has RLS enabled AND forced, with only the SELECT policy", async () => {
    const [rel] = await basePrisma.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
      `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'national_events'`,
    );
    expect(rel).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const policies = await basePrisma.$queryRawUnsafe<Array<{ polname: string; polcmd: string }>>(
      `SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'national_events'::regclass ORDER BY polname`,
    );
    // polcmd 'r' = SELECT. No 'a' (INSERT), 'w' (UPDATE), 'd' (DELETE) or '*' (ALL).
    expect(policies).toEqual([{ polname: "national_events_read_all", polcmd: "r" }]);
  });

  it("app_user holds SELECT on national_events and no INSERT/UPDATE/DELETE/TRUNCATE", async () => {
    const [p] = await basePrisma.$queryRawUnsafe<
      Array<{ sel: boolean; ins: boolean; upd: boolean; del: boolean; trunc: boolean }>
    >(
      `SELECT has_table_privilege('app_user', 'national_events', 'SELECT')   AS sel,
              has_table_privilege('app_user', 'national_events', 'INSERT')   AS ins,
              has_table_privilege('app_user', 'national_events', 'UPDATE')   AS upd,
              has_table_privilege('app_user', 'national_events', 'DELETE')   AS del,
              has_table_privilege('app_user', 'national_events', 'TRUNCATE') AS trunc`,
    );
    // TRUNCATE matters separately: it is not subject to RLS at all.
    expect(p).toEqual({ sel: true, ins: false, upd: false, del: false, trunc: false });
  });

  // -------------------------------------------------------------------------
  // national_events — readable by everyone.
  // -------------------------------------------------------------------------

  it("national_events is readable with NO tenant GUC set", async () => {
    const rows = await basePrisma.nationalEvent.findMany({ select: { key: true } });
    expect(rows.length).toBeGreaterThanOrEqual(22);
    expect(rows.map((r) => r.key)).toContain("democracy-day-2026");
  });

  it("national_events reads identically under two different schools' GUCs", async () => {
    const a = await withTenant(schoolA.id, (db) => db.nationalEvent.count());
    const b = await withTenant(schoolB.id, (db) => db.nationalEvent.count());
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(22);
  });

  // -------------------------------------------------------------------------
  // national_events — app_user cannot write, with BOTH layers present.
  // -------------------------------------------------------------------------

  it("app_user cannot INSERT a national event — through Prisma, with no GUC", async () => {
    await expect(
      basePrisma.nationalEvent.create({
        data: {
          key: `rogue-${runId}`,
          name: "Rogue holiday",
          startDate: new Date("2026-11-11T00:00:00Z"),
          endDate: new Date("2026-11-11T00:00:00Z"),
          kind: "SPECIAL_HOLIDAY",
          dateConfirmed: true,
          source: "test",
        },
      }),
    ).rejects.toThrow(/permission denied/i);
  });

  it("app_user cannot INSERT a national event — through the tenant client, with a GUC set", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.nationalEvent.create({
          data: {
            key: `rogue-tenant-${runId}`,
            name: "Rogue holiday",
            startDate: new Date("2026-11-11T00:00:00Z"),
            endDate: new Date("2026-11-11T00:00:00Z"),
            kind: "SPECIAL_HOLIDAY",
            dateConfirmed: true,
            source: "test",
          },
        }),
      ),
    ).rejects.toThrow(/permission denied/i);
  });

  it("app_user cannot INSERT, UPDATE, DELETE or TRUNCATE national_events through raw SQL", async () => {
    const attempts = [
      `INSERT INTO national_events (id, key, name, start_date, end_date, kind, date_confirmed, source, updated_at)
       VALUES (gen_random_uuid()::text, 'rogue-raw-${runId}', 'Rogue', '2026-11-11', '2026-11-11', 'SPECIAL_HOLIDAY', true, 'test', now())`,
      `UPDATE national_events SET name = 'Tampered' WHERE key = '${nationalEventKey}'`,
      `DELETE FROM national_events WHERE key = '${nationalEventKey}'`,
      `TRUNCATE national_events CASCADE`,
    ];
    for (const sql of attempts) {
      await expect(basePrisma.$executeRawUnsafe(sql), sql).rejects.toThrow(/permission denied/i);
      await expect(
        withTenant(schoolA.id, (db) => db.$executeRawUnsafe(sql)),
        `${sql} (with GUC)`,
      ).rejects.toThrow(/permission denied/i);
    }

    // And nothing actually changed.
    const still = await basePrisma.nationalEvent.findUnique({
      where: { key: nationalEventKey },
      select: { name: true },
    });
    expect(still?.name).toBe("Democracy Day");
    expect(await basePrisma.nationalEvent.count({ where: { key: { startsWith: "rogue" } } })).toBe(0);
  });

  // -------------------------------------------------------------------------
  // national_events — each layer proven ALONE.
  // -------------------------------------------------------------------------

  /**
   * Runs `body` as app_user inside a migration-role transaction that is ALWAYS
   * rolled back, after `setup` (as the migration role) removes one layer.
   * Returns the error `body` threw, or null if it succeeded.
   */
  async function asAppUserWithOneLayerRemoved(
    setup: string[],
    body: (tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<unknown>,
  ): Promise<{ error: Error | null; result: unknown }> {
    const ROLLBACK = new Error("__rollback__");
    let outcome: { error: Error | null; result: unknown } = { error: null, result: undefined };
    try {
      await migrator.$transaction(async (tx) => {
        for (const stmt of setup) await tx.$executeRawUnsafe(stmt);
        await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
        // A savepoint isolates the expected failure from the transaction, so the
        // ROLLBACK below is the only thing that ends it.
        await tx.$executeRawUnsafe(`SAVEPOINT attempt`);
        try {
          outcome = { error: null, result: await body(tx) };
        } catch (e) {
          outcome = { error: e as Error, result: undefined };
          await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT attempt`);
        }
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
    return outcome;
  }

  it("LAYER 1 ALONE (RLS): with the REVOKE undone, app_user's INSERT is still refused by row-level security", async () => {
    const { error } = await asAppUserWithOneLayerRemoved(
      [`GRANT INSERT, UPDATE, DELETE ON national_events TO app_user`],
      (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO national_events (id, key, name, start_date, end_date, kind, date_confirmed, source, updated_at)
           VALUES (gen_random_uuid()::text, 'rogue-l1-${runId}', 'Rogue', '2026-11-11', '2026-11-11', 'SPECIAL_HOLIDAY', true, 'test', now())`,
        ),
    );
    expect(error?.message).toMatch(/row-level security/i);
  });

  it("LAYER 1 ALONE (RLS): with the REVOKE undone, app_user's UPDATE and DELETE match zero rows", async () => {
    // With no UPDATE/DELETE policy, RLS makes every row invisible to those
    // commands: they succeed as statements but affect nothing. That is the
    // documented Postgres behaviour, and the row count is the proof.
    const upd = await asAppUserWithOneLayerRemoved(
      [`GRANT INSERT, UPDATE, DELETE ON national_events TO app_user`],
      (tx) => tx.$executeRawUnsafe(`UPDATE national_events SET name = 'Tampered' WHERE key = '${nationalEventKey}'`),
    );
    expect(upd.error).toBeNull();
    expect(upd.result).toBe(0);

    const del = await asAppUserWithOneLayerRemoved(
      [`GRANT INSERT, UPDATE, DELETE ON national_events TO app_user`],
      (tx) => tx.$executeRawUnsafe(`DELETE FROM national_events WHERE key = '${nationalEventKey}'`),
    );
    expect(del.error).toBeNull();
    expect(del.result).toBe(0);
  });

  it("LAYER 2 ALONE (REVOKE): with a permissive write policy added, app_user's INSERT/UPDATE/DELETE are still refused by privilege", async () => {
    const addWritePolicy = [
      `CREATE POLICY test_allow_all_writes ON national_events FOR ALL USING (true) WITH CHECK (true)`,
    ];
    const statements = [
      `INSERT INTO national_events (id, key, name, start_date, end_date, kind, date_confirmed, source, updated_at)
       VALUES (gen_random_uuid()::text, 'rogue-l2-${runId}', 'Rogue', '2026-11-11', '2026-11-11', 'SPECIAL_HOLIDAY', true, 'test', now())`,
      `UPDATE national_events SET name = 'Tampered' WHERE key = '${nationalEventKey}'`,
      `DELETE FROM national_events WHERE key = '${nationalEventKey}'`,
    ];
    for (const sql of statements) {
      const { error } = await asAppUserWithOneLayerRemoved(addWritePolicy, (tx) => tx.$executeRawUnsafe(sql));
      expect(error?.message, sql).toMatch(/permission denied/i);
    }
  });

  it("CONTROL: with BOTH layers removed, app_user's write succeeds — so the two tests above are not passing for the wrong reason", async () => {
    const { error, result } = await asAppUserWithOneLayerRemoved(
      [
        `GRANT INSERT, UPDATE, DELETE ON national_events TO app_user`,
        `CREATE POLICY test_allow_all_writes ON national_events FOR ALL USING (true) WITH CHECK (true)`,
      ],
      (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO national_events (id, key, name, start_date, end_date, kind, date_confirmed, source, updated_at)
           VALUES (gen_random_uuid()::text, 'rogue-control-${runId}', 'Rogue', '2026-11-11', '2026-11-11', 'SPECIAL_HOLIDAY', true, 'test', now())`,
        ),
    );
    expect(error).toBeNull();
    expect(result).toBe(1);
    // Everything above was rolled back.
    expect(await basePrisma.nationalEvent.count({ where: { key: { startsWith: "rogue" } } })).toBe(0);
    const policies = await basePrisma.$queryRawUnsafe<Array<{ polname: string }>>(
      `SELECT polname FROM pg_policy WHERE polrelid = 'national_events'::regclass`,
    );
    expect(policies.map((p) => p.polname)).toEqual(["national_events_read_all"]);
  });

  // -------------------------------------------------------------------------
  // Tenant tables — ordinary isolation.
  // -------------------------------------------------------------------------

  it("school_events: a read with no GUC returns nothing", async () => {
    expect(await basePrisma.schoolEvent.count()).toBe(0);
  });

  it("school_events: each school sees only its own events", async () => {
    const a = await withTenant(schoolA.id, (db) => db.schoolEvent.findMany({ select: { schoolId: true, title: true } }));
    const b = await withTenant(schoolB.id, (db) => db.schoolEvent.findMany({ select: { schoolId: true, title: true } }));
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((e) => e.schoolId === schoolA.id)).toBe(true);
    expect(b.every((e) => e.schoolId === schoolB.id)).toBe(true);
    expect(b.map((e) => e.title)).not.toContain(`A sports day ${runId}`);
  });

  it("school_events: a cross-tenant INSERT is rejected by WITH CHECK, while the control insert succeeds", async () => {
    const data = (schoolId: string) => ({
      schoolId,
      title: `probe ${runId}`,
      category: "OTHER" as const,
      startDate: new Date("2026-10-20T00:00:00Z"),
      endDate: new Date("2026-10-20T00:00:00Z"),
      createdBy: `user-${runId}`,
      updatedBy: `user-${runId}`,
    });

    await expect(withTenant(schoolA.id, (db) => db.schoolEvent.create({ data: data(schoolB.id) }))).rejects.toThrow(
      /row-level security/i,
    );
    const ok = await withTenant(schoolA.id, (db) => db.schoolEvent.create({ data: data(schoolA.id), select: { id: true } }));
    expect(ok.id).toBeTruthy();
  });

  it("school_events: school B cannot update or delete school A's event, even by id", async () => {
    const upd = await withTenant(schoolB.id, (db) =>
      db.schoolEvent.updateMany({ where: { id: eventA }, data: { title: "hijacked" } }),
    );
    const del = await withTenant(schoolB.id, (db) => db.schoolEvent.deleteMany({ where: { id: eventA } }));
    expect(upd.count).toBe(0);
    expect(del.count).toBe(0);
    const still = await withTenant(schoolA.id, (db) =>
      db.schoolEvent.findUnique({ where: { id: eventA }, select: { title: true } }),
    );
    expect(still?.title).toBe(`A sports day ${runId}`);
  });

  it("school_events: the end_date >= start_date CHECK is enforced by the database", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.schoolEvent.create({
          data: {
            schoolId: schoolA.id,
            title: "backwards",
            category: "OTHER",
            startDate: new Date("2026-10-20T00:00:00Z"),
            endDate: new Date("2026-10-19T00:00:00Z"),
            createdBy: "x",
            updatedBy: "x",
          },
        }),
      ),
    ).rejects.toThrow(/school_events_date_range_check/);
  });

  it("school_hidden_national_events: no-GUC read sees nothing; each school sees only its own hides", async () => {
    expect(await basePrisma.schoolHiddenNationalEvent.count()).toBe(0);
    expect(await withTenant(schoolA.id, (db) => db.schoolHiddenNationalEvent.count())).toBe(1);
    expect(await withTenant(schoolB.id, (db) => db.schoolHiddenNationalEvent.count())).toBe(0);
  });

  it("school_hidden_national_events: a cross-tenant hide is rejected by WITH CHECK, while the control hide succeeds", async () => {
    await expect(
      withTenant(schoolB.id, (db) =>
        db.schoolHiddenNationalEvent.create({
          data: { schoolId: schoolA.id, nationalEventId, hiddenBy: "x" },
        }),
      ),
    ).rejects.toThrow(/row-level security/i);

    const ok = await withTenant(schoolB.id, (db) =>
      db.schoolHiddenNationalEvent.create({
        data: { schoolId: schoolB.id, nationalEventId, hiddenBy: "x" },
        select: { id: true },
      }),
    );
    expect(ok.id).toBeTruthy();
    await withTenant(schoolB.id, (db) => db.schoolHiddenNationalEvent.delete({ where: { id: ok.id } }));
  });
});
