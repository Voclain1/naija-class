import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db/tenant-client";

// Tenancy is the single bug class that can end the business overnight.
// This suite exercises BOTH layers of defence: the application helper
// (withTenant) and the underlying Postgres RLS policy. Either failing alone
// would be a leak.
//
// We touch the real dev database on purpose. Mocking Prisma here would defeat
// the point — the policies, the GUC, and the set_config call must all line up.

describe("multi-tenant isolation (Phase 0 RLS)", () => {
  // Reuse the same two schools across the suite. Random slugs so re-runs do
  // not collide with leftover data and so the test does not need to drop
  // tables.
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string; slug: string };
  let schoolB: { id: string; slug: string };
  let userInA: { id: string };
  let userInB: { id: string };

  beforeAll(async () => {
    // schools has no RLS, so this admin-style insert is fine.
    schoolA = await basePrisma.school.create({
      data: {
        name: "School A",
        slug: `rls-a-${runId}`,
      },
      select: { id: true, slug: true },
    });
    schoolB = await basePrisma.school.create({
      data: {
        name: "School B",
        slug: `rls-b-${runId}`,
      },
      select: { id: true, slug: true },
    });

    // users IS under RLS+FORCE, so the insert MUST happen inside withTenant.
    userInA = await withTenant(schoolA.id, (db) =>
      db.user.create({
        data: {
          schoolId: schoolA.id,
          email: `owner-${runId}@school-a.test`,
          firstName: "Alpha",
          lastName: "Owner",
        },
        select: { id: true },
      }),
    );
    userInB = await withTenant(schoolB.id, (db) =>
      db.user.create({
        data: {
          schoolId: schoolB.id,
          email: `owner-${runId}@school-b.test`,
          firstName: "Bravo",
          lastName: "Owner",
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    // Cascading FKs clean up users when we drop schools.
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("Prisma client scoped to School A returns only School A's users", async () => {
    const usersForA = await withTenant(schoolA.id, (db) =>
      db.user.findMany({ where: { email: { contains: runId } } }),
    );

    const ids = usersForA.map((u) => u.id);
    expect(ids).toContain(userInA.id);
    expect(ids).not.toContain(userInB.id);
  });

  it("Prisma client scoped to School B returns only School B's users", async () => {
    const usersForB = await withTenant(schoolB.id, (db) =>
      db.user.findMany({ where: { email: { contains: runId } } }),
    );

    const ids = usersForB.map((u) => u.id);
    expect(ids).toContain(userInB.id);
    expect(ids).not.toContain(userInA.id);
  });

  it("withTenant cannot look up School B's user directly by id from School A's context", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.user.findUnique({ where: { id: userInB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT into the wrong tenant fails the WITH CHECK clause", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.user.create({
          data: {
            // Trying to insert a row into school B while scoped to school A.
            schoolId: schoolB.id,
            firstName: "Mallory",
            lastName: "Imposter",
            email: `imposter-${runId}@school-b.test`,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL: SET app.current_school_id filters SELECT to that school only (spec acceptance criterion #4)", async () => {
    // Mirror the spec's verbatim acceptance criterion: connect to DB, set the
    // GUC, SELECT, and assert isolation. Wrapped in a transaction so SET LOCAL
    // applies to the same connection.
    const rowsForA = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolA.id}, true)`;
      return tx.$queryRaw<Array<{ id: string; school_id: string }>>`
        SELECT id, school_id FROM users WHERE email LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rowsForA.every((r) => r.school_id === schoolA.id)).toBe(true);
    expect(rowsForA.map((r) => r.id)).toContain(userInA.id);
    expect(rowsForA.map((r) => r.id)).not.toContain(userInB.id);

    const rowsForB = await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${schoolB.id}, true)`;
      return tx.$queryRaw<Array<{ id: string; school_id: string }>>`
        SELECT id, school_id FROM users WHERE email LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rowsForB.every((r) => r.school_id === schoolB.id)).toBe(true);
    expect(rowsForB.map((r) => r.id)).toContain(userInB.id);
    expect(rowsForB.map((r) => r.id)).not.toContain(userInA.id);
  });

  it("raw SQL: unset GUC returns zero tenant rows (FORCE RLS prevents bypass)", async () => {
    // No SET LOCAL — the policy's `current_setting('app.current_school_id', true)`
    // returns NULL/empty, which matches nothing. FORCE means even the table
    // owner (us) cannot read.
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM users WHERE email LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });

  it("withTenant refuses non-UUID schoolId", async () => {
    await expect(
      withTenant("not-a-uuid", async () => "should never run"),
    ).rejects.toThrow(/UUID/);
  });
});
