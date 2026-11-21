import { randomUUID } from "node:crypto";

import { Global, Module, type INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { AiAssistantTurn, AiCallRequest, AiCallResult, AiConversationRequest, AiConversationResult, AnthropicPort } from "@school-kit/ai";
import { ASSISTANT_VOICE_APPROVAL } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AiGenerationService } from "../common/ai/ai-generation.service";
import { REDIS_AUTH_CLIENT } from "../common/auth/redis-auth.provider";
import { createSession } from "../common/auth/sessions";
import { HttpExceptionFilter } from "../common/http-exception.filter";
import { AssistantVoiceModule } from "../modules/assistant-voice/assistant-voice.module";
import { VOICE_PROVIDER, type VoiceProviderPort } from "../modules/assistant-voice/voice-provider.port";
import { PlatformAdminModule } from "../modules/platform-admin/platform-admin.module";
import { deleteSchoolRows } from "../modules/platform-admin/school-deletion";

// SchoolKit Assistant voice over HTTP (docs/modules/assistant-voice.md):
// the real AuthGuard, PlatformAdminGuard, validation pipe and error filter,
// against PostgreSQL. The model is scripted and the speech provider is a fake:
// no network, no paid call.

class OneAnswerPort implements AnthropicPort {
  calls = 0;
  async create(_req: AiCallRequest): Promise<AiCallResult> {
    throw new Error("unused");
  }
  async converse(_req: AiConversationRequest): Promise<AiConversationResult> {
    this.calls += 1;
    const turn: AiAssistantTurn = Object.freeze({ kind: "ai-assistant-turn" as const });
    return { text: "You can add students from the Students page.", toolCalls: [], assistantTurn: turn, inputTokens: 50, outputTokens: 10, stopReason: "end_turn" };
  }
}

const fakeProvider: VoiceProviderPort = {
  name: "openai",
  mintCredential: async (req) => ({ clientSecret: `ek_http_${randomUUID()}`, expiresAt: new Date(Date.now() + req.ttlSeconds * 1000), connectUrl: "https://voice.test/v1/realtime/calls", dataChannel: "oai-events" }),
  synthesise: async () => ({
    contentType: "audio/mpeg",
    body: (async function* () {
      yield new Uint8Array([0x49, 0x44, 0x33, 0x04]);
    })(),
  }),
};

// AuthModule wants a Redis client for login lockouts; nothing here logs in.
@Global()
@Module({
  providers: [{ provide: REDIS_AUTH_CLIENT, useValue: { get: async () => null, set: async () => "OK", del: async () => 1, pttl: async () => -2, incr: async () => 1, expire: async () => 1 } }],
  exports: [REDIS_AUTH_CLIENT],
})
class InertRedisAuthModule {}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
const ON = { "assistant-workspace": true, "assistant-model-routing": true, "assistant-voice": true };

