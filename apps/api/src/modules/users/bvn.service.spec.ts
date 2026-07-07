import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { BvnService } from "./bvn.service.js";

// Phase 3 / Slice 12 — BvnService integration tests. Real DB, real
// encrypt_bvn/decrypt_bvn SECURITY DEFINER functions — mocking Prisma here
// would defeat the point, since the whole feature is "does the round-trip
// through pgcrypto actually work end to end."
//
// ConfigService is stubbed (not a full Nest DI bootstrap) — same pattern as
// paystack.service.spec.ts. The stub key is arbitrary; it only needs to be
// consistent for the encrypt→decrypt round-trip within a single test.

function stubConfig(key: string | undefined) {
  return { get: (_k: string) => key } as never;
}

function ctx(schoolId: string, userId: string) {
  return { sessionId: "sess", userId, schoolId };
}

const TEST_KEY = "bvn-spec-test-key-not-a-real-secret";

describe("BvnService (integration)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const bvn = new BvnService(stubConfig(TEST_KEY));
  let schoolA: { id: string };
  let schoolB: { id: string };
  let userA: { id: string };
  let userB: { id: string };

  afterAll(async () => {
    if (schoolA?.id) {
      await basePrisma.school.delete({ where: { id: schoolA.id } }).catch(() => undefined);
    }
    if (schoolB?.id) {
      await basePrisma.school.delete({ where: { id: schoolB.id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  beforeAll(async () => {
    schoolA = await basePrisma.school.create({
      data: { name: "School BVN A", slug: `bvn-a-${runId}` },
      select: { id: true },
    });
    schoolB = await basePrisma.school.create({
      data: { name: "School BVN B", slug: `bvn-b-${runId}` },
      select: { id: true },
    });
    userA = await withTenant(schoolA.id, (db) =>
      db.user.create({
        data: {
          schoolId: schoolA.id,
          email: `bvn-a-${runId}@school.test`,
          firstName: "Amaka",
          lastName: "Staff",
        },
        select: { id: true },
      }),
    );
    userB = await withTenant(schoolB.id, (db) =>
      db.user.create({
        data: {
          schoolId: schoolB.id,
          email: `bvn-b-${runId}@school.test`,
          firstName: "Bello",
          lastName: "Staff",
        },
        select: { id: true },
      }),
    );
  });

  it("getBvnStatus before capture: hasBvn false, bvnLast4 null", async () => {
    const status = await bvn.getBvnStatus(ctx(schoolA.id, userA.id), userA.id);
    expect(status).toEqual({ hasBvn: false, bvnLast4: null });
  });

  it("revealBvn before capture throws NotFoundError", async () => {
    await expect(
      bvn.revealBvn(ctx(schoolA.id, userA.id), userA.id),
    ).rejects.toThrow(/No BVN on file/);
  });

  it("captureBvn round-trips through pgcrypto: reveal returns the exact original plaintext", async () => {
    const plaintext = "12345678901";
    await bvn.captureBvn(ctx(schoolA.id, userA.id), userA.id, { bvn: plaintext });

    const status = await bvn.getBvnStatus(ctx(schoolA.id, userA.id), userA.id);
    expect(status).toEqual({ hasBvn: true, bvnLast4: "8901" });

    const revealed = await bvn.revealBvn(ctx(schoolA.id, userA.id), userA.id);
    expect(revealed).toEqual({ bvn: plaintext });
  });

  it("captureBvn writes a staff-bvn.update audit row; revealBvn writes staff-bvn.reveal", async () => {
    const rows = await withTenant(schoolA.id, (db) =>
      db.auditLog.findMany({
        where: { entityType: "user", entityId: userA.id },
        orderBy: { createdAt: "asc" },
      }),
    );
    const actions = rows.map((r) => r.action);
    expect(actions).toContain("staff-bvn.update");
    expect(actions).toContain("staff-bvn.reveal");
    // The audited metadata must never carry the plaintext BVN.
    for (const row of rows) {
      expect(JSON.stringify(row.metadata)).not.toContain("12345678901");
    }
  });

  it("admin (self=false) capture/reveal on another user in the SAME school records self:false", async () => {
    const otherUser = await withTenant(schoolA.id, (db) =>
      db.user.create({
        data: {
          schoolId: schoolA.id,
          email: `bvn-a-other-${runId}@school.test`,
          firstName: "Other",
          lastName: "Staff",
        },
        select: { id: true },
      }),
    );
    const adminCtx = ctx(schoolA.id, userA.id); // userA acting as "admin" on otherUser
    await bvn.captureBvn(adminCtx, otherUser.id, { bvn: "98765432109" });
    const revealed = await bvn.revealBvn(adminCtx, otherUser.id);
    expect(revealed).toEqual({ bvn: "98765432109" });

    const rows = await withTenant(schoolA.id, (db) =>
      db.auditLog.findMany({ where: { entityType: "user", entityId: otherUser.id } }),
    );
    expect(rows.every((r) => (r.metadata as { self: boolean }).self === false)).toBe(true);
  });

  it("cross-tenant: capture/reveal/status for a user in a different school throws NotFoundError", async () => {
    // userB belongs to schoolB; RLS scopes the withTenant(schoolA.id, ...)
    // lookup to schoolA only, so userB.id resolves to nothing — same
    // invariant proven generically in rls.spec.ts, exercised here for the
    // new BVN surface specifically.
    await expect(
      bvn.getBvnStatus(ctx(schoolA.id, userA.id), userB.id),
    ).rejects.toThrow(/not found/i);
    await expect(
      bvn.captureBvn(ctx(schoolA.id, userA.id), userB.id, { bvn: "11122233344" }),
    ).rejects.toThrow(/not found/i);
    await expect(
      bvn.revealBvn(ctx(schoolA.id, userA.id), userB.id),
    ).rejects.toThrow(/not found/i);
  });

  it("missing BVN_ENCRYPTION_KEY throws InternalError instead of silently failing", async () => {
    const bvnNoKey = new BvnService(stubConfig(undefined));
    await expect(
      bvnNoKey.captureBvn(ctx(schoolA.id, userA.id), userA.id, { bvn: "55566677788" }),
    ).rejects.toThrow(/BVN encryption key is not configured/);
  });
});
