import { randomBytes, randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { basePrisma, createPrismaClient, withTenant } from "@school-kit/db";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { MetaConnectionsService } from "./meta-connections.service";
import { MetaInboundHistoryService } from "./meta-inbound-history.service";
import { WHATSAPP_CONSENT_VERSION } from "./guardian-messaging-consent.service";
import { openMetaToken, sealMetaToken } from "./meta-credentials";

const key = randomBytes(32);
const settings = {
  MESSAGING_META_SIGNUP_ENABLED: "on", MESSAGING_META_APP_ID: "8123", MESSAGING_META_SIGNUP_CONFIG_ID: "8124",
  MESSAGING_META_APP_SECRET: "fictional-secret", MESSAGING_META_GRAPH_VERSION: "v27.0",
  MESSAGING_META_TOKEN_KEY: key.toString("base64"),
};
const wabaId = "8125";
const phoneNumberId = "8126";
const providerToken = "fictional-business-token";

describe("school-owned Meta connections against PostgreSQL", () => {
  const schools: string[] = [];
  const svc = new MetaConnectionsService(new ConfigService(settings));

  async function owner() {
    const school = await basePrisma.school.create({ data: { name: "Fictional connection", slug: `meta-qa-${randomUUID()}`, status: "ACTIVE" } });
    schools.push(school.id);
    const role = await basePrisma.role.findFirstOrThrow({ where: { key: "owner", schoolId: null, isSystem: true } });
    const user = await withTenant(school.id, async (db) => {
      const row = await db.user.create({ data: { schoolId: school.id, firstName: "Demo", lastName: "Owner" } });
      await db.userRole.create({ data: { userId: row.id, roleId: role.id } });
      return row;
    });
    return { schoolId: school.id, userId: user.id, isPlatformAdmin: false, sessionId: "test" };
  }

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    const admin = createPrismaClient(process.env.DIRECT_URL!);
    try {
      await admin.auditLog.deleteMany({ where: { schoolId: { in: schools } } });
      await admin.messagingGuardianConsent.deleteMany({ where: { schoolId: { in: schools } } });
      await admin.guardian.deleteMany({ where: { schoolId: { in: schools } } });
      await admin.user.deleteMany({ where: { schoolId: { in: schools } } });
      await admin.school.deleteMany({ where: { id: { in: schools } } });
    } finally {
      await admin.$disconnect();
    }
  });

  it("rejects unproven WABA ownership and refuses replay of a claimed state", async () => {
    const auth = await owner();
    const start = await svc.begin(auth);
    expect(start).not.toHaveProperty("appSecret");
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ access_token: providerToken }))
      .mockResolvedValueOnce(Response.json({ data: { app_id: settings.MESSAGING_META_APP_ID, is_valid: true, granular_scopes: [] } }));
    const input = { state: start.state, code: "fictional-grant", wabaId, phoneNumberId };
    await expect(svc.complete(auth, input)).rejects.toThrow("Meta could not verify");
    await expect(svc.complete(auth, input)).rejects.toThrow("Start a new Meta signup session");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("binds encrypted credentials to the school, subscribes, and offboards with retryable revocation", async () => {
    const a = await owner();
    const b = await owner();
    const start = await svc.begin(a);
    const fetcher = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ access_token: providerToken }))
      .mockResolvedValueOnce(Response.json({ data: {
        app_id: settings.MESSAGING_META_APP_ID, is_valid: true, granular_scopes: [
          { scope: "whatsapp_business_management", target_ids: [wabaId] },
          { scope: "whatsapp_business_messaging", target_ids: [wabaId] },
        ],
      } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: phoneNumberId }] }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    const input = { state: start.state, code: "fictional-grant", wabaId, phoneNumberId };
    await expect(svc.complete(b, input)).rejects.toThrow("Start a new Meta signup session");
    expect(fetcher).not.toHaveBeenCalled();
    expect(await svc.complete(a, input)).toEqual({ status: "CONNECTED", billing: "SCHOOL_OWNED" });
    const aConnection = await withTenant(a.schoolId, (db) =>
      db.messagingSchoolMetaConnection.findUniqueOrThrow({ where: { schoolId: a.schoolId } }));
    expect(aConnection.encryptedToken).not.toContain(providerToken);
    expect(openMetaToken(key, a.schoolId, wabaId, aConnection.encryptedToken!)).toBe(providerToken);
    expect(await withTenant(b.schoolId, (db) =>
      db.messagingSchoolMetaConnection.findUnique({ where: { schoolId: a.schoolId } }))).toBeNull();
    expect(() => openMetaToken(key, b.schoolId, wabaId, aConnection.encryptedToken!)).toThrow();

    const management = new MetaConnectionsService(new ConfigService({
      ...settings, MESSAGING_META_PHONE_REGISTRATION_ENABLED: "on", MESSAGING_META_TEMPLATE_SUBMISSION_ENABLED: "on",
    }));
    const template = {
      name: "fee_invoice_issued", language: "en", category: "UTILITY" as const,
      body: "School {{1}} issued a new invoice.", bodyExamples: ["Demo School"], paymentButtonText: "Pay invoice",
    };
    await expect(svc.registerPhone(a, "123456")).rejects.toThrow("unavailable");
    await expect(management.registerPhone(b, "123456")).rejects.toThrow("Verify the connected");
    await expect(management.submitTemplate(a, { ...template, body: "Hello {{2}}" })).rejects.toThrow("Template variables");
    fetcher.mockResolvedValueOnce(Response.json({ data: [{ id: phoneNumberId }] }))
      .mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: phoneNumberId }] }))
      .mockResolvedValueOnce(Response.json({ id: "1234", status: "PENDING" }));
    await expect(management.registerPhone(a, "123456")).resolves.toEqual({ status: "REGISTERED" });
    await expect(management.submitTemplate(a, template)).resolves.toEqual({ status: "SUBMITTED", id: "1234" });
    const registrations = fetcher.mock.calls.find(([url]) => String(url).endsWith(`/${phoneNumberId}/register`));
    expect(JSON.parse(String(registrations?.[1]?.body))).toEqual({ messaging_product: "whatsapp", pin: "123456" });
    const submitted = fetcher.mock.calls.find(([url]) => String(url).endsWith(`/${wabaId}/message_templates`));
    expect(JSON.parse(String(submitted?.[1]?.body))).toMatchObject({
      components: [{ type: "BODY" }, { type: "BUTTONS", buttons: [{ url: "https://paystack.com/pay/{{1}}" }] }],
    });

    const phone = "2348012345678";
    const guardian = await withTenant(a.schoolId, async (db) => {
      const guard = await db.guardian.create({ data: {
        schoolId: a.schoolId, firstName: "Fictional", lastName: "Guardian", phone, relationship: "MOTHER",
      } });
      await db.messagingGuardianConsent.create({ data: {
        schoolId: a.schoolId, guardianId: guard.id, phone, consentVersion: WHATSAPP_CONSENT_VERSION,
        verifiedAt: new Date(),
      } });
      return guard;
    });
    const history = new MetaInboundHistoryService(new ConfigService({
      MESSAGING_META_INBOUND_HISTORY_ENABLED: "on", MESSAGING_META_INBOUND_HISTORY_KEY: key.toString("base64"),
      MESSAGING_META_INBOUND_RETENTION_DAYS: JSON.stringify({ [a.schoolId]: 14, [b.schoolId]: 14 }),
    }));
    const inbound = {
      schoolId: a.schoolId, wabaId, phoneNumberId, providerRef: "wamid.fixture", from: phone,
      text: "Fictional message", occurredAt: new Date(),
    };
    await history.ingest({ ...inbound, wabaId: "76543" });
    await history.ingest({ ...inbound, providerRef: "wamid.stop", text: "STOP" });
    await Promise.all([history.ingest(inbound), history.ingest(inbound)]);
    await expect(history.history(a, guardian.id)).resolves.toMatchObject({ items: [{ text: inbound.text }], truncated: false });
    await expect(history.history(b, guardian.id)).resolves.toEqual({ items: [], truncated: false });
    await withTenant(a.schoolId, async (db) => {
      const rows = await db.messagingInboundMessage.findMany({ where: { schoolId: a.schoolId, guardianId: guardian.id } });
      expect(rows).toHaveLength(1);
      const [row] = rows;
      expect(row?.encryptedText).not.toContain(inbound.text);
      await db.messagingInboundMessage.updateMany({ where: { id: row!.id, schoolId: a.schoolId }, data: { expiresAt: new Date(0) } });
    });
    await expect(history.history(a, guardian.id)).resolves.toEqual({ items: [], truncated: false });
    await history.purgeExpired();
    expect(await withTenant(a.schoolId, (db) => db.messagingInboundMessage.count({ where: { schoolId: a.schoolId } }))).toBe(0);

    fetcher.mockRejectedValueOnce(new Error("timeout")).mockRejectedValueOnce(new Error("timeout")).mockRejectedValueOnce(new Error("timeout"));
    expect(await svc.disconnect(a)).toEqual({ status: "DISCONNECTED", revocationPending: true });
    expect(await basePrisma.messagingMetaAccount.findUnique({ where: { phoneNumberId } })).toBeNull();
    await expect(svc.begin(a)).rejects.toThrow("Disconnect the current account first");
    fetcher.mockResolvedValueOnce(Response.json({ success: true })).mockResolvedValueOnce(Response.json({ success: true }))
      .mockResolvedValueOnce(Response.json({ data: { is_valid: false } }));
    expect(await svc.disconnect(a)).toEqual({ status: "DISCONNECTED", revocationPending: false });
    await expect(svc.begin(a)).resolves.toHaveProperty("state");
  });

  it("authenticates the WABA as well as the school when decrypting tokens", () => {
    const sealed = sealMetaToken(key, "school-a", "waba-a", providerToken);
    expect(() => openMetaToken(key, "school-a", "waba-b", sealed)).toThrow();
    expect(() => openMetaToken(randomBytes(32), "school-a", "waba-a", sealed)).toThrow();
  });
});
