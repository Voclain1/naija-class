import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

import { ConfigService } from "@nestjs/config";

import { basePrisma, withTenant } from "@school-kit/db";

import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver.js";
import { StorageService } from "../../common/storage/storage.service.js";
import { AuthService } from "../auth/auth.service.js";
import { creditVerifiedMessagingTopUp, getMessagingReconciliation, getMessagingWallet, reconcileNotificationReservation } from "../notifications/messaging/messaging-wallet";
import { PAID_PAYMENT_EVENT, PaidMessagingService } from "../notifications/messaging/paid-messaging.service";
import { buildPaymentConfirmationHtml, PaymentConfirmationService } from "./payment-confirmation.service.js";
import { PaymentPlanService } from "./payment-plan.service.js";
import { PaymentsService } from "./payments.service.js";

// The family's confirmation of an online payment, in the school's name
// (2026-10-21). Real database; Paystack and Resend are stubbed.

const runId = Math.random().toString(36).slice(2, 8);
const auth = new AuthService();
const schoolIds = new Set<string>();
const reqCtx = { ipAddress: "127.0.0.1", userAgent: null as string | null };
let phoneCounter = 0;
const phone = () => `+23481${String(++phoneCounter % 100).padStart(2, "0")}${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

afterAll(async () => {
  for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
});

type Sent = { to: string; subject: string; html: string; schoolName?: string };

function fakeEmail(opts: { fail?: boolean } = {}) {
  const sent: Sent[] = [];
  return {
    sent,
    service: {
      isConfigured: true,
      async send(p: Sent) {
        if (opts.fail) throw new Error("Resend is down");
        sent.push(p);
      },
    },
  };
}

const paystackStub = {
  verifyTransaction: async (reference: string) => ({
    status: "success",
    reference,
    amount: 30_000_00,
    paid_at: new Date().toISOString(),
  }),
};

function makeService(email: ReturnType<typeof fakeEmail>, paid?: PaidMessagingService) {
  const storage = new StorageService(
    new FilesystemStorageDriver(path.join(os.tmpdir(), `sk-confirm-${runId}`), {
      baseUrl: "http://localhost:4000/api/v1",
      secret: "test-secret",
    }),
  );
  const confirmations = new PaymentConfirmationService(email.service as never, undefined, paid);
  return new PaymentsService(storage, paystackStub as never, new PaymentPlanService(), undefined, undefined, confirmations);
}

async function setUp(suffix: string, guardians: { email: string | null }[]) {
  const signed = await auth.signupOwner(
    {
      schoolName: `Greenfield ${suffix} ${runId}`,
      schoolSlug: `confirm-${suffix}-${runId}`,
      ownerFirstName: "Amaka",
      ownerLastName: "Boss",
      ownerEmail: `confirm-${suffix}-${runId}@example.test`,
      ownerPhone: phone(),
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    reqCtx,
  );
  const schoolId = signed.school.id;
  schoolIds.add(schoolId);
  await basePrisma.school.update({
    where: { id: schoolId },
    data: { status: "ACTIVE", onboardingStep: 5, paystackPaymentsEnabled: true, paystackSubaccountCode: `ACCT_${suffix}_${runId}` },
  });
  // Several short transactions: one long one runs past the 5 s limit on a cold database.
  const { year, term, student } = await withTenant(schoolId, async (db) => {
    const year = await db.academicYear.create({
      data: { schoolId, label: `2025/2026-${suffix}-${runId}`, startDate: new Date("2025-09-01"), endDate: new Date("2026-07-31") },
    });
    const term = await db.term.create({
      data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: new Date("2025-09-01"), endDate: new Date("2025-12-15") },
    });
    const student = await db.student.create({
      data: { schoolId, admissionNumber: `ADM-${suffix}-${runId}`, firstName: "Ada", lastName: "Obi", dateOfBirth: new Date("2012-01-01"), gender: "FEMALE" },
    });
    return { year, term, student };
  });
  const guardianIds: string[] = [];
  for (const [i, g] of guardians.entries()) {
    const guardian = await withTenant(schoolId, async (db) => {
      const created = await db.guardian.create({
        data: { schoolId, firstName: `Parent${i}`, lastName: "Obi", relationship: "MOTHER", phone: phone(), email: g.email },
      });
      await db.studentGuardian.create({ data: { schoolId, studentId: student.id, guardianId: created.id } });
      return created;
    });
    guardianIds.push(guardian.id);
  }
  return withTenant(schoolId, async (db) => {
    const invoice = await db.invoice.create({
      data: {
        schoolId,
        studentId: student.id,
        termId: term.id,
        academicYearId: year.id,
        status: "ISSUED",
        items: [],
        totalAmount: 50_000_00,
        totalDiscount: 0,
        totalDue: 50_000_00,
        issuedAt: new Date(),
        issuedBy: signed.user.id,
      },
    });
    const payment = await db.payment.create({
      data: { schoolId, invoiceId: invoice.id, studentId: student.id, amount: 30_000_00, method: "PAYSTACK", status: "PENDING" },
    });
    const reference = `PSK-${schoolId}-${payment.id}`;
    await db.payment.update({ where: { id: payment.id }, data: { paystackReference: reference } });
    return { schoolId, ownerId: signed.user.id, paymentId: payment.id, reference, guardianIds };
  });
}

const success = (reference: string) => ({
  event: "charge.success",
  data: { reference, status: "success", amount: 30_000_00, paid_at: new Date().toISOString() },
});

describe("online payment confirmation email", () => {
  it("emails each guardian once, in the school's name, when the webhook and the portal's check race", async () => {
    const email = fakeEmail();
    const svc = makeService(email);
    const { schoolId, reference } = await setUp("race", [{ email: `mum-${runId}@example.test` }, { email: `dad-${runId}@example.test` }]);

    await Promise.all([svc.handleWebhook(success(reference)), svc.verifyAndApply(schoolId, reference), svc.verifyAndApply(schoolId, reference)]);
    // A late, repeated webhook adds nothing either.
    await svc.handleWebhook(success(reference));

    expect(email.sent.map((s) => s.to).sort()).toEqual([`dad-${runId}@example.test`, `mum-${runId}@example.test`]);
    for (const s of email.sent) {
      expect(s.schoolName).toBe(`Greenfield race ${runId}`);
      expect(s.subject).toBe("Payment received: Ada Obi's school fees");
      expect(s.html).toContain("₦30,000.00");
      expect(s.html).toContain("₦20,000.00"); // left to pay
      expect(s.html).toContain("First Term");
      expect(s.html).toContain(reference);
      expect(s.html).toContain("will issue your receipt");
    }
  });

  it("holds a mismatched transaction without recording or confirming payment", async () => {
    const email = fakeEmail();
    const svc = makeService(email);
    const { schoolId, paymentId, reference } = await setUp("amount", [{ email: `amount-${runId}@example.test` }]);
    const event = success(reference);
    await svc.handleWebhook({ ...event, data: { ...event.data, amount: 50_000_00 } });
    const payment = await withTenant(schoolId, (db) => db.payment.findUniqueOrThrow({ where: { id: paymentId } }));
    expect(payment.status).toBe("PENDING");
    expect(email.sent).toEqual([]);
    await svc.handleWebhook(event);
    expect(email.sent).toHaveLength(1);
  });

  it("queues once from committed payment, waits through quiet hours, and holds an ambiguous SMS reservation", async () => {
    const { schoolId, ownerId, paymentId, reference, guardianIds } = await setUp("paid-outbound", [{ email: null }]);
    const sendWalletReservedSms = vi.fn().mockResolvedValue({ status: "UNKNOWN", reason: "PROVIDER_NO_ANSWER" });
    const config = {
      MESSAGING_PAID_ENABLED: "on", MESSAGING_PAID_PLATFORM_DAILY_KOBO: "100000",
      MESSAGING_TERMII_PAID_ACCOUNT_ID: "fictional-account",
      MESSAGING_PAID_PAYMENT_PROFILES: JSON.stringify([{
        schoolId, channel: "SMS", schoolDailyKobo: "10000", termiiAccountId: "fictional-account",
        rates: [{
          key: "TERMII_SMS", version: "fixture-1", evidence: "fictional rate sheet",
          effectiveFrom: "2026-01-01T00:00:00Z", effectiveUntil: "2028-01-01T00:00:00Z", verifiedAt: "2026-01-01T00:00:00Z",
          providerAmount: "50", rateNumerator: "1", rateDenominator: "1", taxBasisPoints: "0", marginBasisPoints: "0",
        }],
      }]),
    };
    const consent = { verifiedRecipient: async () => "+2348012345678" };
    const preferences = { getEnabledChannels: async () => ({ sms: true }), getPaidChannels: async () => ({ walletSmsEnabled: true }) };
    const termii = { isConfigured: true, sendWalletReservedSms };
    const worker = new PaidMessagingService(
      new ConfigService(config), consent as never, {} as never, preferences as never, termii as never,
    );
    await withTenant(schoolId, (db) => db.notificationPreference.create({
      data: { schoolId, smsEnabled: true, walletSmsEnabled: true, updatedBy: ownerId },
    }));
    const service = makeService(fakeEmail(), worker);
    const deliveries = () => withTenant(schoolId, (db) => db.notificationDelivery.findMany({
      where: { schoolId, eventId: paymentId, eventType: PAID_PAYMENT_EVENT },
    }));
    expect(await deliveries()).toHaveLength(0);
    const event = success(reference);
    await service.handleWebhook({ ...event, data: { ...event.data, amount: 50_000_00 } });
    expect(await deliveries()).toHaveLength(0);
    const enqueue = worker.queueVerifiedPayment.bind(worker);
    vi.spyOn(worker, "queueVerifiedPayment").mockImplementationOnce(async (...args) => {
      await enqueue(...args);
      throw new Error("simulated interruption before commit");
    });
    await expect(service.handleWebhook(event)).rejects.toThrow("simulated interruption");
    expect(await deliveries()).toHaveLength(0);
    expect(await withTenant(schoolId, (db) => db.payment.findUniqueOrThrow({ where: { id: paymentId } })))
      .toMatchObject({ status: "PENDING" });
    await Promise.all([service.handleWebhook(event), service.handleWebhook(event)]);
    expect(await deliveries()).toHaveLength(1);
    const day = new Date();
    day.setUTCHours(10, 0, 0, 0);
    const night = new Date(day);
    night.setUTCHours(22);
    await worker.processPending(night);
    expect(sendWalletReservedSms).not.toHaveBeenCalled();
    await creditVerifiedMessagingTopUp(schoolId, randomUUID(), 500n);
    await Promise.all([worker.processPending(day), worker.processPending(day)]);
    expect(sendWalletReservedSms).toHaveBeenCalledTimes(1);
    const [delivery] = await deliveries();
    expect(delivery).toMatchObject({ dispatchState: "UNKNOWN", dispatchRateVersion: "fixture-1", principalId: guardianIds[0] });
    const held = await getMessagingWallet(schoolId);
    expect(held.reservedKobo).toBeGreaterThan(0n);
    await worker.processPending(new Date(day.getTime() + 3600_000));
    expect(sendWalletReservedSms).toHaveBeenCalledTimes(1);
    expect(await getMessagingWallet(schoolId)).toEqual(held);
    await expect(reconcileNotificationReservation({
      schoolId, deliveryId: delivery!.id, operatorId: randomUUID(), resolution: "SETTLE", evidenceRef: "fictional-ledger-report",
      providerChargedKobo: held.reservedKobo + 1n,
    })).rejects.toMatchObject({ code: "MESSAGING_CHARGE_MISMATCH" });
    expect(await getMessagingWallet(schoolId)).toEqual(held);
    expect((await getMessagingReconciliation(schoolId)).items[0]).toMatchObject({
      status: "DISCREPANCY", chargedKobo: null, releasedKobo: null,
    });
    const charge = held.reservedKobo - 1n;
    const settle = () => reconcileNotificationReservation({
      schoolId, deliveryId: delivery!.id, operatorId: randomUUID(), resolution: "SETTLE",
      evidenceRef: "fictional-ledger-report", providerChargedKobo: charge,
    });
    const outcomes = await Promise.all([settle(), settle()]);
    expect(outcomes.map(({ status }) => status).sort()).toEqual(["ALREADY_RESOLVED", "RESOLVED"]);
    expect(await getMessagingWallet(schoolId)).toEqual({ availableKobo: 500n - charge, reservedKobo: 0n });
    expect((await getMessagingReconciliation(schoolId)).items[0]).toMatchObject({
      status: "SETTLED", discrepancyRecorded: true, chargedKobo: String(charge), releasedKobo: "1",
    });
  });

  it("skips a guardian with no email and one whose address bounced or complained", async () => {
    const email = fakeEmail();
    const svc = makeService(email);
    const bounced = `bounced-${runId}@example.test`;
    const { schoolId, reference } = await setUp("skip", [{ email: null }, { email: bounced }, { email: `ok-${runId}@example.test` }]);
    await withTenant(schoolId, (db) => db.emailSuppression.create({ data: { schoolId, email: bounced, reason: "BOUNCED", scope: "ALL" } }));

    await svc.handleWebhook(success(reference));

    expect(email.sent.map((s) => s.to)).toEqual([`ok-${runId}@example.test`]);
  });

  it("a failed email never undoes or blocks the payment", async () => {
    const email = fakeEmail({ fail: true });
    const svc = makeService(email);
    const { schoolId, paymentId, reference } = await setUp("fail", [{ email: `p-${runId}@example.test` }]);

    await expect(svc.handleWebhook(success(reference))).resolves.toBeUndefined();

    const payment = await withTenant(schoolId, (db) => db.payment.findUniqueOrThrow({ where: { id: paymentId } }));
    expect(payment.status).toBe("SUCCESS");
  });

  it("a failed online payment sends nothing", async () => {
    const email = fakeEmail();
    const svc = makeService(email);
    const { reference } = await setUp("failed", [{ email: `f-${runId}@example.test` }]);

    await svc.handleWebhook({ event: "charge.failed", data: { reference, status: "failed", amount: 30_000_00, paid_at: null } });

    expect(email.sent).toEqual([]);
  });

  it("the email body escapes what it is given and says when nothing is left to pay", () => {
    const html = buildPaymentConfirmationHtml({
      schoolName: "St <Mary's>",
      guardianFirstName: "Ngozi",
      studentName: "Ada Obi",
      termName: null,
      amount: 10_000_00,
      balance: 0,
      paidAt: new Date("2026-10-20T10:00:00Z"),
      reference: `PSK-${randomUUID()}`,
    });
    expect(html).toContain("St &lt;Mary&#39;s&gt;");
    expect(html).not.toContain("<Mary");
    expect(html).toContain("fully paid");
    expect(html).toContain("20 October 2026");
  });
});