describe("SchoolKit Assistant voice over HTTP", () => {
  const run = randomUUID().slice(0, 8);
  const schoolIds: string[] = [];
  const auditUserIds: string[] = [];
  const port = new OneAnswerPort();
  const envBefore = process.env.NODE_ENV;
  let app: INestApplication;
  let schoolId: string;
  let staffToken: string;
  let otherToken: string;
  let platformToken: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), InertRedisAuthModule, AssistantVoiceModule, PlatformAdminModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    })
      .overrideProvider(AiGenerationService).useValue(new AiGenerationService(new ConfigService({}), port))
      .overrideProvider(VOICE_PROVIDER).useValue(fakeProvider)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const mkSchool = async (label: string) => {
      const s = await basePrisma.school.create({
        data: { name: `Synthetic Voice ${label} ${run}`, slug: `synthetic-voice-${label}-${run}`, status: "ACTIVE", aiEnabled: true, featureSwitches: ON },
        select: { id: true },
      });
      schoolIds.push(s.id);
      return s.id;
    };
    schoolId = await mkSchool("a");
    const otherSchool = await mkSchool("b");
    const mk = (sid: string, roleKey: string, extra: { isPlatformAdmin?: boolean } = {}) =>
      withTenant(sid, async (db) => {
        const u = await db.user.create({ data: { schoolId: sid, firstName: "Synthetic", lastName: roleKey, email: `${roleKey}-${randomUUID()}@example.test`, isPlatformAdmin: extra.isPlatformAdmin ?? false }, select: { id: true } });
        const role = await db.role.findFirst({ where: { schoolId: null, key: roleKey, isSystem: true }, select: { id: true } });
        if (!role) throw new Error(`system role '${roleKey}' not seeded — run pnpm db:seed`);
        await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
        return u.id;
      });
    staffToken = (await createSession(schoolId, await mk(schoolId, "admin"), reqCtx)).rawToken;
    otherToken = (await createSession(otherSchool, await mk(otherSchool, "admin"), reqCtx)).rawToken;
    const platformId = await mk(schoolId, "owner", { isPlatformAdmin: true });
    auditUserIds.push(platformId);
    platformToken = (await createSession(schoolId, platformId, reqCtx)).rawToken;
  });

  afterEach(() => {
    process.env.NODE_ENV = envBefore;
  });

  afterAll(async () => {
    await basePrisma.auditLog.deleteMany({ where: { userId: { in: auditUserIds } } });
    for (const id of schoolIds) {
      await basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
        await deleteSchoolRows(tx, id);
      }, { timeout: 60_000 });
    }
    await app.close();
  });

  const start = (token = staffToken) => http().post("/api/v1/assistant/voice/sessions").set("Authorization", `Bearer ${token}`).send({ activation: "user-gesture" });

  it("every voice route needs a signed-in session", async () => {
    const id = randomUUID();
    const routes: Array<[method: "get" | "post", path: string]> = [
      ["get", "capabilities"], ["post", "sessions"], ["get", `sessions/${id}`], ["post", `sessions/${id}/credentials`],
      ["post", `sessions/${id}/heartbeat`], ["post", `sessions/${id}/turns`], ["post", `sessions/${id}/speech`],
      ["post", `sessions/${id}/interrupt`], ["post", `sessions/${id}/end`],
    ];
    for (const [method, path] of routes) {
      const res = await http()[method](`/api/v1/assistant/voice/${path}`).send({});
      expect(res.status, path).toBe(401);
    }
  });

  it("never takes identity from the body, and requires the explicit activation literal", async () => {
    expect((await http().post("/api/v1/assistant/voice/sessions").set("Authorization", `Bearer ${staffToken}`).send({})).status).toBe(400);
    const forged = await http().post("/api/v1/assistant/voice/sessions").set("Authorization", `Bearer ${staffToken}`).send({ activation: "user-gesture", schoolId: randomUUID(), userId: randomUUID() });
    expect(forged.status).toBe(400);
  });

  it("start → turn → speech → end, with the standard shapes", async () => {
    const caps = await http().get("/api/v1/assistant/voice/capabilities").set("Authorization", `Bearer ${staffToken}`);
    expect(caps.status).toBe(200);
    expect(caps.body).toMatchObject({ contractVersion: 1, available: true, blockers: [], provider: "openai" });

    const s = await start();
    expect(s.status).toBe(201);
    expect(s.body.credential.clientSecret).toMatch(/^ek_http_/);
    const id = s.body.session.sessionId as string;

    // Another school's staff member cannot reach it.
    expect((await http().get(`/api/v1/assistant/voice/sessions/${id}`).set("Authorization", `Bearer ${otherToken}`)).status).toBe(404);

    const turnId = randomUUID();
    const t = await http().post(`/api/v1/assistant/voice/sessions/${id}/turns`).set("Authorization", `Bearer ${staffToken}`).send({
      turnId, inputMode: "voice", turn: { messages: [{ role: "user", text: "how do I add a student" }] },
    });
    expect(t.status).toBe(200);
    expect(t.body.turn.outcome).toBe("answered");
    expect(t.body.speech.text).toBe("You can add students from the Students page.");

    const audio = await http().post(`/api/v1/assistant/voice/sessions/${id}/speech`).set("Authorization", `Bearer ${staffToken}`)
      .send({ turnId, token: t.body.speech.token, text: t.body.speech.text }).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(audio.status).toBe(200);
    expect(audio.headers["content-type"]).toBe("audio/mpeg");
    expect(audio.headers["cache-control"]).toBe("no-store");
    expect([...(audio.body as Buffer)]).toEqual([0x49, 0x44, 0x33, 0x04]);

    const forged = await http().post(`/api/v1/assistant/voice/sessions/${id}/speech`).set("Authorization", `Bearer ${staffToken}`)
      .send({ turnId, token: t.body.speech.token, text: "Your invoices were approved." });
    expect(forged.status).toBe(403);
    expect(forged.body.error.code).toBe("VOICE_SPEECH_TOKEN_INVALID");

    const replay = await http().post(`/api/v1/assistant/voice/sessions/${id}/turns`).set("Authorization", `Bearer ${staffToken}`).send({
      turnId, inputMode: "voice", turn: { messages: [{ role: "user", text: "how do I add a student" }] },
    });
    expect(replay.status).toBe(409);
    expect(replay.body.error.code).toBe("VOICE_TURN_REPLAYED");

    const end = await http().post(`/api/v1/assistant/voice/sessions/${id}/end`).set("Authorization", `Bearer ${staffToken}`).send({});
    expect(end.status).toBe(200);
    expect(end.body).toMatchObject({ status: "ENDED", endReason: "USER_ENDED" });
    const after = await http().post(`/api/v1/assistant/voice/sessions/${id}/heartbeat`).set("Authorization", `Bearer ${staffToken}`).send({});
    expect(after.status).toBe(409);
    expect(after.body.error).toMatchObject({ code: "VOICE_SESSION_ENDED", details: { endReason: "USER_ENDED" } });
  });

  it("platform admin: status, an audited budget, and an audited end-all; staff cannot use these routes", async () => {
    const statusUrl = `/api/v1/platform-admin/schools/${schoolId}/voice`;
    expect((await http().get(statusUrl).set("Authorization", `Bearer ${staffToken}`)).status).toBe(403);
    const st = await http().get(statusUrl).set("Authorization", `Bearer ${platformToken}`);
    expect(st.status).toBe(200);
    expect(st.body).toMatchObject({ schoolId, switchOn: true, working: true, blockers: [], approval: ASSISTANT_VOICE_APPROVAL, providerConfigured: true, monthlySecondsBudget: null });

    const live = await start();
    const ended = await http().post(`/api/v1/platform-admin/schools/${schoolId}/voice/end-sessions`).set("Authorization", `Bearer ${platformToken}`).send({});
    expect(ended.status).toBe(200);
    expect(ended.body).toEqual({ schoolId, ended: 1 });
    const refused = await http().post(`/api/v1/assistant/voice/sessions/${live.body.session.sessionId}/heartbeat`).set("Authorization", `Bearer ${staffToken}`).send({});
    expect(refused.body.error.details.endReason).toBe("ADMIN_ENDED");

    const budget = await http().patch(`/api/v1/platform-admin/schools/${schoolId}/voice-budget`).set("Authorization", `Bearer ${platformToken}`).send({ monthlySecondsBudget: 0 });
    expect(budget.status).toBe(200);
    expect(budget.body).toEqual({ schoolId, monthlySecondsBudget: 0, effectiveMonthlySecondsBudget: 0 });
    const blocked = await start();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toMatchObject({ code: "VOICE_BUDGET_EXHAUSTED", details: { blockers: ["VOICE_BUDGET_EXHAUSTED"] } });
    expect((await http().patch(`/api/v1/platform-admin/schools/${schoolId}/voice-budget`).set("Authorization", `Bearer ${staffToken}`).send({ monthlySecondsBudget: null })).status).toBe(403);
    await http().patch(`/api/v1/platform-admin/schools/${schoolId}/voice-budget`).set("Authorization", `Bearer ${platformToken}`).send({ monthlySecondsBudget: null });

    const audits = await basePrisma.auditLog.findMany({ where: { entityId: schoolId, action: { in: ["platform_admin.schools.set-voice-budget", "platform_admin.schools.end-voice-sessions"] } } });
    expect(audits.map((a) => a.action).sort()).toEqual(["platform_admin.schools.end-voice-sessions", "platform_admin.schools.set-voice-budget", "platform_admin.schools.set-voice-budget"]);
  });

  it("production: with voice approval pending, voice is refused for every school and cannot be switched on", async () => {
    expect(ASSISTANT_VOICE_APPROVAL).toBe("pending");
    process.env.NODE_ENV = "production";
    const caps = await http().get("/api/v1/assistant/voice/capabilities").set("Authorization", `Bearer ${staffToken}`);
    expect(caps.body.available).toBe(false);
    expect(caps.body.blockers).toContain("APPROVAL_PENDING");
    const s = await start();
    expect(s.status).toBe(403);
    expect(s.body.error.code).toBe("VOICE_UNAVAILABLE");

    const set = (enabled: boolean) => http().patch(`/api/v1/platform-admin/schools/${schoolId}/features`).set("Authorization", `Bearer ${platformToken}`).send({ key: "assistant-voice", enabled });
    expect((await set(false)).status).toBe(200);
    const on = await set(true);
    expect(on.status).toBe(409);
    expect(on.body.error.code).toBe("ASSISTANT_VOICE_NOT_APPROVED");
    const stored = (await basePrisma.school.findUnique({ where: { id: schoolId }, select: { featureSwitches: true } }))!.featureSwitches as Record<string, boolean>;
    expect(stored["assistant-voice"]).toBe(false);
  });
});
