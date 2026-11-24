import { randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { basePrisma } from "@school-kit/db";
import { expect, it, vi } from "vitest";

import { PaystackWebhookInboxService } from "./paystack-webhook-inbox.service.js";

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
    const row = await basePrisma.paystackWebhookInbox.findFirstOrThrow({ where });
    expect(await basePrisma.paystackWebhookInbox.count({ where })).toBe(1);
    expect(JSON.stringify(row.payload)).not.toContain("private@example");
    expect(handleWebhook).not.toHaveBeenCalled();
    const key = { mode_eventKey: { mode: row.mode, eventKey: row.eventKey } };
    await inbox.processPending();
    expect(await basePrisma.paystackWebhookInbox.findUniqueOrThrow({ where: key })).toMatchObject({ attempts: 1, processedAt: null });
    await basePrisma.paystackWebhookInbox.update({ where: key, data: { nextAttemptAt: new Date(0) } });
    await Promise.all([inbox.processPending(), inbox.processPending()]);
    expect(handleWebhook).toHaveBeenCalledTimes(2);
    expect(await basePrisma.paystackWebhookInbox.findUniqueOrThrow({ where: key }))
      .toMatchObject({ attempts: 2, processedAt: expect.any(Date), payload: null });
    await inbox.capture(event);
    await inbox.processPending();
    expect(handleWebhook).toHaveBeenCalledTimes(2);
    await basePrisma.paystackWebhookInbox.delete({ where: key });
  } finally {
    await basePrisma.paystackWebhookInbox.deleteMany({ where });
  }
});
