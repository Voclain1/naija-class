import { createHmac, randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { basePrisma, createPrismaClient, withTenant } from "@school-kit/db";
import type { Request } from "express";
import { afterAll, expect, it } from "vitest";

import { getMessagingReconciliation, getMessagingWallet } from "./messaging-wallet";
import { TermiiReportsController } from "./termii-reports.controller";
import { TermiiReportsService, type TermiiReportProfile } from "./termii-reports.service";

const schools: string[] = [];
const accountId = `fixture-${randomUUID()}`;

async function school() {
  const result = await basePrisma.school.create({ data: { name: "Fictional Termii school", slug: `termii-qa-${randomUUID()}` } });
  schools.push(result.id);
  return result.id;
}

afterAll(async () => {
  if (!schools.length) return;
  const admin = createPrismaClient(process.env.DIRECT_URL!);
  try {
    await admin.messagingTermiiInbox.deleteMany({ where: { accountId } });
    await admin.messagingWalletEntry.deleteMany({ where: { schoolId: { in: schools } } });
    await admin.auditLog.deleteMany({ where: { schoolId: { in: schools } } });
    await admin.notificationDelivery.deleteMany({ where: { schoolId: { in: schools } } });
    await admin.school.deleteMany({ where: { id: { in: schools } } });
  } finally {
    await admin.$disconnect();
  }
});

it("requires a single configured signature profile, preserves transitions, and ignores foreign deliveries", async () => {
  const schoolId = await school();
  const otherSchool = await school();
  const profile: TermiiReportProfile = {
    accountId, signatureHeader: "x-termii-signature", algorithm: "sha512",
    secret: "fictional-account-signing-secret", verificationEvidence: "fictional-QA-evidence", verifiedAt: "2026-01-01T00:00:00Z",
    billing: { currency: "NGN", unit: "NAIRA", finalStates: ["DELIVERED"], zeroIsFinal: false, contractRef: "fictional-billing" },
  };
  const config = { MESSAGING_TERMII_REPORT_PROFILES: JSON.stringify([profile]) };
  const disabled = new TermiiReportsController(new TermiiReportsService(new ConfigService({ ...config, MESSAGING_TERMII_REPORTS_ENABLED: "off" })));
  const service = new TermiiReportsService(new ConfigService({ ...config, MESSAGING_TERMII_REPORTS_ENABLED: "on" }));
  const controller = new TermiiReportsController(service);

  const payload = (status: string, algorithm: "sha256" | "sha512", reference = "fictional-message", cost = "0") => {
    const rawBody = Buffer.from(JSON.stringify({
      id: "fictional-event", message_id: reference, channel: "dnd", status,
      receiver: "fictional-private-number", schoolId: otherSchool, cost,
    }));
    const signature = createHmac(algorithm, profile.secret).update(rawBody).digest("hex");
    return { rawBody, headers: { [profile.signatureHeader]: signature } } as Request & { rawBody: Buffer };
  };

  await expect(disabled.report(accountId, payload("Delivered", "sha512"))).rejects.toMatchObject({ status: 404 });
  await expect(controller.report(accountId, payload("Delivered", "sha256"))).rejects.toMatchObject({ status: 403 });
  await expect(controller.report(accountId, { headers: {} } as Request)).rejects.toMatchObject({ status: 403 });

  const createDelivery = (owner: string, reference: string) => withTenant(owner, (db) => db.notificationDelivery.create({ data: {
    schoolId: owner, channel: "SMS", eventType: "test", eventId: randomUUID(), principalType: "GUARDIAN",
    principalId: randomUUID(), providerAccountId: accountId, providerRef: reference,
  } }));
  await createDelivery(schoolId, "fictional-message");
  await createDelivery(schoolId, "ambiguous-reference");
  await createDelivery(otherSchool, "ambiguous-reference");
  await controller.report(accountId, payload("Delivered", "sha512", "ambiguous-reference"));
  await controller.report(accountId, payload("Delivered", "sha512", "other-message"));
  await service.reconcile(profile);
  expect(await basePrisma.messagingTermiiInbox.count({ where: { accountId } })).toBe(2);
  await createDelivery(otherSchool, "other-message");
  await basePrisma.messagingTermiiInbox.updateMany({
    where: { accountId, providerRef: "other-message" }, data: { nextAttemptAt: new Date(0) },
  });
  for (const state of ["Delivered", "Delivered", "Message Sent", "Message Failed"]) {
    await controller.report(accountId, payload(state, "sha512"));
  }
  await service.reconcile(profile);
  const events = await withTenant(schoolId, (db) => db.messagingTermiiEvent.findMany({ where: { schoolId } }));
  expect(events).toHaveLength(3);
  expect(events.every((event) => event.processedAt !== null)).toBe(true);
  expect(JSON.stringify(events)).not.toContain("fictional-private-number");
  const read = (schoolId: string, providerRef: string) => withTenant(schoolId, (db) => db.notificationDelivery.findFirstOrThrow({
    where: { schoolId, providerRef },
  }));
  expect((await read(schoolId, "fictional-message")).providerState).toBe("DELIVERED");
  expect((await read(otherSchool, "other-message")).providerState).toBe("DELIVERED");
  expect((await read(schoolId, "ambiguous-reference")).providerState).toBeNull();
  expect((await read(otherSchool, "ambiguous-reference")).providerState).toBeNull();
  const billable = await createDelivery(schoolId, "charge-reference");
  await withTenant(schoolId, async (db) => {
    await db.notificationDelivery.updateMany({ where: { schoolId, id: billable.id }, data: { dispatchState: "ACCEPTED" } });
    await db.messagingWalletEntry.createMany({ data: [
      { id: randomUUID(), schoolId, kind: "TOP_UP", reference: randomUUID(), amountKobo: 500 },
      { id: randomUUID(), schoolId, kind: "RESERVE", reference: `notification:${billable.id}`, amountKobo: 100 },
    ] });
  });
  for (const [state, cost] of [["Message Sent", "0.50"], ["Delivered", "0"], ["Delivered", "50.001"]] as const) {
    await controller.report(accountId, payload(state, "sha512", "charge-reference", cost));
    await service.reconcile(profile);
    expect(await getMessagingWallet(schoolId)).toEqual({ availableKobo: 400n, reservedKobo: 100n });
  }
  for (let replay = 0; replay < 2; replay++) {
    await controller.report(accountId, payload("Delivered", "sha512", "charge-reference", "0.75"));
    await service.reconcile(profile);
  }
  expect(await getMessagingWallet(schoolId)).toEqual({ availableKobo: 425n, reservedKobo: 0n });
  expect((await getMessagingReconciliation(schoolId)).items[0]).toMatchObject({
    chargedKobo: "75", releasedKobo: "25", status: "SETTLED",
  });

});
