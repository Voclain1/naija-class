import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

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

// ---------------------------------------------------------------------------
// Phase 1 / Slice 1 isolation — academic_years + terms
//
// Every new tenant-scoped table from Phase 1 needs the same isolation
// invariants Phase 0 proved on users. The discipline going forward: each
// Phase 1 slice appends a describe block here covering its own tables.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 1 (academic_years + terms)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let yearA: { id: string };
  let yearB: { id: string };
  let termA: { id: string };
  let termB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1A", slug: `rls-p1a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1B", slug: `rls-p1b-${runId}` },
      select: { id: true },
    });

    // Inserts MUST happen inside withTenant — both tables are FORCE-RLS'd.
    yearA = await withTenant(schoolA.id, (db) =>
      db.academicYear.create({
        data: {
          schoolId: schoolA.id,
          label: `A-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      }),
    );
    yearB = await withTenant(schoolB.id, (db) =>
      db.academicYear.create({
        data: {
          schoolId: schoolB.id,
          label: `B-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      }),
    );
    termA = await withTenant(schoolA.id, (db) =>
      db.term.create({
        data: {
          schoolId: schoolA.id,
          academicYearId: yearA.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
        },
        select: { id: true },
      }),
    );
    termB = await withTenant(schoolB.id, (db) =>
      db.term.create({
        data: {
          schoolId: schoolB.id,
          academicYearId: yearB.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own academic_year and term only", async () => {
    const years = await withTenant(schoolA.id, (db) => db.academicYear.findMany());
    const terms = await withTenant(schoolA.id, (db) => db.term.findMany());
    expect(years.map((y) => y.id)).toContain(yearA.id);
    expect(years.map((y) => y.id)).not.toContain(yearB.id);
    expect(terms.map((t) => t.id)).toContain(termA.id);
    expect(terms.map((t) => t.id)).not.toContain(termB.id);
  });

  it("School B sees its own academic_year and term only", async () => {
    const years = await withTenant(schoolB.id, (db) => db.academicYear.findMany());
    const terms = await withTenant(schoolB.id, (db) => db.term.findMany());
    expect(years.map((y) => y.id)).toContain(yearB.id);
    expect(years.map((y) => y.id)).not.toContain(yearA.id);
    expect(terms.map((t) => t.id)).toContain(termB.id);
    expect(terms.map((t) => t.id)).not.toContain(termA.id);
  });

  it("findUnique across tenants returns null (not a 404 helper — real isolation)", async () => {
    const leakedYear = await withTenant(schoolA.id, (db) =>
      db.academicYear.findUnique({ where: { id: yearB.id } }),
    );
    const leakedTerm = await withTenant(schoolA.id, (db) =>
      db.term.findUnique({ where: { id: termB.id } }),
    );
    expect(leakedYear).toBeNull();
    expect(leakedTerm).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.academicYear.create({
          data: {
            schoolId: schoolB.id,
            label: `bad-${runId}`,
            startDate: new Date("2025-09-01"),
            endDate: new Date("2026-07-31"),
          },
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenant(schoolA.id, (db) =>
        db.term.create({
          data: {
            schoolId: schoolB.id,
            academicYearId: yearA.id,
            sequence: 2,
            name: "Sneaky",
            startDate: new Date("2025-09-01"),
            endDate: new Date("2025-12-15"),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from both new tables (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      const ys = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM academic_years WHERE label LIKE ${"%" + runId + "%"}
      `;
      const ts = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM terms WHERE id IN (${termA.id}, ${termB.id})
      `;
      return { ys, ts };
    });
    expect(rows.ys).toHaveLength(0);
    expect(rows.ts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 / Slice 2 isolation — class_levels
//
// class_levels is FORCE RLS'd and tenant-scoped via school_id. The seed-on-
// signup runs inside the existing signupOwner tx and satisfies WITH CHECK
// because the GUC is already set there; this spec proves the steady-state
// isolation invariant — that schools cannot see each other's levels and
// cannot insert into each other's tenant.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 2 (class_levels)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let levelA: { id: string };
  let levelB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1S2A", slug: `rls-p1s2a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1S2B", slug: `rls-p1s2b-${runId}` },
      select: { id: true },
    });

    // Insert custom levels via withTenant (bypassing the signupOwner seed
    // entirely — this suite is about steady-state isolation, not seed
    // semantics; the seed is covered in class-levels.service.spec.ts).
    levelA = await withTenant(schoolA.id, (db) =>
      db.classLevel.create({
        data: {
          schoolId: schoolA.id,
          name: `A-only-${runId}`,
          code: `a-${runId}`,
          stage: "PRIMARY",
          orderIndex: 100,
        },
        select: { id: true },
      }),
    );
    levelB = await withTenant(schoolB.id, (db) =>
      db.classLevel.create({
        data: {
          schoolId: schoolB.id,
          name: `B-only-${runId}`,
          code: `b-${runId}`,
          stage: "PRIMARY",
          orderIndex: 100,
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own class_level only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.classLevel.findMany({ where: { name: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(levelA.id);
    expect(ids).not.toContain(levelB.id);
  });

  it("School B sees its own class_level only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.classLevel.findMany({ where: { name: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(levelB.id);
    expect(ids).not.toContain(levelA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.classLevel.findUnique({ where: { id: levelB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.classLevel.create({
          data: {
            schoolId: schoolB.id,
            name: `bad-${runId}`,
            code: `bad-${runId}`,
            stage: "PRIMARY",
            orderIndex: 200,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from class_levels (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM class_levels WHERE name LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 / Slice 3 isolation — class_arms + subjects + class_subjects
//
// Three more tenant-scoped tables, same direct-RLS shape as slices 1+2.
// class_subjects is an explicit join (ClassLevel × Subject) with its own
// school_id rather than EXISTS-through-parent — the spec calls this out
// (docs/modules/phase-1.md "Note on student_guardians"). The suite proves
// the steady-state isolation invariant for all three tables, plus the
// WITH CHECK guard against cross-tenant inserts.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 3 (class_arms + subjects + class_subjects)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let levelA: { id: string };
  let levelB: { id: string };
  let armA: { id: string };
  let armB: { id: string };
  let subjectA: { id: string };
  let subjectB: { id: string };
  let classSubjectA: { id: string };
  let classSubjectB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1S3A", slug: `rls-p1s3a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1S3B", slug: `rls-p1s3b-${runId}` },
      select: { id: true },
    });

    // class_arms depends on class_levels and (optionally) users; class_subjects
    // depends on class_levels and subjects. We seed a custom level per school
    // for relation targets — the signup seed isn't running here.
    levelA = await withTenant(schoolA.id, (db) =>
      db.classLevel.create({
        data: {
          schoolId: schoolA.id,
          name: `A-lvl-${runId}`,
          code: `a-lvl-${runId}`,
          stage: "JSS",
          orderIndex: 100,
        },
        select: { id: true },
      }),
    );
    levelB = await withTenant(schoolB.id, (db) =>
      db.classLevel.create({
        data: {
          schoolId: schoolB.id,
          name: `B-lvl-${runId}`,
          code: `b-lvl-${runId}`,
          stage: "JSS",
          orderIndex: 100,
        },
        select: { id: true },
      }),
    );

    armA = await withTenant(schoolA.id, (db) =>
      db.classArm.create({
        data: {
          schoolId: schoolA.id,
          classLevelId: levelA.id,
          name: `A-arm-${runId}`,
          code: `a-arm-${runId}`,
        },
        select: { id: true },
      }),
    );
    armB = await withTenant(schoolB.id, (db) =>
      db.classArm.create({
        data: {
          schoolId: schoolB.id,
          classLevelId: levelB.id,
          name: `B-arm-${runId}`,
          code: `b-arm-${runId}`,
        },
        select: { id: true },
      }),
    );

    subjectA = await withTenant(schoolA.id, (db) =>
      db.subject.create({
        data: {
          schoolId: schoolA.id,
          name: `A-sub-${runId}`,
          code: `a-sub-${runId}`,
        },
        select: { id: true },
      }),
    );
    subjectB = await withTenant(schoolB.id, (db) =>
      db.subject.create({
        data: {
          schoolId: schoolB.id,
          name: `B-sub-${runId}`,
          code: `b-sub-${runId}`,
        },
        select: { id: true },
      }),
    );

    classSubjectA = await withTenant(schoolA.id, (db) =>
      db.classSubject.create({
        data: {
          schoolId: schoolA.id,
          classLevelId: levelA.id,
          subjectId: subjectA.id,
        },
        select: { id: true },
      }),
    );
    classSubjectB = await withTenant(schoolB.id, (db) =>
      db.classSubject.create({
        data: {
          schoolId: schoolB.id,
          classLevelId: levelB.id,
          subjectId: subjectB.id,
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own class_arm, subject, and class_subject only", async () => {
    const result = await withTenant(schoolA.id, async (db) => ({
      arms: await db.classArm.findMany({ where: { name: { contains: runId } } }),
      subjects: await db.subject.findMany({ where: { name: { contains: runId } } }),
      classSubjects: await db.classSubject.findMany({
        where: { classLevel: { name: { contains: runId } } },
      }),
    }));

    expect(result.arms.map((r) => r.id)).toContain(armA.id);
    expect(result.arms.map((r) => r.id)).not.toContain(armB.id);
    expect(result.subjects.map((r) => r.id)).toContain(subjectA.id);
    expect(result.subjects.map((r) => r.id)).not.toContain(subjectB.id);
    expect(result.classSubjects.map((r) => r.id)).toContain(classSubjectA.id);
    expect(result.classSubjects.map((r) => r.id)).not.toContain(classSubjectB.id);
  });

  it("School B sees its own class_arm, subject, and class_subject only", async () => {
    const result = await withTenant(schoolB.id, async (db) => ({
      arms: await db.classArm.findMany({ where: { name: { contains: runId } } }),
      subjects: await db.subject.findMany({ where: { name: { contains: runId } } }),
      classSubjects: await db.classSubject.findMany({
        where: { classLevel: { name: { contains: runId } } },
      }),
    }));

    expect(result.arms.map((r) => r.id)).toContain(armB.id);
    expect(result.arms.map((r) => r.id)).not.toContain(armA.id);
    expect(result.subjects.map((r) => r.id)).toContain(subjectB.id);
    expect(result.subjects.map((r) => r.id)).not.toContain(subjectA.id);
    expect(result.classSubjects.map((r) => r.id)).toContain(classSubjectB.id);
    expect(result.classSubjects.map((r) => r.id)).not.toContain(classSubjectA.id);
  });

  it("findUnique across tenants returns null for all three tables", async () => {
    const leakArm = await withTenant(schoolA.id, (db) =>
      db.classArm.findUnique({ where: { id: armB.id } }),
    );
    const leakSubject = await withTenant(schoolA.id, (db) =>
      db.subject.findUnique({ where: { id: subjectB.id } }),
    );
    const leakClassSubject = await withTenant(schoolA.id, (db) =>
      db.classSubject.findUnique({ where: { id: classSubjectB.id } }),
    );
    expect(leakArm).toBeNull();
    expect(leakSubject).toBeNull();
    expect(leakClassSubject).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause (all three tables)", async () => {
    // class_arms with foreign school_id
    await expect(
      withTenant(schoolA.id, (db) =>
        db.classArm.create({
          data: {
            schoolId: schoolB.id,
            classLevelId: levelA.id,
            name: `bad-arm-${runId}`,
            code: `bad-arm-${runId}`,
          },
        }),
      ),
    ).rejects.toThrow();

    // subjects with foreign school_id
    await expect(
      withTenant(schoolA.id, (db) =>
        db.subject.create({
          data: {
            schoolId: schoolB.id,
            name: `bad-sub-${runId}`,
            code: `bad-sub-${runId}`,
          },
        }),
      ),
    ).rejects.toThrow();

    // class_subjects with foreign school_id — parent ids are A's, but
    // school_id is B. WITH CHECK should reject before the FK fires.
    await expect(
      withTenant(schoolA.id, (db) =>
        db.classSubject.create({
          data: {
            schoolId: schoolB.id,
            classLevelId: levelA.id,
            subjectId: subjectA.id,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from all three tables (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      const arms = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM class_arms WHERE name LIKE ${"%" + runId + "%"}
      `;
      const subjects = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM subjects WHERE name LIKE ${"%" + runId + "%"}
      `;
      const classSubjects = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM class_subjects WHERE id IN (${classSubjectA.id}, ${classSubjectB.id})
      `;
      return { arms, subjects, classSubjects };
    });
    expect(rows.arms).toHaveLength(0);
    expect(rows.subjects).toHaveLength(0);
    expect(rows.classSubjects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 / Slice 4 isolation — students
//
// students is FORCE RLS'd with the same direct-school_id shape as every
// other Phase 1 slice. This suite proves the steady-state invariant: each
// school sees only its own students, cross-tenant findUnique returns null,
// and an attempt to INSERT with another school's school_id is rejected by
// the WITH CHECK clause. dateOfBirth uses @db.Date (calendar date, no
// time-of-day) — Prisma still serialises it as a JS Date in the client.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 4 (students)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let studentA: { id: string };
  let studentB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1S4A", slug: `rls-p1s4a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1S4B", slug: `rls-p1s4b-${runId}` },
      select: { id: true },
    });

    studentA = await withTenant(schoolA.id, (db) =>
      db.student.create({
        data: {
          schoolId: schoolA.id,
          admissionNumber: `A-${runId}`,
          firstName: "Ada",
          lastName: `Alpha-${runId}`,
          dateOfBirth: new Date("2014-03-15"),
          gender: "FEMALE",
        },
        select: { id: true },
      }),
    );
    studentB = await withTenant(schoolB.id, (db) =>
      db.student.create({
        data: {
          schoolId: schoolB.id,
          admissionNumber: `B-${runId}`,
          firstName: "Bola",
          lastName: `Bravo-${runId}`,
          dateOfBirth: new Date("2013-09-22"),
          gender: "MALE",
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own student only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.student.findMany({ where: { lastName: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(studentA.id);
    expect(ids).not.toContain(studentB.id);
  });

  it("School B sees its own student only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.student.findMany({ where: { lastName: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(studentB.id);
    expect(ids).not.toContain(studentA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.student.findUnique({ where: { id: studentB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.student.create({
          data: {
            schoolId: schoolB.id,
            admissionNumber: `bad-${runId}`,
            firstName: "Mallory",
            lastName: `Imposter-${runId}`,
            dateOfBirth: new Date("2014-01-01"),
            gender: "OTHER",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from students (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM students WHERE last_name LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 / Slice 5 isolation — guardians + student_guardians
//
// Same direct-school_id shape as every prior Phase 1 slice. student_guardians
// carries its own school_id (denormalised from student + guardian at write
// time) so RLS enforcement is a single column check, not EXISTS-through-
// parent — see docs/modules/phase-1.md "Note on student_guardians" for the
// rationale. Suite proves: (a) each school sees only its own guardians and
// link rows, (b) findUnique cross-tenant returns null, (c) WITH CHECK
// rejects cross-tenant inserts on both tables, including a link row whose
// parent ids are A's but whose school_id is B's.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 5 (guardians + student_guardians)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let studentA: { id: string };
  let studentB: { id: string };
  let guardianA: { id: string };
  let guardianB: { id: string };
  let linkA: { id: string };
  let linkB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1S5A", slug: `rls-p1s5a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1S5B", slug: `rls-p1s5b-${runId}` },
      select: { id: true },
    });

    studentA = await withTenant(schoolA.id, (db) =>
      db.student.create({
        data: {
          schoolId: schoolA.id,
          admissionNumber: `A-S5-${runId}`,
          firstName: "Ada",
          lastName: `Alpha-${runId}`,
          dateOfBirth: new Date("2014-03-15"),
          gender: "FEMALE",
        },
        select: { id: true },
      }),
    );
    studentB = await withTenant(schoolB.id, (db) =>
      db.student.create({
        data: {
          schoolId: schoolB.id,
          admissionNumber: `B-S5-${runId}`,
          firstName: "Bola",
          lastName: `Bravo-${runId}`,
          dateOfBirth: new Date("2013-09-22"),
          gender: "MALE",
        },
        select: { id: true },
      }),
    );

    guardianA = await withTenant(schoolA.id, (db) =>
      db.guardian.create({
        data: {
          schoolId: schoolA.id,
          firstName: "GuA",
          lastName: `GuAlpha-${runId}`,
          relationship: "MOTHER",
          phone: `+2348011${runId.slice(0, 6)}`,
        },
        select: { id: true },
      }),
    );
    guardianB = await withTenant(schoolB.id, (db) =>
      db.guardian.create({
        data: {
          schoolId: schoolB.id,
          firstName: "GuB",
          lastName: `GuBravo-${runId}`,
          relationship: "FATHER",
          phone: `+2348022${runId.slice(0, 6)}`,
        },
        select: { id: true },
      }),
    );

    linkA = await withTenant(schoolA.id, (db) =>
      db.studentGuardian.create({
        data: {
          schoolId: schoolA.id,
          studentId: studentA.id,
          guardianId: guardianA.id,
        },
        select: { id: true },
      }),
    );
    linkB = await withTenant(schoolB.id, (db) =>
      db.studentGuardian.create({
        data: {
          schoolId: schoolB.id,
          studentId: studentB.id,
          guardianId: guardianB.id,
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own guardian and link only", async () => {
    const result = await withTenant(schoolA.id, async (db) => ({
      guardians: await db.guardian.findMany({ where: { lastName: { contains: runId } } }),
      links: await db.studentGuardian.findMany({ where: { studentId: studentA.id } }),
    }));
    expect(result.guardians.map((g) => g.id)).toContain(guardianA.id);
    expect(result.guardians.map((g) => g.id)).not.toContain(guardianB.id);
    expect(result.links.map((l) => l.id)).toContain(linkA.id);
    expect(result.links.map((l) => l.id)).not.toContain(linkB.id);
  });

  it("School B sees its own guardian and link only", async () => {
    const result = await withTenant(schoolB.id, async (db) => ({
      guardians: await db.guardian.findMany({ where: { lastName: { contains: runId } } }),
      links: await db.studentGuardian.findMany({ where: { studentId: studentB.id } }),
    }));
    expect(result.guardians.map((g) => g.id)).toContain(guardianB.id);
    expect(result.guardians.map((g) => g.id)).not.toContain(guardianA.id);
    expect(result.links.map((l) => l.id)).toContain(linkB.id);
    expect(result.links.map((l) => l.id)).not.toContain(linkA.id);
  });

  it("findUnique across tenants returns null for both tables", async () => {
    const leakGuardian = await withTenant(schoolA.id, (db) =>
      db.guardian.findUnique({ where: { id: guardianB.id } }),
    );
    const leakLink = await withTenant(schoolA.id, (db) =>
      db.studentGuardian.findUnique({ where: { id: linkB.id } }),
    );
    expect(leakGuardian).toBeNull();
    expect(leakLink).toBeNull();
  });

  it("INSERT guardian with another school's school_id fails the WITH CHECK clause", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.guardian.create({
          data: {
            schoolId: schoolB.id,
            firstName: "Bad",
            lastName: `bad-${runId}`,
            relationship: "OTHER",
            phone: "+2348099999999",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("INSERT student_guardian with foreign school_id (but A's parent ids) fails WITH CHECK", async () => {
    // The mischief case: a controller in school A tries to write a link
    // row pointing at A's student + A's guardian but with school_id = B.
    // WITH CHECK is the second-line defence that catches it.
    await expect(
      withTenant(schoolA.id, (db) =>
        db.studentGuardian.create({
          data: {
            schoolId: schoolB.id,
            studentId: studentA.id,
            guardianId: guardianA.id,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from both tables (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      const guardians = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM guardians WHERE last_name LIKE ${"%" + runId + "%"}
      `;
      const links = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM student_guardians WHERE id IN (${linkA.id}, ${linkB.id})
      `;
      return { guardians, links };
    });
    expect(rows.guardians).toHaveLength(0);
    expect(rows.links).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 / Slice 6 isolation — import_jobs
//
// First table written by a BullMQ worker (not just request handlers). The
// worker establishes tenant context from job.data.schoolId via the
// tenantWorker() wrapper in apps/api/src/common/queue/tenant-worker.ts,
// which calls withTenant() before any DB access. This spec proves the
// steady-state RLS invariant that protects that pattern: if the GUC were
// ever unset (e.g. a future processor wired without the wrapper), reads
// return zero rows and inserts fail WITH CHECK, failing loud rather than
// leaking. The "raw SQL with unset GUC" check is the explicit proof.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 6 (import_jobs)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let userA: { id: string };
  let userB: { id: string };
  let jobA: { id: string };
  let jobB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1S6A", slug: `rls-p1s6a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1S6B", slug: `rls-p1s6b-${runId}` },
      select: { id: true },
    });

    // import_jobs.createdBy is a TEXT FK pointing at users.id but with
    // no FK constraint at the schema level (createdBy is not a relation
    // in the Prisma model). We still create real user rows because the
    // *audit_logs* (slice 7) will enforce the FK, and we want the
    // test schools to look like real schools.
    userA = await withTenant(schoolA.id, (db) =>
      db.user.create({
        data: {
          schoolId: schoolA.id,
          email: `imports-${runId}@school-a.test`,
          firstName: "ImpA",
          lastName: "Owner",
        },
        select: { id: true },
      }),
    );
    userB = await withTenant(schoolB.id, (db) =>
      db.user.create({
        data: {
          schoolId: schoolB.id,
          email: `imports-${runId}@school-b.test`,
          firstName: "ImpB",
          lastName: "Owner",
        },
        select: { id: true },
      }),
    );

    jobA = await withTenant(schoolA.id, (db) =>
      db.importJob.create({
        data: {
          schoolId: schoolA.id,
          type: "STUDENTS",
          status: "PENDING",
          sourceFileUrl: `schools/${schoolA.id}/imports/A-${runId}/source.csv`,
          createdBy: userA.id,
        },
        select: { id: true },
      }),
    );
    jobB = await withTenant(schoolB.id, (db) =>
      db.importJob.create({
        data: {
          schoolId: schoolB.id,
          type: "STUDENTS",
          status: "PENDING",
          sourceFileUrl: `schools/${schoolB.id}/imports/B-${runId}/source.csv`,
          createdBy: userB.id,
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own import_job only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.importJob.findMany({ where: { sourceFileUrl: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(jobA.id);
    expect(ids).not.toContain(jobB.id);
  });

  it("School B sees its own import_job only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.importJob.findMany({ where: { sourceFileUrl: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(jobB.id);
    expect(ids).not.toContain(jobA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.importJob.findUnique({ where: { id: jobB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    // The worker mischief case: an attacker who somehow controls the
    // BullMQ job data sets schoolId=A but tries to write a row with
    // school_id=B. tenantWorker() would refuse if the GUC didn't
    // match, but WITH CHECK is the second-line defence at the DB.
    await expect(
      withTenant(schoolA.id, (db) =>
        db.importJob.create({
          data: {
            schoolId: schoolB.id,
            type: "STUDENTS",
            status: "PENDING",
            sourceFileUrl: `schools/${schoolB.id}/imports/bad-${runId}/source.csv`,
            createdBy: userA.id,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from import_jobs (FORCE RLS)", async () => {
    // This is the explicit proof that a worker which somehow bypassed
    // tenantWorker() — and therefore withTenant — could not read or
    // operate on import_jobs rows. RLS fails closed: no GUC means
    // current_setting('app.current_school_id', true) returns NULL/empty,
    // which matches no row. The defence in depth that backstops the
    // tenantWorker invariant.
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM import_jobs WHERE source_file_url LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 / Slice 10 isolation — teacher_profiles
//
// teacher_profiles is FORCE RLS'd with the same direct-school_id shape as
// every other Phase 1 table. It carries a user_id FK (1:1 with users), so the
// fixture creates a user per school before the profile. This suite proves:
// each school sees only its own profile, cross-tenant findUnique returns null,
// a cross-tenant INSERT is rejected by WITH CHECK, and an unset GUC returns
// zero rows (FORCE RLS fails closed).
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 10 (teacher_profiles)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let userA: { id: string };
  let userB: { id: string };
  let spareUserA: { id: string };
  let profileA: { id: string };
  let profileB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1S10A", slug: `rls-p1s10a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1S10B", slug: `rls-p1s10b-${runId}` },
      select: { id: true },
    });

    userA = await withTenant(schoolA.id, (db) =>
      db.user.create({
        data: {
          schoolId: schoolA.id,
          email: `teacher-${runId}@school-a.test`,
          firstName: "TeachA",
          lastName: `Alpha-${runId}`,
        },
        select: { id: true },
      }),
    );
    userB = await withTenant(schoolB.id, (db) =>
      db.user.create({
        data: {
          schoolId: schoolB.id,
          email: `teacher-${runId}@school-b.test`,
          firstName: "TeachB",
          lastName: `Bravo-${runId}`,
        },
        select: { id: true },
      }),
    );
    // A second user in School A with NO profile — used by the WITH CHECK
    // test so the rejection is unambiguously the school_id mismatch, not the
    // user_id uniqueness constraint.
    spareUserA = await withTenant(schoolA.id, (db) =>
      db.user.create({
        data: {
          schoolId: schoolA.id,
          email: `teacher-spare-${runId}@school-a.test`,
          firstName: "SpareA",
          lastName: `Spare-${runId}`,
        },
        select: { id: true },
      }),
    );

    profileA = await withTenant(schoolA.id, (db) =>
      db.teacherProfile.create({
        data: {
          schoolId: schoolA.id,
          userId: userA.id,
          staffNumber: `A-${runId}`,
        },
        select: { id: true },
      }),
    );
    profileB = await withTenant(schoolB.id, (db) =>
      db.teacherProfile.create({
        data: {
          schoolId: schoolB.id,
          userId: userB.id,
          staffNumber: `B-${runId}`,
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own teacher_profile only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.teacherProfile.findMany({ where: { staffNumber: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(profileA.id);
    expect(ids).not.toContain(profileB.id);
  });

  it("School B sees its own teacher_profile only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.teacherProfile.findMany({ where: { staffNumber: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(profileB.id);
    expect(ids).not.toContain(profileA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.teacherProfile.findUnique({ where: { id: profileB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.teacherProfile.create({
          data: {
            schoolId: schoolB.id,
            userId: spareUserA.id,
            staffNumber: `bad-${runId}`,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from teacher_profiles (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM teacher_profiles WHERE staff_number LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 / Slice 11 isolation — teacher_assignments
//
// teacher_assignments is FORCE RLS'd with the same direct-school_id shape as
// every Phase 1 table. It carries four FKs (teacher→users, class_arm,
// subject, academic_year) plus an optional term FK, so the fixture builds a
// full academic mini-structure per school before the assignment row. This is
// the table the teacher-scope filter reads (cp2) — but the scope filter is
// application-level authorization layered ON TOP of this policy; this suite
// proves only the tenancy floor: each school sees only its own assignments,
// cross-tenant findUnique returns null, a cross-tenant INSERT is rejected by
// WITH CHECK (parent ids are A's but school_id is B's), and an unset GUC
// returns zero rows (FORCE RLS fails closed).
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 11 (teacher_assignments)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let assignmentA: { id: string };
  let assignmentB: { id: string };
  // School A's relation targets, kept for the WITH CHECK mischief test.
  let aTargets: {
    teacherId: string;
    classArmId: string;
    subjectId: string;
    academicYearId: string;
  };

  // Build a teacher + level + arm + subject + year for one school, then an
  // assignment tying them together. Inserts happen inside withTenant — every
  // table here is FORCE-RLS'd.
  async function buildAssignment(
    schoolId: string,
    tag: string,
  ): Promise<{
    assignmentId: string;
    teacherId: string;
    classArmId: string;
    subjectId: string;
    academicYearId: string;
  }> {
    return withTenant(schoolId, async (db) => {
      const teacher = await db.user.create({
        data: {
          schoolId,
          email: `ta-${tag}-${runId}@school.test`,
          firstName: "Teach",
          lastName: `${tag}-${runId}`,
        },
        select: { id: true },
      });
      const level = await db.classLevel.create({
        data: {
          schoolId,
          name: `${tag}-lvl-${runId}`,
          code: `${tag}-lvl-${runId}`,
          stage: "JSS",
          orderIndex: 100,
        },
        select: { id: true },
      });
      const arm = await db.classArm.create({
        data: {
          schoolId,
          classLevelId: level.id,
          name: `${tag}-arm-${runId}`,
          code: `${tag}-arm-${runId}`,
        },
        select: { id: true },
      });
      const subject = await db.subject.create({
        data: { schoolId, name: `${tag}-sub-${runId}`, code: `${tag}-sub-${runId}` },
        select: { id: true },
      });
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `${tag}-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      });
      const assignment = await db.teacherAssignment.create({
        data: {
          schoolId,
          teacherId: teacher.id,
          classArmId: arm.id,
          subjectId: subject.id,
          academicYearId: year.id,
        },
        select: { id: true },
      });
      return {
        assignmentId: assignment.id,
        teacherId: teacher.id,
        classArmId: arm.id,
        subjectId: subject.id,
        academicYearId: year.id,
      };
    });
  }

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1S11A", slug: `rls-p1s11a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1S11B", slug: `rls-p1s11b-${runId}` },
      select: { id: true },
    });

    const a = await buildAssignment(schoolA.id, "a");
    const b = await buildAssignment(schoolB.id, "b");
    assignmentA = { id: a.assignmentId };
    assignmentB = { id: b.assignmentId };
    aTargets = {
      teacherId: a.teacherId,
      classArmId: a.classArmId,
      subjectId: a.subjectId,
      academicYearId: a.academicYearId,
    };
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own teacher_assignment only", async () => {
    const rows = await withTenant(schoolA.id, (db) => db.teacherAssignment.findMany());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(assignmentA.id);
    expect(ids).not.toContain(assignmentB.id);
  });

  it("School B sees its own teacher_assignment only", async () => {
    const rows = await withTenant(schoolB.id, (db) => db.teacherAssignment.findMany());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(assignmentB.id);
    expect(ids).not.toContain(assignmentA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.teacherAssignment.findUnique({ where: { id: assignmentB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    // The mischief case: a controller in School A tries to write an
    // assignment whose relation ids are all A's, but with school_id = B.
    // WITH CHECK is the second-line defence that rejects it.
    await expect(
      withTenant(schoolA.id, (db) =>
        db.teacherAssignment.create({
          data: {
            schoolId: schoolB.id,
            teacherId: aTargets.teacherId,
            classArmId: aTargets.classArmId,
            subjectId: aTargets.subjectId,
            academicYearId: aTargets.academicYearId,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from teacher_assignments (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM teacher_assignments WHERE id IN (${assignmentA.id}, ${assignmentB.id})
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 / Slice 12 isolation — mastery_records
//
// First of the two AI-foundation tables. Thin by design and EMPTY in
// production — but it MUST pass the same tenancy invariant as every other
// Phase 1 table, which is the entire point of landing it now (lock in
// school_id + RLS before Phase 5 fills it, so Phase 5 isn't a live-data
// migration). mastery_records carries its OWN school_id despite the
// student_id FK, so RLS is a flat direct-column check, NOT EXISTS-through-
// students (docs/modules/phase-1.md "Note on student_guardians"). The fixture
// creates a student per school as the FK target. Suite proves: each school
// sees only its own rows, cross-tenant findUnique returns null, a cross-
// tenant INSERT is rejected by WITH CHECK (parent student_id is A's but
// school_id is B's), and an unset GUC returns zero rows (FORCE RLS fails
// closed). Contributes to acceptance #10 / #13.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 12 (mastery_records)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let studentA: { id: string };
  let studentB: { id: string };
  let masteryA: { id: string };
  let masteryB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1S12MA", slug: `rls-p1s12ma-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1S12MB", slug: `rls-p1s12mb-${runId}` },
      select: { id: true },
    });

    studentA = await withTenant(schoolA.id, (db) =>
      db.student.create({
        data: {
          schoolId: schoolA.id,
          admissionNumber: `A-S12M-${runId}`,
          firstName: "Ada",
          lastName: `Alpha-${runId}`,
          dateOfBirth: new Date("2014-03-15"),
          gender: "FEMALE",
        },
        select: { id: true },
      }),
    );
    studentB = await withTenant(schoolB.id, (db) =>
      db.student.create({
        data: {
          schoolId: schoolB.id,
          admissionNumber: `B-S12M-${runId}`,
          firstName: "Bola",
          lastName: `Bravo-${runId}`,
          dateOfBirth: new Date("2013-09-22"),
          gender: "MALE",
        },
        select: { id: true },
      }),
    );

    masteryA = await withTenant(schoolA.id, (db) =>
      db.masteryRecord.create({
        data: {
          schoolId: schoolA.id,
          studentId: studentA.id,
          topicRef: `topic-a-${runId}`,
          status: "in_progress",
        },
        select: { id: true },
      }),
    );
    masteryB = await withTenant(schoolB.id, (db) =>
      db.masteryRecord.create({
        data: {
          schoolId: schoolB.id,
          studentId: studentB.id,
          topicRef: `topic-b-${runId}`,
          status: "in_progress",
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own mastery_record only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.masteryRecord.findMany({ where: { topicRef: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(masteryA.id);
    expect(ids).not.toContain(masteryB.id);
  });

  it("School B sees its own mastery_record only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.masteryRecord.findMany({ where: { topicRef: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(masteryB.id);
    expect(ids).not.toContain(masteryA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.masteryRecord.findUnique({ where: { id: masteryB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    // Mischief case: a controller in School A writes a row whose student_id is
    // A's but whose school_id is B's. WITH CHECK is the second-line defence.
    await expect(
      withTenant(schoolA.id, (db) =>
        db.masteryRecord.create({
          data: {
            schoolId: schoolB.id,
            studentId: studentA.id,
            topicRef: `bad-${runId}`,
            status: "in_progress",
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from mastery_records (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM mastery_records WHERE topic_ref LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 / Slice 12 isolation — ai_interaction_logs
//
// Second AI-foundation table. Same discipline as mastery_records: own
// school_id (flat direct-column RLS), EMPTY in production, must pass the
// tenancy invariant now. student_id is NULLABLE here (teacher-driven sessions
// have no student), but the fixture links a student per school so the WITH
// CHECK mischief test can prove the school_id check fires independently of the
// FK. payload is an opaque JSONB envelope — Phase 5 owns its shape and it MUST
// stay PII-free (CLAUDE.md AI rules); the test payload is a placeholder only.
// Suite proves: each school sees only its own rows, cross-tenant findUnique
// returns null, a cross-tenant INSERT is rejected by WITH CHECK, and an unset
// GUC returns zero rows (FORCE RLS fails closed). Contributes to #10 / #13.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 12 (ai_interaction_logs)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let studentA: { id: string };
  let studentB: { id: string };
  let logA: { id: string };
  let logB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1S12LA", slug: `rls-p1s12la-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1S12LB", slug: `rls-p1s12lb-${runId}` },
      select: { id: true },
    });

    studentA = await withTenant(schoolA.id, (db) =>
      db.student.create({
        data: {
          schoolId: schoolA.id,
          admissionNumber: `A-S12L-${runId}`,
          firstName: "Ada",
          lastName: `Alpha-${runId}`,
          dateOfBirth: new Date("2014-03-15"),
          gender: "FEMALE",
        },
        select: { id: true },
      }),
    );
    studentB = await withTenant(schoolB.id, (db) =>
      db.student.create({
        data: {
          schoolId: schoolB.id,
          admissionNumber: `B-S12L-${runId}`,
          firstName: "Bola",
          lastName: `Bravo-${runId}`,
          dateOfBirth: new Date("2013-09-22"),
          gender: "MALE",
        },
        select: { id: true },
      }),
    );

    logA = await withTenant(schoolA.id, (db) =>
      db.aIInteractionLog.create({
        data: {
          schoolId: schoolA.id,
          studentId: studentA.id,
          sessionRef: `sess-a-${runId}`,
          payload: { placeholder: true },
        },
        select: { id: true },
      }),
    );
    logB = await withTenant(schoolB.id, (db) =>
      db.aIInteractionLog.create({
        data: {
          schoolId: schoolB.id,
          studentId: studentB.id,
          sessionRef: `sess-b-${runId}`,
          payload: { placeholder: true },
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own ai_interaction_log only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.aIInteractionLog.findMany({ where: { sessionRef: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(logA.id);
    expect(ids).not.toContain(logB.id);
  });

  it("School B sees its own ai_interaction_log only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.aIInteractionLog.findMany({ where: { sessionRef: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(logB.id);
    expect(ids).not.toContain(logA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.aIInteractionLog.findUnique({ where: { id: logB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    // Mischief case: parent student_id is A's, but school_id is B's. WITH
    // CHECK rejects it independently of the (nullable) FK.
    await expect(
      withTenant(schoolA.id, (db) =>
        db.aIInteractionLog.create({
          data: {
            schoolId: schoolB.id,
            studentId: studentA.id,
            sessionRef: `bad-${runId}`,
            payload: { placeholder: true },
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from ai_interaction_logs (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ai_interaction_logs WHERE session_ref LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 1 / Slice 9 isolation — enrollments
//
// Added in slice 13 (the Phase 1 close-out) to close the known gap: the
// slice-9 enrollments table shipped its RLS policy but never got its block in
// this spec (tracked in docs/deferred.md). Same five-assertion pattern as the
// teacher_assignments block — enrollments has FK parents (student, term, year,
// arm) so the setup builds the full chain per school. Closes acceptance #10
// ("all 15 Phase 1 tables in the isolation spec").
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 1 / Slice 9 (enrollments)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let enrollmentA: { id: string };
  let enrollmentB: { id: string };
  // School A's relation targets, kept for the WITH CHECK mischief test.
  let aTargets: {
    studentId: string;
    termId: string;
    academicYearId: string;
    classArmId: string;
  };

  // Build a level + arm + year + term + student for one school, then an
  // enrollment tying them together. All inserts happen inside withTenant —
  // every table here is FORCE-RLS'd.
  async function buildEnrollment(
    schoolId: string,
    tag: string,
  ): Promise<{
    enrollmentId: string;
    studentId: string;
    termId: string;
    academicYearId: string;
    classArmId: string;
  }> {
    return withTenant(schoolId, async (db) => {
      const level = await db.classLevel.create({
        data: {
          schoolId,
          name: `${tag}-lvl-${runId}`,
          code: `${tag}-lvl-${runId}`,
          stage: "JSS",
          orderIndex: 100,
        },
        select: { id: true },
      });
      const arm = await db.classArm.create({
        data: {
          schoolId,
          classLevelId: level.id,
          name: `${tag}-arm-${runId}`,
          code: `${tag}-arm-${runId}`,
        },
        select: { id: true },
      });
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `${tag}-${runId}`,
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
        },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
        },
        select: { id: true },
      });
      const student = await db.student.create({
        data: {
          schoolId,
          admissionNumber: `${tag}-adm-${runId}`,
          firstName: "Enrol",
          lastName: `${tag}-${runId}`,
          dateOfBirth: new Date("2014-01-01"),
          gender: "OTHER",
        },
        select: { id: true },
      });
      const enrollment = await db.enrollment.create({
        data: {
          schoolId,
          studentId: student.id,
          termId: term.id,
          academicYearId: year.id,
          classArmId: arm.id,
        },
        select: { id: true },
      });
      return {
        enrollmentId: enrollment.id,
        studentId: student.id,
        termId: term.id,
        academicYearId: year.id,
        classArmId: arm.id,
      };
    });
  }

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P1S9A", slug: `rls-p1s9a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P1S9B", slug: `rls-p1s9b-${runId}` },
      select: { id: true },
    });

    const a = await buildEnrollment(schoolA.id, "a");
    const b = await buildEnrollment(schoolB.id, "b");
    enrollmentA = { id: a.enrollmentId };
    enrollmentB = { id: b.enrollmentId };
    aTargets = {
      studentId: a.studentId,
      termId: a.termId,
      academicYearId: a.academicYearId,
      classArmId: a.classArmId,
    };
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own enrollment only", async () => {
    const rows = await withTenant(schoolA.id, (db) => db.enrollment.findMany());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(enrollmentA.id);
    expect(ids).not.toContain(enrollmentB.id);
  });

  it("School B sees its own enrollment only", async () => {
    const rows = await withTenant(schoolB.id, (db) => db.enrollment.findMany());
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(enrollmentB.id);
    expect(ids).not.toContain(enrollmentA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.enrollment.findUnique({ where: { id: enrollmentB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    // Mischief case: all relation ids are A's, but school_id = B. WITH CHECK
    // rejects it as the second-line defence.
    await expect(
      withTenant(schoolA.id, (db) =>
        db.enrollment.create({
          data: {
            schoolId: schoolB.id,
            studentId: aTargets.studentId,
            termId: aTargets.termId,
            academicYearId: aTargets.academicYearId,
            classArmId: aTargets.classArmId,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from enrollments (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM enrollments WHERE id IN (${enrollmentA.id}, ${enrollmentB.id})
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 / Slice 1 isolation — grading_schemes
//
// First of the three grading-config tables. Each carries its own school_id →
// flat direct-column RLS (same cheap pattern as every Phase 1 table). Schools
// here are created via basePrisma.school.create (NOT the signup path), so they
// have no seeded grading config; the fixture creates one scheme per school
// inside withTenant. Proves: each school sees only its own scheme, cross-tenant
// findUnique returns null, a cross-tenant INSERT is rejected by WITH CHECK, and
// an unset GUC returns zero rows (FORCE RLS fails closed). Contributes to the
// Phase 2 RLS coverage (acceptance #14).
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 2 / Slice 1 (grading_schemes)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let schemeA: { id: string };
  let schemeB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P2S1GSA", slug: `rls-p2s1gsa-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P2S1GSB", slug: `rls-p2s1gsb-${runId}` },
      select: { id: true },
    });

    schemeA = await withTenant(schoolA.id, (db) =>
      db.gradingScheme.create({
        data: { schoolId: schoolA.id, name: `scheme-a-${runId}` },
        select: { id: true },
      }),
    );
    schemeB = await withTenant(schoolB.id, (db) =>
      db.gradingScheme.create({
        data: { schoolId: schoolB.id, name: `scheme-b-${runId}` },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own grading_scheme only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.gradingScheme.findMany({ where: { name: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(schemeA.id);
    expect(ids).not.toContain(schemeB.id);
  });

  it("School B sees its own grading_scheme only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.gradingScheme.findMany({ where: { name: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(schemeB.id);
    expect(ids).not.toContain(schemeA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.gradingScheme.findUnique({ where: { id: schemeB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    // schools.subjectAttendanceEnabled-style mischief: scoped to A, write a row
    // carrying B's school_id. WITH CHECK is the second-line defence. (The
    // school_id unique would also block a second A-scheme, so we use B's id.)
    await expect(
      withTenant(schoolA.id, (db) =>
        db.gradingScheme.create({
          data: { schoolId: schoolB.id, name: `bad-${runId}` },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from grading_schemes (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM grading_schemes WHERE name LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 / Slice 1 isolation — grading_components
//
// Components hang off a scheme (FK scheme_id) but carry their OWN school_id →
// flat direct-column RLS, not EXISTS-through-scheme. The WITH CHECK mischief
// test uses A's scheme id but B's school_id to prove the school_id check fires
// independently of the FK. Contributes to acceptance #14.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 2 / Slice 1 (grading_components)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let schemeA: { id: string };
  let componentA: { id: string };
  let componentB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P2S1GCA", slug: `rls-p2s1gca-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P2S1GCB", slug: `rls-p2s1gcb-${runId}` },
      select: { id: true },
    });

    schemeA = await withTenant(schoolA.id, (db) =>
      db.gradingScheme.create({
        data: { schoolId: schoolA.id, name: `scheme-a-${runId}` },
        select: { id: true },
      }),
    );
    const schemeBRow = await withTenant(schoolB.id, (db) =>
      db.gradingScheme.create({
        data: { schoolId: schoolB.id, name: `scheme-b-${runId}` },
        select: { id: true },
      }),
    );

    componentA = await withTenant(schoolA.id, (db) =>
      db.gradingComponent.create({
        data: {
          schoolId: schoolA.id,
          schemeId: schemeA.id,
          key: `ca1-${runId}`,
          label: "First CA",
          weight: 100,
          orderIndex: 1,
        },
        select: { id: true },
      }),
    );
    componentB = await withTenant(schoolB.id, (db) =>
      db.gradingComponent.create({
        data: {
          schoolId: schoolB.id,
          schemeId: schemeBRow.id,
          key: `ca1-${runId}`,
          label: "First CA",
          weight: 100,
          orderIndex: 1,
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own grading_component only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.gradingComponent.findMany({ where: { key: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(componentA.id);
    expect(ids).not.toContain(componentB.id);
  });

  it("School B sees its own grading_component only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.gradingComponent.findMany({ where: { key: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(componentB.id);
    expect(ids).not.toContain(componentA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.gradingComponent.findUnique({ where: { id: componentB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    // A's scheme id, but B's school_id — WITH CHECK rejects independently of FK.
    await expect(
      withTenant(schoolA.id, (db) =>
        db.gradingComponent.create({
          data: {
            schoolId: schoolB.id,
            schemeId: schemeA.id,
            key: `bad-${runId}`,
            label: "Bad",
            weight: 100,
            orderIndex: 9,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from grading_components (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM grading_components WHERE key LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 / Slice 1 isolation — grade_boundaries
//
// Flat per-school config, own school_id. Rows are tagged by remark so the
// fixture can find them without colliding with seeded data. Contributes to
// acceptance #14.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 2 / Slice 1 (grade_boundaries)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let boundaryA: { id: string };
  let boundaryB: { id: string };

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P2S1GBA", slug: `rls-p2s1gba-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P2S1GBB", slug: `rls-p2s1gbb-${runId}` },
      select: { id: true },
    });

    boundaryA = await withTenant(schoolA.id, (db) =>
      db.gradeBoundary.create({
        data: {
          schoolId: schoolA.id,
          letter: "A1",
          minScore: 0,
          maxScore: 100,
          remark: `r-${runId}`,
          orderIndex: 1,
        },
        select: { id: true },
      }),
    );
    boundaryB = await withTenant(schoolB.id, (db) =>
      db.gradeBoundary.create({
        data: {
          schoolId: schoolB.id,
          letter: "A1",
          minScore: 0,
          maxScore: 100,
          remark: `r-${runId}`,
          orderIndex: 1,
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own grade_boundary only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.gradeBoundary.findMany({ where: { remark: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(boundaryA.id);
    expect(ids).not.toContain(boundaryB.id);
  });

  it("School B sees its own grade_boundary only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.gradeBoundary.findMany({ where: { remark: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(boundaryB.id);
    expect(ids).not.toContain(boundaryA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.gradeBoundary.findUnique({ where: { id: boundaryB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.gradeBoundary.create({
          data: {
            schoolId: schoolB.id,
            letter: "B2",
            minScore: 0,
            maxScore: 50,
            remark: `bad-${runId}`,
            orderIndex: 2,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from grade_boundaries (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM grade_boundaries WHERE remark LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 / Slice 2 isolation — assessment_scores
//
// Raw marks. Carries its own school_id → flat direct-column RLS (NOT
// EXISTS-through-component). The fixture builds a scheme + component per school
// (the FK target, ON DELETE RESTRICT) since these RLS-spec schools are created
// via basePrisma, not the signup seed. The WITH CHECK mischief test uses A's
// component id but B's school_id to prove the school_id check fires independently
// of the FK. Contributes to acceptance #14.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 2 / Slice 2 (assessment_scores)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let componentA: { id: string };
  let scoreA: { id: string };
  let scoreB: { id: string };

  async function buildComponent(schoolId: string, tag: string): Promise<{ id: string }> {
    return withTenant(schoolId, async (db) => {
      const scheme = await db.gradingScheme.create({
        data: { schoolId, name: `scheme-${tag}-${runId}` },
        select: { id: true },
      });
      return db.gradingComponent.create({
        data: {
          schoolId,
          schemeId: scheme.id,
          key: `ca1-${runId}`,
          label: "First CA",
          weight: 100,
          orderIndex: 1,
        },
        select: { id: true },
      });
    });
  }

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P2S2ASA", slug: `rls-p2s2asa-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P2S2ASB", slug: `rls-p2s2asb-${runId}` },
      select: { id: true },
    });

    componentA = await buildComponent(schoolA.id, "a");
    const componentB = await buildComponent(schoolB.id, "b");

    scoreA = await withTenant(schoolA.id, (db) =>
      db.assessmentScore.create({
        data: {
          schoolId: schoolA.id,
          studentId: `stu-a-${runId}`,
          subjectId: `subj-a-${runId}`,
          termId: `term-a-${runId}`,
          componentId: componentA.id,
          score: 50,
          enteredBy: `user-a-${runId}`,
        },
        select: { id: true },
      }),
    );
    scoreB = await withTenant(schoolB.id, (db) =>
      db.assessmentScore.create({
        data: {
          schoolId: schoolB.id,
          studentId: `stu-b-${runId}`,
          subjectId: `subj-b-${runId}`,
          termId: `term-b-${runId}`,
          componentId: componentB.id,
          score: 50,
          enteredBy: `user-b-${runId}`,
        },
        select: { id: true },
      }),
    );
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own assessment_score only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.assessmentScore.findMany({ where: { enteredBy: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(scoreA.id);
    expect(ids).not.toContain(scoreB.id);
  });

  it("School B sees its own assessment_score only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.assessmentScore.findMany({ where: { enteredBy: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(scoreB.id);
    expect(ids).not.toContain(scoreA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.assessmentScore.findUnique({ where: { id: scoreB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    // A's component id, but B's school_id — WITH CHECK rejects independently of FK.
    await expect(
      withTenant(schoolA.id, (db) =>
        db.assessmentScore.create({
          data: {
            schoolId: schoolB.id,
            studentId: `bad-${runId}`,
            subjectId: `bad-${runId}`,
            termId: `bad-${runId}`,
            componentId: componentA.id,
            score: 10,
            enteredBy: `bad-${runId}`,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from assessment_scores (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM assessment_scores WHERE entered_by LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 / Slice 2 isolation — assessments
//
// The denormalized summary. Standalone (no enforced relations) → the fixture
// inserts arbitrary plain-string ids; the school_id is the only tenancy guard.
// Tagged via subject_comment so the fixture can find its rows. Contributes to
// acceptance #14.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 2 / Slice 2 (assessments)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let assessmentA: { id: string };
  let assessmentB: { id: string };

  async function buildAssessment(schoolId: string, tag: string): Promise<{ id: string }> {
    return withTenant(schoolId, (db) =>
      db.assessment.create({
        data: {
          schoolId,
          studentId: `stu-${tag}-${runId}`,
          subjectId: `subj-${tag}-${runId}`,
          termId: `term-${tag}-${runId}`,
          academicYearId: `year-${tag}-${runId}`,
          classArmId: `arm-${tag}-${runId}`,
          totalScore: 80,
          letterGrade: "A1",
          subjectComment: `c-${runId}`,
          computedAt: new Date("2026-06-03"),
        },
        select: { id: true },
      }),
    );
  }

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P2S2AA", slug: `rls-p2s2aa-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P2S2AB", slug: `rls-p2s2ab-${runId}` },
      select: { id: true },
    });
    assessmentA = await buildAssessment(schoolA.id, "a");
    assessmentB = await buildAssessment(schoolB.id, "b");
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own assessment only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.assessment.findMany({ where: { subjectComment: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(assessmentA.id);
    expect(ids).not.toContain(assessmentB.id);
  });

  it("School B sees its own assessment only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.assessment.findMany({ where: { subjectComment: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(assessmentB.id);
    expect(ids).not.toContain(assessmentA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.assessment.findUnique({ where: { id: assessmentB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.assessment.create({
          data: {
            schoolId: schoolB.id,
            studentId: `bad-${runId}`,
            subjectId: `bad-${runId}`,
            termId: `bad-${runId}`,
            academicYearId: `bad-${runId}`,
            classArmId: `bad-${runId}`,
            totalScore: 10,
            subjectComment: `bad-${runId}`,
            computedAt: new Date("2026-06-03"),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from assessments (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM assessments WHERE subject_comment LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 / Slice 5 isolation — report_cards (the 8th and final Phase 2 table;
// RLS coverage 20 → 21). The materialized report-card artifact. Standalone (no
// enforced relations) → arbitrary plain-string ids; school_id is the only
// tenancy guard. Tagged via form_teacher_comment so the fixture can find its
// rows. Contributes to acceptance #14.
// ---------------------------------------------------------------------------

describe("multi-tenant isolation — Phase 2 / Slice 5 (report_cards)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  let schoolA: { id: string };
  let schoolB: { id: string };
  let cardA: { id: string };
  let cardB: { id: string };

  async function buildCard(schoolId: string, tag: string): Promise<{ id: string }> {
    return withTenant(schoolId, (db) =>
      db.reportCard.create({
        data: {
          schoolId,
          studentId: `stu-${tag}-${runId}`,
          termId: `term-${tag}-${runId}`,
          academicYearId: `year-${tag}-${runId}`,
          classArmId: `arm-${tag}-${runId}`,
          formTeacherComment: `c-${runId}`,
        },
        select: { id: true },
      }),
    );
  }

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School P2S5A", slug: `rls-p2s5a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School P2S5B", slug: `rls-p2s5b-${runId}` },
      select: { id: true },
    });
    cardA = await buildCard(schoolA.id, "a");
    cardB = await buildCard(schoolB.id, "b");
  });

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  it("School A sees its own report_card only", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.reportCard.findMany({ where: { formTeacherComment: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(cardA.id);
    expect(ids).not.toContain(cardB.id);
  });

  it("School B sees its own report_card only", async () => {
    const rows = await withTenant(schoolB.id, (db) =>
      db.reportCard.findMany({ where: { formTeacherComment: { contains: runId } } }),
    );
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(cardB.id);
    expect(ids).not.toContain(cardA.id);
  });

  it("findUnique across tenants returns null", async () => {
    const leak = await withTenant(schoolA.id, (db) =>
      db.reportCard.findUnique({ where: { id: cardB.id } }),
    );
    expect(leak).toBeNull();
  });

  it("INSERT with another school's school_id fails the WITH CHECK clause", async () => {
    await expect(
      withTenant(schoolA.id, (db) =>
        db.reportCard.create({
          data: {
            schoolId: schoolB.id,
            studentId: `bad-${runId}`,
            termId: `bad-${runId}`,
            academicYearId: `bad-${runId}`,
            classArmId: `bad-${runId}`,
            formTeacherComment: `bad-${runId}`,
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("raw SQL with unset GUC returns zero rows from report_cards (FORCE RLS)", async () => {
    const rows = await basePrisma.$transaction(async (tx) => {
      return tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM report_cards WHERE form_teacher_comment LIKE ${"%" + runId + "%"}
      `;
    });
    expect(rows).toHaveLength(0);
  });
});
