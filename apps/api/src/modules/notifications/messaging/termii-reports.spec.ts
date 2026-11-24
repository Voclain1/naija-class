import { createHmac, randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { basePrisma, createPrismaClient, withTenant } from "@school-kit/db";
import type { Request } from "express";
import { afterAll, expect, it } from "vitest";

import { TermiiReportsController } from "./termii-reports.controller";
import { TermiiReportsService, type TermiiReportProfile } from "./termii-reports.service";

const schools: string[] = [];

async function school() {
  const result = await basePrisma.school.create({ data: { name: "Fictional Termii school", slug: `termii-qa-${randomUUID()}` } });
  schools.push(result.id);
  return result.id;
}

afterAll(async () => {
  if (!schools.length) return;
  const admin = createPrismaClient(process.env.DIRECT_URL!);
  try {
    await admin.notificationDelivery.deleteMany({ where: { schoolId: { in: schools } } });
    await admin.school.deleteMany({ where: { id: { in: schools } } });
  } finally {
    await admin.$disconnect();
  }
});

it("requires a single configured signature profile, preserves transitions, and ignores foreign deliveries", async () => {
  const schoolId = await school();
  const otherSchool = await school();
  const accountId = "fictional-termii";
  const profile: TermiiReportProfile = {
    accountId, schoolId, signatureHeader: "x-termii-signature", algorithm: "sha512",
    secret: "fictional-account-signing-secret", verificationEvidence: "fictional-QA-evidence", verifiedAt: "2026-01-01T00:00:00Z",
  };
  const config = { MESSAGING_TERMII_REPORT_PROFILES: JSON.stringify([profile]) };
  const disabled = new TermiiReportsController(new TermiiReportsService(new ConfigService({ ...config, MESSAGING_TERMII_REPORTS_ENABLED: "off" })));
  const service = new TermiiReportsService(new ConfigService({ ...config, MESSAGING_TERMII_REPORTS_ENABLED: "on" }));
  const controller = new TermiiReportsController(service);

  const payload = (status: string, algorithm: "sha256" | "sha512") => {
    const rawBody = Buffer.from(JSON.stringify({
      id: "fictional-event", message_id: "fictional-message", channel: "dnd", status,
      receiver: "fictional-private-number", schoolId: otherSchool,
    }));
    const signature = createHmac(algorithm, profile.secret).update(rawBody).digest("hex");
    return { rawBody, headers: { [profile.signatureHeader]: signature } } as Request & { rawBody: Buffer };
  };

  await expect(disabled.report(accountId, payload("Delivered", "sha512"))).rejects.toMatchObject({ status: 404 });
  await expect(controller.report(accountId, payload("Delivered", "sha256"))).rejects.toMatchObject({ status: 403 });
  await expect(controller.report(accountId, { headers: {} } as Request)).rejects.toMatchObject({ status: 403 });

  for (const owner of [schoolId, otherSchool]) {
    await withTenant(owner, (db) => db.notificationDelivery.create({ data: {
      schoolId: owner, channel: "SMS", eventType: "test", eventId: randomUUID(), principalType: "GUARDIAN",
      principalId: randomUUID(), providerAccountId: accountId, providerRef: "fictional-message",
    } }));
  }
  for (const state of ["Delivered", "Delivered", "Message Sent", "Message Failed"]) {
    await controller.report(accountId, payload(state, "sha512"));
  }
  await service.reconcile(profile);
  const events = await withTenant(schoolId, (db) => db.messagingTermiiEvent.findMany({ where: { schoolId } }));
  expect(events).toHaveLength(3);
  expect(events.every((event) => event.processedAt !== null)).toBe(true);
  expect(JSON.stringify(events)).not.toContain("fictional-private-number");
  const read = (id: string) => withTenant(id, (db) => db.notificationDelivery.findFirstOrThrow({ where: { schoolId: id } }));
  expect((await read(schoolId)).providerState).toBe("DELIVERED");
  expect((await read(otherSchool)).providerState).toBeNull();
});
