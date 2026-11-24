import { createHmac, randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { basePrisma, createPrismaClient, withTenant } from "@school-kit/db";
import type { Request } from "express";
import { afterAll, describe, expect, it } from "vitest";

import { MetaWebhookController } from "./meta-webhook.controller";
import { MetaWebhookService } from "./meta-webhook.service";

describe("Meta callback against PostgreSQL", () => {
  const schoolIds: string[] = [];
  const admin = createPrismaClient(process.env.DIRECT_URL!);
  const secret = "fictional-meta-app-secret";
  const verifyToken = "fictional-verify-token";
  const config = new ConfigService({
    MESSAGING_META_WEBHOOK_ENABLED: "on", MESSAGING_META_APP_SECRET: secret, MESSAGING_META_VERIFY_TOKEN: verifyToken,
  });
  const service = new MetaWebhookService(config);
  const controller = new MetaWebhookController(config, service);

  async function school(): Promise<string> {
    const { id } = await basePrisma.school.create({ data: { name: "Fictional Meta school", slug: `meta-${randomUUID()}` } });
    schoolIds.push(id);
    return id;
  }

  afterAll(async () => {
    try {
      await admin.notificationDelivery.deleteMany({ where: { schoolId: { in: schoolIds } } });
      await admin.school.deleteMany({ where: { id: { in: schoolIds } } });
    } finally {
      await admin.$disconnect();
    }
  });

  it("requires the verify token and keeps the route disabled without explicit configuration", () => {
    expect(controller.verify("subscribe", verifyToken, "123456")).toBe("123456");
    expect(() => controller.verify("subscribe", "wrong", "123456")).toThrow("Meta verification failed");
    const disabled = new MetaWebhookController(new ConfigService({ MESSAGING_META_WEBHOOK_ENABLED: "off" }), service);
    expect(() => disabled.verify("subscribe", verifyToken, "123456")).toThrow();
  });

  it("authenticates raw bytes, deduplicates, routes by phone and WABA, and never regresses READ", async () => {
    const schoolId = await school();
    const otherSchool = await school();
    const phoneNumberId = "990000123";
    const wabaId = "9900456";
    const providerRef = "wamid.fictional";
    await admin.messagingMetaAccount.create({ data: { schoolId, phoneNumberId, wabaId } });
    for (const owner of [schoolId, otherSchool]) {
      await withTenant(owner, (db) => db.notificationDelivery.create({
        data: {
          schoolId: owner, channel: "WHATSAPP", eventType: "test", eventId: randomUUID(),
          principalType: "GUARDIAN", principalId: randomUUID(), providerAccountId: phoneNumberId, providerRef,
        },
      }));
    }
    const timestamp = Math.floor(Date.now() / 1000) - 100;
    async function post(status: string, time: number, account = wabaId, signatureOverride?: string) {
      const body = {
        object: "whatsapp_business_account",
        entry: [{ id: account, changes: [{
          field: "messages",
          value: {
            messaging_product: "whatsapp", metadata: { phone_number_id: phoneNumberId },
            statuses: [{ id: providerRef, status, timestamp: String(time), recipient_id: "fictional-private-contact" }],
          },
        }] }],
      };
      const rawBody = Buffer.from(JSON.stringify(body));
      const signature = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
      return controller.receive({ rawBody, body } as Request & { rawBody: Buffer }, signatureOverride ?? signature);
    }

    await expect(post("failed", timestamp, wabaId, "sha256=broken")).rejects.toThrow("Invalid Meta signature");
    await post("failed", timestamp, "123456");
    await post("read", timestamp + 10);
    await post("read", timestamp + 10);
    await service.reconcile(schoolId);
    await post("sent", timestamp);
    await post("failed", timestamp + 30);
    await service.reconcile(schoolId);
    const events = await withTenant(schoolId, (db) => db.messagingMetaEvent.findMany({ where: { schoolId } }));
    expect(events).toHaveLength(3);
    expect(events.every((event) => event.processedAt !== null)).toBe(true);
    expect(JSON.stringify(events)).not.toContain("fictional-private-contact");
    expect(await withTenant(otherSchool, (db) => db.messagingMetaEvent.count({ where: { schoolId } }))).toBe(0);
    const ownDelivery = await withTenant(schoolId, (db) => db.notificationDelivery.findFirstOrThrow({ where: { schoolId } }));
    const foreignDelivery = await withTenant(otherSchool, (db) => db.notificationDelivery.findFirstOrThrow({ where: { schoolId: otherSchool } }));
    expect(ownDelivery.providerState).toBe("READ");
    expect(foreignDelivery.providerState).toBeNull();
  });
});
