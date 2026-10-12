import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, createPrismaClient, isRetryableConnectionError, withTenant } from "@school-kit/db";

import { translatePrismaError } from "../modules/auth/auth.service";

// Prisma 7 changed what the database's errors look like
// (docs/modules/prisma-7-upgrade.md D4). The code that tells errors apart —
// signup's EMAIL_TAKEN / PHONE_TAKEN / SCHOOL_SLUG_TAKEN, and withTenant's
// one retry on a lost connection — is pinned here against REAL errors from a
// real Postgres, not hand-built ones, so a future Prisma that moves a field
// again fails this spec rather than production.

const DATABASE_URL = process.env.DATABASE_URL ?? "";

async function caught(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to fail");
}

describe("Prisma 7 errors (real database)", () => {
  const run = randomUUID().slice(0, 8);
  let schoolA: string;
  let schoolB: string;
  const email = `p7-${run}@example.test`;
  const phone = `+23480${String(Date.now()).slice(-8)}`;

  beforeAll(async () => {
    schoolA = (await basePrisma.school.create({ data: { name: "P7 A", slug: `p7-a-${run}` } })).id;
    schoolB = (await basePrisma.school.create({ data: { name: "P7 B", slug: `p7-b-${run}` } })).id;
    await withTenant(schoolA, (db) =>
      db.user.create({ data: { schoolId: schoolA, firstName: "A", lastName: "One", email, phone } }),
    );
  });

  afterAll(async () => {
    for (const id of [schoolA, schoolB]) {
      await withTenant(id, (db) => db.user.deleteMany({ where: { schoolId: id } }));
    }
    await basePrisma.school.deleteMany({ where: { id: { in: [schoolA, schoolB] } } });
  });

  describe("signup's unique-violation split", () => {
    it("a taken slug is SCHOOL_SLUG_TAKEN", async () => {
      const e = await caught(basePrisma.school.create({ data: { name: "Dup", slug: `p7-a-${run}` } }));
      expect(translatePrismaError(e)).toMatchObject({ code: "SCHOOL_SLUG_TAKEN" });
    });

    it("a taken email is EMAIL_TAKEN, even from another school under FORCE RLS", async () => {
      const e = await caught(
        withTenant(schoolB, (db) =>
          db.user.create({ data: { schoolId: schoolB, firstName: "B", lastName: "Two", email } }),
        ),
      );
      expect(translatePrismaError(e)).toMatchObject({ code: "EMAIL_TAKEN" });
    });

    it("a taken phone is PHONE_TAKEN, though the failing call also names an email", async () => {
      const e = await caught(
        withTenant(schoolB, (db) =>
          db.user.create({
            data: { schoolId: schoolB, firstName: "B", lastName: "Two", email: `other-${email}`, phone },
          }),
        ),
      );
      expect(translatePrismaError(e)).toMatchObject({ code: "PHONE_TAKEN" });
    });
  });

  describe("withTenant's retry decision", () => {
    it("a transaction that never started (no free connection) is retryable", async () => {
      const one = createPrismaClient(DATABASE_URL, { max: 1 });
      // Holds the only connection. Settled in `finally` either way, so a
      // failed assertion never leaves it to reject unobserved.
      const hold = one.$transaction((tx) => tx.$executeRaw`SELECT pg_sleep(3)`, { timeout: 10_000 });
      try {
        await new Promise((r) => setTimeout(r, 300));
        const e = await caught(one.$transaction((tx) => tx.$executeRaw`SELECT 1`, { maxWait: 500 }));
        expect(e).toMatchObject({ code: "P2028" });
        expect(isRetryableConnectionError(e)).toBe(true);
      } finally {
        await hold.catch(() => undefined);
        await one.$disconnect();
      }
    });

    it("a transaction whose body ran past its timeout is NOT retryable", async () => {
      const e = await caught(
        basePrisma.$transaction(
          async (tx) => {
            await tx.$executeRaw`SELECT pg_sleep(0.6)`;
            await tx.$executeRaw`SELECT 1`;
          },
          { timeout: 200 },
        ),
      );
      expect(e).toMatchObject({ code: "P2028" });
      expect(isRetryableConnectionError(e)).toBe(false);
    });

    it("an unreachable server is retryable", async () => {
      const url = new URL(DATABASE_URL);
      url.port = "1";
      const dead = createPrismaClient(url.toString());
      try {
        const e = await caught(dead.$transaction((tx) => tx.$executeRaw`SELECT 1`));
        expect(isRetryableConnectionError(e)).toBe(true);
      } finally {
        await dead.$disconnect();
      }
    });

    it("a host with several addresses, all refusing, is retryable (CI's IPv4 + IPv6 localhost)", () => {
      // The one hand-built error here: this machine cannot be given a second
      // address family, so the shape is copied from what Node threw on CI and
      // from a two-address hostname locally — a bare AggregateError, passed
      // through by Prisma unwrapped, with the socket code on it and inside.
      const refused = (address: string) =>
        Object.assign(new Error(`connect ECONNREFUSED ${address}:5432`), { code: "ECONNREFUSED", syscall: "connect" });
      const e = Object.assign(new AggregateError([refused("::1"), refused("127.0.0.1")]), { code: "ECONNREFUSED" });
      expect(isRetryableConnectionError(e)).toBe(true);
    });

    it("ordinary failures are not retried: a unique violation, a plain error", async () => {
      const dup = await caught(basePrisma.school.create({ data: { name: "Dup", slug: `p7-a-${run}` } }));
      expect(isRetryableConnectionError(dup)).toBe(false);
      expect(isRetryableConnectionError(new Error("boom"))).toBe(false);
      expect(isRetryableConnectionError(new AggregateError([new Error("a")]))).toBe(false);
    });

    it("a connection lost mid-transaction is retried once, and the retry succeeds", async () => {
      let attempts = 0;
      const result = await withTenant(schoolA, async (db) => {
        attempts += 1;
        if (attempts === 1) {
          // The server ends this transaction's own connection (57P01, the
          // shape a Neon compute restart takes), so its next query fails.
          await db.$executeRaw`SELECT pg_terminate_backend(pg_backend_pid())`.catch(() => undefined);
          await db.user.count();
        }
        return db.user.count();
      });
      expect(attempts).toBe(2);
      expect(result).toBe(1);
    });
  });
});
