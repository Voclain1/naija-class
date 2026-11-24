import { createHmac, randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { basePrisma, createPrismaClient, withTenant } from "@school-kit/db";
import type { Request } from "express";
import { afterAll, expect, it } from "vitest";

import { GuardianMessagingConsentService, WHATSAPP_CONSENT_VERSION } from "./guardian-messaging-consent.service";
import { MetaWebhookController } from "./meta-webhook.controller";
import { MetaWebhookService } from "./meta-webhook.service";

const schools: string[] = [];
afterAll(async () => {
  if (!schools.length) return;
  const admin = createPrismaClient(process.env.DIRECT_URL!);
  try {
    await admin.auditLog.deleteMany({ where: { schoolId: { in: schools } } });
    await admin.guardian.deleteMany({ where: { schoolId: { in: schools } } });
    await admin.school.deleteMany({ where: { id: { in: schools } } });
  } finally {
    await admin.$disconnect();
  }
});

it("verifies the number only via an authenticated command and honors STOP and portal withdrawal", async () => {
  const { id: schoolId } = await basePrisma.school.create({
    data: { name: "Fictional consent school", slug: `consent-qa-${randomUUID()}`, status: "ACTIVE" },
  });
  schools.push(schoolId);
  const wabaId = "94301";
  const phoneNumberId = "94302";
  const phone = "2348012345678";
  const guardian = await withTenant(schoolId, async (db) => {
    await db.messagingMetaAccount.create({ data: { schoolId, wabaId, phoneNumberId } });
    await db.messagingSchoolMetaConnection.create({
      data: { schoolId, wabaId, phoneNumberId, displayPhone: "15555550001", encryptedToken: "fictional-sealed" },
    });
    return db.guardian.create({ data: {
      schoolId, firstName: "Fictional", lastName: "Guardian", phone: `+${phone}`, relationship: "MOTHER", emailVerified: true,
    } });
  });
  const auth = { schoolId, guardianId: guardian.id, sessionId: "test" };
  const consents = new GuardianMessagingConsentService();
  const appSecret = "fictional-meta-app-secret";
  const config = new ConfigService({
    MESSAGING_META_WEBHOOK_ENABLED: "on", MESSAGING_META_APP_SECRET: appSecret, MESSAGING_META_VERIFY_TOKEN: "fictional-verify-token",
  });
  const webhook = new MetaWebhookController(config, new MetaWebhookService(config, consents));
  const send = (command: string, from = phone, signed = true) => {
    const rawBody = Buffer.from(JSON.stringify({
      object: "whatsapp_business_account", entry: [{ id: wabaId, changes: [{ field: "messages", value: {
        messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId },
        messages: [{ type: "text", from, text: { body: command }, timestamp: String(Math.floor(Date.now() / 1000)) }],
      } }] }],
    }));
    const signature = signed ? `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}` : undefined;
    return webhook.receive({ rawBody } as Request & { rawBody: Buffer }, signature);
  };
  const start = async () => new URL((await consents.createChallenge(auth, WHATSAPP_CONSENT_VERSION)).url).searchParams.get("text")!;

  const command = await start();
  expect(await consents.verifiedRecipient(schoolId, guardian.id)).toBeNull();
  await expect(send(command, phone, false)).rejects.toMatchObject({ status: 403 });
  await send(command, "2348012340000");
  expect(await consents.verifiedRecipient(schoolId, guardian.id)).toBeNull();
  await send(command);
  expect(await consents.verifiedRecipient(schoolId, guardian.id)).toBe(`+${phone}`);
  await send("STOP");
  await send(command); // replay cannot restore a withdrawn grant
  expect(await consents.verifiedRecipient(schoolId, guardian.id)).toBeNull();
  await send(await start());
  expect(await consents.verifiedRecipient(schoolId, guardian.id)).toBe(`+${phone}`);
  await consents.withdraw(auth);
  expect(await consents.verifiedRecipient(schoolId, guardian.id)).toBeNull();
});
