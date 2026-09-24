import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { webHandoffSchema } from "@school-kit/types";

import { AuthService } from "./auth.service";
import { WebHandoffService } from "./web-handoff.service";

// Opening the website from the app, already signed in
// (docs/modules/web-handoff-signin.md), against real Postgres.
//
// This is an auth path, so the tests are the argument: every one of them is a
// way the handoff could hand a session to the wrong person, or to the right
// person twice.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

describe("WebHandoffService (integration)", () => {
  const service = new WebHandoffService();
  const auth = new AuthService();
  const schoolIds = new Set<string>();

  let A: { schoolId: string; userId: string; sessionId: string };
  let B: { schoolId: string; userId: string; sessionId: string };

  async function makeSchool(suffix: string) {
    const signed = await auth.signupOwner(
      {
        schoolName: `Handoff ${suffix} ${runId}`,
        schoolSlug: `handoff-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `handoff-${suffix}-${runId}@example.test`,
        ownerPhone: `+23499${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIds.add(signed.school.id);
    const session = await withTenant(signed.school.id, (db) =>
      db.session.findFirstOrThrow({ where: { userId: signed.user.id }, select: { id: true } }),
    );
    return { schoolId: signed.school.id, userId: signed.user.id, sessionId: session.id };
  }

  const ctxOf = (s: { schoolId: string; userId: string; sessionId: string }) => ({
    schoolId: s.schoolId,
    userId: s.userId,
    sessionId: s.sessionId,
  });

  beforeAll(async () => {
    A = await makeSchool("a");
    B = await makeSchool("b");
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  it("mints a token that works exactly once", async () => {
    const minted = await service.mint(ctxOf(A), { next: "/finance" }, reqCtx);
    expect(minted.next).toBe("/finance");

    const first = await service.exchange(minted.token, reqCtx);
    expect(first.userId).toBe(A.userId);
    expect(first.token).toBeTruthy();

    // The second exchange is the one failure this design cannot tolerate.
    await expect(service.exchange(minted.token, reqCtx)).rejects.toMatchObject({ code: "HANDOFF_INVALID" });
  });

  it("hands over a NEW session, not the app's — revoking one leaves the other", async () => {
    const minted = await service.mint(ctxOf(A), {}, reqCtx);
    const { token } = await service.exchange(minted.token, reqCtx);

    const sessions = await withTenant(A.schoolId, (db) =>
      db.session.findMany({ where: { userId: A.userId }, select: { id: true } }),
    );
    expect(sessions.length).toBeGreaterThan(1);
    expect(token).not.toBe(minted.token);
    // The minting session is untouched.
    expect(sessions.map((s) => s.id)).toContain(A.sessionId);
  });

  it("refuses an expired token", async () => {
    const minted = await service.mint(ctxOf(A), {}, reqCtx);
    await withTenant(A.schoolId, (db) =>
      db.webHandoffToken.updateMany({
        where: { usedAt: null },
        data: { expiresAt: new Date(Date.now() - 1000) },
      }),
    );
    await expect(service.exchange(minted.token, reqCtx)).rejects.toMatchObject({ code: "HANDOFF_INVALID" });
  });

  it("refuses a token whose session has gone — signing out of the app kills it", async () => {
    const minted = await service.mint(ctxOf(A), {}, reqCtx);
    await withTenant(A.schoolId, (db) => db.session.deleteMany({ where: { id: A.sessionId } }));

    await expect(service.exchange(minted.token, reqCtx)).rejects.toMatchObject({ code: "HANDOFF_INVALID" });

    // Restore a session for the remaining tests.
    const restored = await withTenant(A.schoolId, (db) =>
      db.session.create({
        data: {
          userId: A.userId,
          tokenHash: `restored-${runId}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
        select: { id: true },
      }),
    );
    A = { ...A, sessionId: restored.id };
  });

  it("refuses a deactivated user, even with a live token and a live session", async () => {
    const minted = await service.mint(ctxOf(A), {}, reqCtx);
    await withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.userId }, data: { isActive: false } }));

    await expect(service.exchange(minted.token, reqCtx)).rejects.toMatchObject({ httpStatus: 401 });

    await withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.userId }, data: { isActive: true } }));
  });

  it("refuses a token that was never minted", async () => {
    await expect(service.exchange("not-a-real-token", reqCtx)).rejects.toMatchObject({ code: "HANDOFF_INVALID" });
  });

  it("keeps one school's token out of another's reach", async () => {
    const minted = await service.mint(ctxOf(B), {}, reqCtx);
    const exchanged = await service.exchange(minted.token, reqCtx);
    // It resolves to B's user, never A's — the token carries its own school.
    expect(exchanged.userId).toBe(B.userId);
    const rows = await withTenant(A.schoolId, (db) => db.webHandoffToken.findMany({ select: { userId: true } }));
    expect(rows.map((r) => r.userId)).not.toContain(B.userId);
  });

  it("never stores the token in the clear", async () => {
    const minted = await service.mint(ctxOf(A), {}, reqCtx);
    const rows = await withTenant(A.schoolId, (db) =>
      db.webHandoffToken.findMany({ select: { tokenHash: true } }),
    );
    expect(rows.map((r) => r.tokenHash)).not.toContain(minted.token);
    expect(rows.some((r) => /^[0-9a-f]{64}$/.test(r.tokenHash))).toBe(true);
  });

  it("audits both halves, and never writes the token into the audit row", async () => {
    const minted = await service.mint(ctxOf(A), { next: "/finance/payroll" }, reqCtx);
    await service.exchange(minted.token, reqCtx);
    const audits = await withTenant(A.schoolId, (db) =>
      db.auditLog.findMany({
        where: { action: { in: ["auth.web-handoff", "auth.web-handoff-exchange"] } },
        select: { action: true, metadata: true },
      }),
    );
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(["auth.web-handoff", "auth.web-handoff-exchange"]),
    );
    expect(JSON.stringify(audits)).not.toContain(minted.token);
  });
});

describe("where the handoff may send you (H5)", () => {
  it("accepts a path on this site", () => {
    for (const next of ["/dashboard", "/finance/invoices", "/students/1?tab=fees"]) {
      expect(webHandoffSchema.safeParse({ next }).success).toBe(true);
    }
  });

  it("refuses anything that could leave the site — an open redirect wearing the school's domain", () => {
    for (const next of [
      "//evil.example",
      "https://evil.example",
      "http://evil.example/x",
      "/../admin",
      "javascript:alert(1)",
      "evil.example",
    ]) {
      expect(webHandoffSchema.safeParse({ next }).success).toBe(false);
    }
  });
});
