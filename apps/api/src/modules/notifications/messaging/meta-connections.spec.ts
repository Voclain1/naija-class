import { randomBytes, randomUUID } from "node:crypto";

import { ConfigService } from "@nestjs/config";
import { basePrisma, createPrismaClient, withTenant } from "@school-kit/db";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { MetaConnectionsService } from "./meta-connections.service";
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
