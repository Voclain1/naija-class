import { randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { basePrisma } from "@school-kit/db";
import { expect, it, vi } from "vitest";

import { PaystackWebhookInboxService, withPaystackWebhookInbox } from "./paystack-webhook-inbox.service.js";

it("captures a signed event projection once, durably retries, and discards processed payloads", async () => {
  const reference = `fixture-${randomUUID()}`;
  const handleWebhook = vi.fn().mockRejectedValueOnce(new Error("transient")).mockResolvedValueOnce(undefined);
  const inbox = new PaystackWebhookInboxService(
    new ConfigService({ PAYSTACK_WEBHOOK_MODE: "test" }), { handleWebhook } as never, {} as never, {} as never,
  );
  const event = { event: "charge.success", data: { reference, amount: 500, currency: "NGN", domain: "test", customer: { email: "private@example.test" } } };
  const where = { mode: "test", payload: { path: ["data", "reference"], equals: reference } };
  try {
    await Promise.all([inbox.capture(event), inbox.capture({ ...event, data: { ...event.data, customer: {} } })]);
    const row = await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.findFirstOrThrow({ where }));
    expect(await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.count({ where }))).toBe(1);
    expect(JSON.stringify(row.payload)).not.toContain("private@example");
    expect(handleWebhook).not.toHaveBeenCalled();
    expect(await basePrisma.paystackWebhookInbox.count({ where })).toBe(0);
    const key = { mode_eventKey: { mode: row.mode, eventKey: row.eventKey } };
    await inbox.processPending();
    expect(await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.findUniqueOrThrow({ where: key })))
      .toMatchObject({ attempts: 1, processedAt: null });
    const operator = randomUUID();
    await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.update({ where: key, data: { deadAt: new Date() } }));
    expect((await inbox.listDeadLetters()).items).toContainEqual(expect.objectContaining({ eventKey: row.eventKey }));
    const replays = await Promise.allSettled([
      inbox.replayDeadLetter(row.eventKey, operator, "verified-provider-event"),
      inbox.replayDeadLetter(row.eventKey, operator, "verified-provider-event"),
    ]);
    expect(replays.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await basePrisma.auditLog.count({
      where: { userId: operator, action: "payments.webhook.replay", entityId: row.eventKey },
    })).toBe(1);
    await Promise.all([inbox.processPending(), inbox.processPending()]);
    expect(handleWebhook).toHaveBeenCalledTimes(2);
    expect(await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.findUniqueOrThrow({ where: key })))
      .toMatchObject({ attempts: 1, processedAt: expect.any(Date), payload: null });
    await inbox.capture(event);
    await inbox.processPending();
    expect(handleWebhook).toHaveBeenCalledTimes(2);
    await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.delete({ where: key }));
  } finally {
    await withPaystackWebhookInbox((db) => db.paystackWebhookInbox.deleteMany({ where }));
  }
});
