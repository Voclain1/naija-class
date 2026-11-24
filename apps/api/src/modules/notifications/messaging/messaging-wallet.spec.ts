import { randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { basePrisma, createPrismaClient, withTenant } from "@school-kit/db";
import { afterAll, describe, expect, it, vi } from "vitest";

import { EmailService } from "../../../common/email/email.service";
import { NotificationPreferencesService } from "../notification-preferences.service";
import { MessagingTopUpService } from "./messaging-top-up.service";
import { MessagingController } from "./messaging.controller";
import {
  creditVerifiedMessagingTopUp,
  getMessagingWallet,
  reserveMessagingCredit,
  resolveMessagingCredit,
} from "./messaging-wallet";

describe("messaging wallet with PostgreSQL and runtime RLS", () => {
  const ids: string[] = [];
  const policy = { paidSendingEnabled: true, schoolDailyKobo: 500n, platformDailyKobo: 2_147_483_647n };

  async function school(): Promise<string> {
    const { id } = await basePrisma.school.create({ data: { name: "Fictional wallet school", status: "ACTIVE", slug: `wallet-${randomUUID()}` } });
    ids.push(id);
    return id;
  }

  afterAll(async () => {
    if (ids.length === 0) return;
    const admin = createPrismaClient(process.env.DIRECT_URL!);
    try {
      await admin.$transaction(async (tx) => {
        await tx.$executeRaw`ALTER TABLE messaging_wallet_entries DISABLE TRIGGER messaging_wallet_entry_immutable`;
        await tx.messagingWalletEntry.deleteMany({ where: { schoolId: { in: ids } } });
        await tx.$executeRaw`ALTER TABLE messaging_wallet_entries ENABLE TRIGGER messaging_wallet_entry_immutable`;
        await tx.messagingWalletTopUp.deleteMany({ where: { schoolId: { in: ids } } });
        await tx.auditLog.deleteMany({ where: { schoolId: { in: ids } } });
        await tx.user.deleteMany({ where: { schoolId: { in: ids } } });
        await tx.school.deleteMany({ where: { id: { in: ids } } });
      });
    } finally {
      await admin.$disconnect();
    }
  });

  it("isolates balances, credits a provider reference once and prevents concurrent overspending", async () => {
    const a = await school();
    const b = await school();
    const ref = randomUUID();
    expect(await creditVerifiedMessagingTopUp(a, ref, 100n)).toBe("CREDITED");
    expect(await creditVerifiedMessagingTopUp(a, ref, 100n)).toBe("ALREADY_CREDITED");
    expect(await creditVerifiedMessagingTopUp(b, ref, 100n)).toBe("CONFLICT");
    expect(await withTenant(b, (db) => db.messagingWalletEntry.count({ where: { schoolId: a } }))).toBe(0);
    const reservations = await Promise.all(
      ["first", "second", "third"].map(async (key) => ({ key, result: await reserveMessagingCredit(a, key, 80n, policy) })),
    );
    expect(reservations.map((r) => r.result).sort())
      .toEqual(["INSUFFICIENT_CREDIT", "INSUFFICIENT_CREDIT", "RESERVED"]);
    const key = reservations.find((r) => r.result === "RESERVED")!.key;
    expect(await getMessagingWallet(a)).toEqual({ availableKobo: 20n, reservedKobo: 80n });
    expect(await getMessagingWallet(b)).toEqual({ availableKobo: 0n, reservedKobo: 0n });
    expect(await reserveMessagingCredit(a, key, 80n, policy)).toBe("ALREADY_RESERVED");
    expect(await resolveMessagingCredit(a, key, "RELEASE")).toBe("RESOLVED");
    expect(await resolveMessagingCredit(a, key, "RELEASE")).toBe("ALREADY_RESOLVED");
    expect(await resolveMessagingCredit(a, key, "SETTLE")).toBe("CONFLICT");
    expect(await reserveMessagingCredit(a, "accepted-message", 35n, policy)).toBe("RESERVED");
    expect(await resolveMessagingCredit(a, "accepted-message", "SETTLE")).toBe("RESOLVED");
    expect(await getMessagingWallet(a)).toEqual({ availableKobo: 65n, reservedKobo: 0n });
    await expect(withTenant(a, (db) => db.messagingWalletEntry.deleteMany({ where: { schoolId: a } }))).rejects.toThrow(/immutable/i);
  });
  it("requires spending authorization and enforces a shared daily ceiling across schools", async () => {
    const a = await school();
    const b = await school();
    expect(await reserveMessagingCredit(a, "disabled", 1n)).toBe("SPENDING_DISABLED");
    await creditVerifiedMessagingTopUp(a, randomUUID(), 100n);
    await creditVerifiedMessagingTopUp(b, randomUUID(), 100n);
    const [row] = await basePrisma.$queryRaw<{ used: bigint }[]>`
      SELECT COALESCE((SELECT reserved_kobo FROM messaging_platform_reservations_daily
        WHERE day = (CURRENT_TIMESTAMP AT TIME ZONE 'Africa/Lagos')::date), 0) AS used`;
    const limited = { ...policy, schoolDailyKobo: 90n, platformDailyKobo: row!.used + 90n };
    expect(await reserveMessagingCredit(a, "over-school-limit", 91n, limited)).toBe("SPENDING_LIMIT");
    const reservations = await Promise.all([
      reserveMessagingCredit(a, "shared-a", 60n, limited),
      reserveMessagingCredit(b, "shared-b", 60n, limited),
    ]);
    expect(reservations.sort()).toEqual(["RESERVED", "SPENDING_LIMIT"]);
  });

  it("returns tenant-scoped wallet history and blocks foreign cursors", async () => {
    const a = await school();
    const b = await school();
    const role = await basePrisma.role.findFirstOrThrow({ where: { schoolId: null, key: "owner", isSystem: true } });
    const user = await withTenant(a, async (db) => {
      const owner = await db.user.create({ data: { schoolId: a, firstName: "Fictional", lastName: "Owner" } });
      await db.userRole.create({ data: { userId: owner.id, roleId: role.id } });
      return owner;
    });
    const auth = { schoolId: a, userId: user.id, sessionId: "test" };
    const controller = new MessagingController(new NotificationPreferencesService(), new EmailService(new ConfigService({ RESEND_API_KEY: "" })), {} as never);
    await creditVerifiedMessagingTopUp(a, randomUUID(), 100n);
    await creditVerifiedMessagingTopUp(b, randomUUID(), 200n);
    const bEntry = await withTenant(b, (db) => db.messagingWalletEntry.findFirstOrThrow({ where: { schoolId: b } }));
    const page = await controller.walletHistory(auth);
    expect(page.items).toEqual([expect.objectContaining({ kind: "TOP_UP", amountKobo: "100" })]);
    expect(page.nextCursor).toBeNull();
    await expect(controller.walletHistory(auth, bEntry.id)).rejects.toThrow("Invalid wallet cursor");
    const overview = await controller.overview(auth);
    expect(overview.wallet.availableKobo).toBe("100");
    expect(overview.templates).toHaveLength(9);
    expect(overview.templates.every((template) => template.approval === "UNKNOWN")).toBe(true);
    expect(overview.providers.filter((provider) => ["SMS", "WHATSAPP"].includes(provider.channel)).every((provider) => !provider.ready)).toBe(true);
  });

  it("credits only an independently verified Paystack top-up bound to the initiating school", async () => {
    const a = await school();
    const b = await school();
    const role = await basePrisma.role.findFirstOrThrow({ where: { schoolId: null, key: "owner", isSystem: true } });
    const owner = await withTenant(a, async (db) => {
      const user = await db.user.create({
        data: { schoolId: a, firstName: "Fictional", lastName: "Owner", emailVerified: true, email: `${randomUUID()}@example.test` },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return user;
    });
    const auth = { schoolId: a, userId: owner.id, sessionId: "test" };
    let verificationSchool = b;
    let verificationAmount = 600;
    const fake = {
      initializeTransaction: vi.fn(async ({ reference }: { reference: string }) => ({
        reference, authorization_url: "https://checkout.paystack.com/fictional", access_code: "fictional",
      })),
      verifyTransaction: vi.fn(async (reference: string) => ({
        reference, status: "success", amount: verificationAmount, currency: "NGN", paid_at: new Date().toISOString(),
        metadata: { purpose: "messaging-wallet-top-up", schoolId: verificationSchool },
      })),
    };
    const blocked = new MessagingTopUpService(new ConfigService({ MESSAGING_TOP_UPS_ENABLED: "off" }), fake as never);
    await expect(blocked.checkout(auth, randomUUID(), "500")).rejects.toThrow("currently disabled");
    expect(fake.initializeTransaction).not.toHaveBeenCalled();
    const service = new MessagingTopUpService(new ConfigService({
      MESSAGING_TOP_UPS_ENABLED: "on", MESSAGING_TOP_UP_MIN_KOBO: "100", MESSAGING_TOP_UP_MAX_KOBO: "1000",
    }), fake as never);
    const clientRequestId = randomUUID();
    const checkout = await service.checkout(auth, clientRequestId, "500");
    expect(await service.checkout(auth, clientRequestId, "500")).toEqual(checkout);
    expect(fake.initializeTransaction).toHaveBeenCalledTimes(1);
    expect(fake.initializeTransaction.mock.calls[0]?.[0]).not.toHaveProperty("subaccount");
    await service.acceptVerifiedCharge(checkout.reference);
    expect((await getMessagingWallet(a)).availableKobo).toBe(0n);
    verificationSchool = a;
    await service.acceptVerifiedCharge(checkout.reference);
    expect((await getMessagingWallet(a)).availableKobo).toBe(0n);
    verificationAmount = 500;
    await Promise.all([service.acceptVerifiedCharge(checkout.reference), service.acceptVerifiedCharge(checkout.reference)]);
    expect((await getMessagingWallet(a)).availableKobo).toBe(500n);
    expect((await getMessagingWallet(b)).availableKobo).toBe(0n);
  });

});
