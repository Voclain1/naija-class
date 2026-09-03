import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import type { AuthContext } from "../../common/auth/auth-context";
import { CurriculumService } from "./curriculum.service";

// Phase 7 — ownership-scoped delete authorisation.
//
// Runs against a real Postgres because the rule depends on real role grants and
// a real `uploaded_by` column; a mocked Prisma would be asserting my own
// arrangement of the data rather than the rule.
//
// The rule: owner and admin may delete any curriculum document; a teacher may
// delete only one they uploaded themselves. It replaced an owner/admin-only
// rule that, combined with the curriculum page being teacher-role-gated, meant
// NOBODY could delete through the UI.
//
// `remove()` is called directly rather than through HTTP. The controller's
// @Permissions("curriculum.delete") is the coarse gate and is covered by the
// role seed; what needs testing here is the SUBSTANTIVE gate, which is the one
// that distinguishes a teacher's own document from a colleague's.

const runId = Math.random().toString(36).slice(2, 8);

/** Only `remove` is exercised, so storage/embeddings/queue are never touched. */
function makeService(): CurriculumService {
  const storage = { delete: async () => undefined } as never;
  const embeddings = { isConfigured: () => true } as never;
  const queue = { add: async () => undefined } as never;
  return new CurriculumService(storage, embeddings, queue);
}

describe("CurriculumService.remove — ownership-scoped authorisation", () => {
  let schoolId: string;
  let ownerCtx: AuthContext;
  let adminCtx: AuthContext;
  let teacherACtx: AuthContext;
  let teacherBCtx: AuthContext;
  let bursarCtx: AuthContext;

  async function createUserWithRole(roleKey: string, email: string): Promise<AuthContext> {
    return withTenant(schoolId, async (db) => {
      const user = await db.user.create({
        data: {
          schoolId,
          email,
          firstName: "T",
          lastName: roleKey,
          passwordHash: "x",
          isActive: true,
        },
        select: { id: true },
      });
      const role = await db.role.findFirstOrThrow({ where: { key: roleKey, isSystem: true } });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return { sessionId: `sess-${user.id}`, userId: user.id, schoolId };
    });
  }

  async function createDocument(uploadedBy: string, title: string): Promise<string> {
    return withTenant(schoolId, async (db) => {
      const doc = await db.curriculumDocument.create({
        data: {
          schoolId,
          subjectId: `subject-${runId}`,
          classLevelId: `level-${runId}`,
          title,
          storageKey: `curriculum/${title}`,
          checksum: `sum-${title}-${Math.random()}`,
          uploadedBy,
          status: "READY",
        },
        select: { id: true },
      });
      return doc.id;
    });
  }

  beforeAll(async () => {
    const school = await basePrisma.school.create({
      data: { name: "Delete Authz", slug: `del-authz-${runId}` },
      select: { id: true },
    });
    schoolId = school.id;

    // The system roles are seeded per school by the signup flow; this suite
    // creates a bare school, so seed the four it needs directly.
    await withTenant(schoolId, async (db) => {
      for (const [key, permissions] of [
        ["owner", ["*"]],
        ["admin", ["curriculum.read", "curriculum.upload", "curriculum.delete"]],
        ["teacher", ["curriculum.read", "curriculum.upload", "curriculum.delete"]],
        ["bursar", ["invoice.read"]],
      ] as const) {
        await db.role.create({
          data: { schoolId, key, name: key, isSystem: true, permissions: [...permissions] },
        });
      }
    });

    ownerCtx = await createUserWithRole("owner", `owner-${runId}@example.test`);
    adminCtx = await createUserWithRole("admin", `admin-${runId}@example.test`);
    teacherACtx = await createUserWithRole("teacher", `teach-a-${runId}@example.test`);
    teacherBCtx = await createUserWithRole("teacher", `teach-b-${runId}@example.test`);
    bursarCtx = await createUserWithRole("bursar", `bursar-${runId}@example.test`);
  });

  afterAll(async () => {
    await withTenant(schoolId, (db) => db.auditLog.deleteMany({ where: { schoolId } }));
    await withTenant(schoolId, (db) => db.curriculumDocument.deleteMany({ where: { schoolId } }));
    await withTenant(schoolId, (db) => db.userRole.deleteMany({ where: {} }));
    await withTenant(schoolId, (db) => db.user.deleteMany({ where: { schoolId } }));
    await withTenant(schoolId, (db) => db.role.deleteMany({ where: { schoolId } }));
    await basePrisma.school.deleteMany({ where: { id: schoolId } });
    await basePrisma.$disconnect();
  });

  it("lets a teacher delete a document THEY uploaded — the case that was blocked", async () => {
    const svc = makeService();
    const docId = await createDocument(teacherACtx.userId, "own-doc");

    await svc.remove(teacherACtx, docId, "127.0.0.1");

    const gone = await withTenant(schoolId, (db) =>
      db.curriculumDocument.findUnique({ where: { id: docId } }),
    );
    expect(gone).toBeNull();
  });

  it("REFUSES a teacher deleting a COLLEAGUE'S document — what the rule guards", async () => {
    const svc = makeService();
    const docId = await createDocument(teacherBCtx.userId, "colleague-doc");

    await expect(svc.remove(teacherACtx, docId, "127.0.0.1")).rejects.toMatchObject({
      code: "CURRICULUM_NOT_UPLOADER",
    });

    const survived = await withTenant(schoolId, (db) =>
      db.curriculumDocument.findUnique({ where: { id: docId } }),
    );
    expect(survived).not.toBeNull();
  });

  it("lets an ADMIN delete a document someone else uploaded", async () => {
    const svc = makeService();
    const docId = await createDocument(teacherBCtx.userId, "admin-deletes");

    await svc.remove(adminCtx, docId, "127.0.0.1");

    expect(
      await withTenant(schoolId, (db) => db.curriculumDocument.findUnique({ where: { id: docId } })),
    ).toBeNull();
  });

  it("lets an OWNER delete a document someone else uploaded", async () => {
    const svc = makeService();
    const docId = await createDocument(teacherBCtx.userId, "owner-deletes");

    await svc.remove(ownerCtx, docId, "127.0.0.1");

    expect(
      await withTenant(schoolId, (db) => db.curriculumDocument.findUnique({ where: { id: docId } })),
    ).toBeNull();
  });

  it("refuses a role with no curriculum business at all", async () => {
    const svc = makeService();
    const docId = await createDocument(teacherACtx.userId, "bursar-blocked");

    await expect(svc.remove(bursarCtx, docId, "127.0.0.1")).rejects.toMatchObject({
      code: "CURRICULUM_DELETE_FORBIDDEN",
    });
  });

  it("writes an audit row naming the actor", async () => {
    const svc = makeService();
    const docId = await createDocument(teacherACtx.userId, "audited");

    await svc.remove(teacherACtx, docId, "10.0.0.1");

    const rows = await withTenant(schoolId, (db) =>
      db.auditLog.findMany({ where: { entityId: docId, action: "curriculum.delete" } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(teacherACtx.userId);
  });

  it("still 404s for a document that does not exist, before any ownership check", async () => {
    // NotFoundError carries the FIXED code "NOT_FOUND" — it takes a message,
    // not a code. CP2 called it with two arguments, which put the string
    // "CURRICULUM_DOCUMENT_NOT_FOUND" into the user-facing MESSAGE and the real
    // message into `details`. Caught by this spec; fixed in the service.
    const svc = makeService();
    await expect(
      svc.remove(adminCtx, "00000000-0000-0000-0000-000000000000", "127.0.0.1"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: "Curriculum document not found." });
  });
});
