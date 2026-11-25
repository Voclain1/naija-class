import { randomUUID } from "node:crypto";

import { basePrisma } from "@school-kit/db";
import { describe, expect, it, vi } from "vitest";

import { smsSenderFor } from "./sms-sender.js";
import { normalizeNigerianPhone, TermiiService } from "./termii.service.js";

// normalizeNigerianPhone — pure, no network. Guardian.phone has zero format
// validation (packages/types/src/guardians/create-guardian.dto.ts), so this
// function is the only thing standing between whatever an admin typed and
// Termii's required international-no-plus format.
describe("normalizeNigerianPhone", () => {
  it("converts local format (0801...) to international (234801...)", () => {
    expect(normalizeNigerianPhone("08012345678")).toBe("2348012345678");
  });

  it("passes through already-international format with no leading +", () => {
    expect(normalizeNigerianPhone("2348012345678")).toBe("2348012345678");
  });

  it("strips a leading + from international format", () => {
    expect(normalizeNigerianPhone("+2348012345678")).toBe("2348012345678");
  });

  it("strips formatting characters (spaces, dashes)", () => {
    expect(normalizeNigerianPhone("+234 801 234 5678")).toBe("2348012345678");
    expect(normalizeNigerianPhone("0801-234-5678")).toBe("2348012345678");
  });

  it("treats a bare 10-digit number (no leading 0) as local-minus-zero", () => {
    expect(normalizeNigerianPhone("8012345678")).toBe("2348012345678");
  });

  it("returns null for an unrecognized length", () => {
    expect(normalizeNigerianPhone("12345")).toBeNull();
  });

  it("returns null for a malformed value containing letters", () => {
    // e.g. a test-fixture phone like "+23480f1000000" (see
    // guardians.service.spec.ts's guardianFields()) — digits-only
    // extraction leaves an invalid length/shape, not a garbage send.
    expect(normalizeNigerianPhone("+23480f1000000")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(normalizeNigerianPhone("")).toBeNull();
  });
});

// Constructor behavior — mirrors PaystackService.spec.ts's "no key" test:
// the service must not throw at construction time when TERMII_API_KEY is
// absent (the app still boots), only when sendSms is actually called.
describe("TermiiService", () => {
  function makeService(apiKey?: string): TermiiService {
    const config = { get: (key: string) => (key === "TERMII_API_KEY" ? apiKey : undefined) } as never;
    return new TermiiService(config);
  }

  it("does not throw at construction when TERMII_API_KEY is absent", () => {
    expect(() => makeService(undefined)).not.toThrow();
  });

  it("preflight rejects an implicit production cutover with an existing Termii credential", async () => {
    const config = { NODE_ENV: "production", TERMII_API_KEY: "fixture", MESSAGING_LEGACY_SMS_MIGRATION_MODE: "" };
    const service = new TermiiService({ get: (key: keyof typeof config) => config[key] } as never);
    await expect(service.onApplicationBootstrap()).rejects.toThrow(/explicit legacy SMS release/);
    config.MESSAGING_LEGACY_SMS_MIGRATION_MODE = "off";
    await expect(service.onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it("sendSms throws when TERMII_API_KEY is absent", async () => {
    await expect(makeService(undefined).sendSms("2348012345678", "hi")).rejects.toThrow();
  });

  it("sendSms throws when TERMII_API_KEY is the unfilled .env.example placeholder", async () => {
    await expect(makeService("replace-me").sendSms("2348012345678", "hi")).rejects.toThrow();
  });
});

// The school's own sender name (docs/modules/school-identity.md slice 2).
describe("TermiiService.sendSms — whose name the SMS goes out under", () => {
  async function sentFrom(senderId?: string) {
    const rate = {
      key: "TERMII_SMS", version: "fixture", evidence: "fixture",
      effectiveFrom: "2020-01-01T00:00:00Z", effectiveUntil: "2099-01-01T00:00:00Z", verifiedAt: "2020-01-01T00:00:00Z",
      providerAmount: "1", rateNumerator: "1", rateDenominator: "1", marginBasisPoints: "0", taxBasisPoints: "0",
    };
    const values: Record<string, string> = {
      TERMII_API_KEY: "tk_test", TERMII_SENDER_ID: "SchoolKit", MESSAGING_LEGACY_SMS_ENABLED: "on",
      MESSAGING_PAID_PLATFORM_DAILY_KOBO: "10000", MESSAGING_LEGACY_SMS_RATES: JSON.stringify([rate]),
    };
    const svc = new TermiiService({ get: (key: string) => values[key] } as never);
    const reserve = vi.spyOn(svc as unknown as { reservePlatformSpend(message: string): Promise<boolean> }, "reservePlatformSpend").mockResolvedValueOnce(true);
    const fetchMock = vi.fn(async (_url: string, _options: RequestInit) =>
      new Response(JSON.stringify({ code: "ok", message_id: "m1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await svc.sendSms("2348012345678", "hello", senderId);
      expect(reserve).toHaveBeenCalledOnce();
      return JSON.parse(fetchMock.mock.calls[0]![1].body as string).from as string;
    } finally {
      vi.unstubAllGlobals();
      reserve.mockRestore();
    }
  }

  it("refuses both legacy entry points before provider egress without a budget", async () => {
    const svc = new TermiiService({ get: (key: string) => key === "TERMII_API_KEY" ? "fixture" : undefined } as never);
    await expect(svc.sendSmsWithOutcome("2348012345678", "fixture")).resolves.toMatchObject({
      status: "REJECTED", reason: "PLATFORM_SMS_BUDGET_UNAVAILABLE",
    });
    await expect(svc.sendSms("2348012345678", "fixture")).rejects.toThrow();
  });

  it("authorizes only configured schools and producers and serializes the school's last available kobo", async () => {
    const school = await basePrisma.school.create({
      data: { name: "Legacy SMS fixture", slug: `legacy-sms-${randomUUID()}`, status: "ACTIVE" },
    });
    const rate = {
      key: "TERMII_SMS", version: "fixture", evidence: "fixture",
      effectiveFrom: "2020-01-01T00:00:00Z", effectiveUntil: "2099-01-01T00:00:00Z", verifiedAt: "2020-01-01T00:00:00Z",
      providerAmount: "1", rateNumerator: "1", rateDenominator: "1", marginBasisPoints: "0", taxBasisPoints: "0",
    };
    const config: Record<string, string> = {
      TERMII_API_KEY: "fixture",
      MESSAGING_LEGACY_SMS_MIGRATION_MODE: "existing-authorized",
      MESSAGING_LEGACY_SMS_AUTHORIZATIONS: JSON.stringify({ [school.id]: { producers: ["ADMISSION"], dailyKobo: "1" } }),
      MESSAGING_LEGACY_SMS_RATES: JSON.stringify([rate]),
      MESSAGING_PAID_PLATFORM_DAILY_KOBO: "2000000000",
    };
    const service = new TermiiService({ get: (key: string) => config[key] } as never);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "ok", message_id: "fictional" })));
    vi.stubGlobal("fetch", fetchMock);
    try {
      expect(await service.legacyReadiness(school.id, "FEE_REMINDER")).toMatchObject({ ready: false });
      expect(await service.legacyReadiness(school.id, "ADMISSION")).toMatchObject({ ready: true });
      const [foreign, unrelated, ...remaining] = await Promise.all([
        service.sendSmsWithOutcome("2348012345678", "fixture", undefined, { schoolId: randomUUID(), eventType: "ADMISSION", eventId: "foreign" }),
        service.sendSmsWithOutcome("2348012345678", "fixture", undefined, { schoolId: school.id, eventType: "FEE_REMINDER", eventId: "reminder" }),
        ...["first", "second"].map((eventId) =>
          service.sendSmsWithOutcome("2348012345678", "fixture", undefined, { schoolId: school.id, eventType: "ADMISSION", eventId })),
      ]);
      expect(foreign).toMatchObject({ status: "REJECTED" });
      expect(unrelated).toMatchObject({ status: "REJECTED" });
      expect(remaining.map(({ status }) => status).sort()).toEqual(["ACCEPTED", "REJECTED"]);
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(await service.legacyReadiness(school.id, "ADMISSION")).toMatchObject({ ready: false });
    } finally {
      vi.unstubAllGlobals();
      await basePrisma.school.delete({ where: { id: school.id } });
    }
  });

  it("blocks an otherwise authorized producer at the emergency stop without provider egress", async () => {
    const school = await basePrisma.school.create({
      data: { name: "Legacy SMS emergency fixture", slug: `legacy-sms-stop-${randomUUID()}`, status: "ACTIVE" },
    });
    const rate = {
      key: "TERMII_SMS", version: "fixture", evidence: "fixture",
      effectiveFrom: "2020-01-01T00:00:00Z", effectiveUntil: "2099-01-01T00:00:00Z", verifiedAt: "2020-01-01T00:00:00Z",
      providerAmount: "1", rateNumerator: "1", rateDenominator: "1", marginBasisPoints: "0", taxBasisPoints: "0",
    };
    const config: Record<string, string> = {
      TERMII_API_KEY: "fixture", MESSAGING_LEGACY_SMS_MIGRATION_MODE: "existing-authorized",
      MESSAGING_LEGACY_SMS_AUTHORIZATIONS: JSON.stringify({ [school.id]: { producers: ["ADMISSION"], dailyKobo: "10" } }),
      MESSAGING_LEGACY_SMS_RATES: JSON.stringify([rate]), MESSAGING_PAID_PLATFORM_DAILY_KOBO: "100",
    };
    const service = new TermiiService({ get: (key: string) => config[key] } as never);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "ok", message_id: "must-not-send" })));
    vi.stubGlobal("fetch", fetchMock);
    const stopped = await basePrisma.messagingEmergencyControl.create({
      data: { channel: "SMS", stopped: true, actorId: randomUUID(), evidenceRef: "fictional-emergency-test" },
    });
    try {
      await expect(service.sendSmsWithOutcome("2348012345678", "fixture", undefined,
        { schoolId: school.id, eventType: "ADMISSION", eventId: "blocked" }))
        .resolves.toMatchObject({ status: "REJECTED", reason: "PLATFORM_SMS_BUDGET_UNAVAILABLE" });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
      await basePrisma.messagingEmergencyControl.create({
        data: { channel: "SMS", stopped: false, actorId: stopped.actorId, evidenceRef: "fictional-emergency-test-reset" },
      });
      await basePrisma.school.delete({ where: { id: school.id } });
    }
  });

  it("uses the school's approved name when given one", async () => {
    await expect(sentFrom("DIVYSIXTH")).resolves.toBe("DIVYSIXTH");
  });

  it("falls back to the platform's TERMII_SENDER_ID", async () => {
    await expect(sentFrom(undefined)).resolves.toBe("SchoolKit");
  });
});

describe("smsSenderFor", () => {
  it("only an APPROVED name is ever used", () => {
    expect(smsSenderFor({ smsSenderId: "DIVYSIXTH", smsSenderStatus: "APPROVED" })).toBe("DIVYSIXTH");
    expect(smsSenderFor({ smsSenderId: "DIVYSIXTH", smsSenderStatus: "REQUESTED" })).toBeUndefined();
    expect(smsSenderFor({ smsSenderId: "DIVYSIXTH", smsSenderStatus: "REJECTED" })).toBeUndefined();
    expect(smsSenderFor({ smsSenderId: null, smsSenderStatus: "NONE" })).toBeUndefined();
  });
});
