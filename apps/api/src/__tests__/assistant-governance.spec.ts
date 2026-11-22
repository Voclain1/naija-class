import { randomUUID } from "node:crypto";

import { Global, Module, type INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { AiAssistantTurn, AiCallRequest, AiCallResult, AiConversationRequest, AiConversationResult, AnthropicPort } from "@school-kit/ai";
import { AI_RELEASE_REQUIREMENTS, ASSISTANT_ORCHESTRATOR_APPROVAL } from "@school-kit/ai";
import { basePrisma, createPrismaClient, withTenant } from "@school-kit/db";
import { SCHOOL_AI_TERMS_VERSION, type AiReleaseStatusDto } from "@school-kit/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AiGenerationService } from "../common/ai/ai-generation.service";
import { REDIS_AUTH_CLIENT } from "../common/auth/redis-auth.provider";
import { createSession } from "../common/auth/sessions";
import { HttpExceptionFilter } from "../common/http-exception.filter";
import { AiTermsModule } from "../modules/ai-terms/ai-terms.module";
import { AssistantWorkspaceModule } from "../modules/assistant-workspace/assistant-workspace.module";
import { PlatformAdminModule } from "../modules/platform-admin/platform-admin.module";
import { deleteSchoolRows } from "../modules/platform-admin/school-deletion";

// SchoolKit Assistant governance over HTTP (docs/modules/assistant-ai-governance.md),
// with release enforcement ON (as in production), the real guards, the
// platform-admin and AI-terms modules, the Assistant's own turn endpoint, and
// PostgreSQL as app_user. The model is a counting fake: no network, no cost.
//
// Proves the acceptance criteria end to end: only the platform admin controls
// AI understanding, school by school; a school owner accepts terms but cannot
// activate; the fictional pilot is testable and cannot unlock a live school;
// the kill switches stop the very next request.

@Global()
@Module({
  providers: [{ provide: REDIS_AUTH_CLIENT, useValue: { get: async () => null, set: async () => "OK", del: async () => 1, pttl: async () => -2, incr: async () => 1, expire: async () => 1 } }],
  exports: [REDIS_AUTH_CLIENT],
})
class InertRedisAuthModule {}

class CountingPort implements AnthropicPort {
  calls = 0;
  async create(_req: AiCallRequest): Promise<AiCallResult> {
    throw new Error("unused");
  }
  async converse(_req: AiConversationRequest): Promise<AiConversationResult> {
    this.calls += 1;
    const turn: AiAssistantTurn = Object.freeze({ kind: "ai-assistant-turn" as const });
    return { text: "Here to help.", toolCalls: [], assistantTurn: turn, inputTokens: 50, outputTokens: 10, stopReason: "end_turn" };
  }
}

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
const PANEL = { "assistant-workspace": true };

describe("SchoolKit Assistant AI governance over HTTP (enforced)", () => {
  const run = randomUUID().slice(0, 8);
  const schoolIds: string[] = [];
  const auditUsers: string[] = [];
  const port = new CountingPort();
  const envBefore = process.env.AI_RELEASE_ENFORCEMENT;
  let direct: ReturnType<typeof createPrismaClient>;
  let app: INestApplication;
  let platform: string;
  let fictional: { id: string; owner: string; admin: string; ownerId: string };
  let live: { id: string; owner: string; admin: string; ownerId: string };
  const http = () => request(app.getHttpServer());
  const as = (token: string) => ({
    get: (url: string) => http().get(`/api/v1${url}`).set("Authorization", `Bearer ${token}`),
    post: (url: string, body: object = {}) => http().post(`/api/v1${url}`).set("Authorization", `Bearer ${token}`).send(body),
    patch: (url: string, body: object = {}) => http().patch(`/api/v1${url}`).set("Authorization", `Bearer ${token}`).send(body),
  });
  const turn = (token: string, text = "how do I add a student?") => as(token).post("/assistant/workspace/turn", { messages: [{ role: "user", text }] });
  const routing = async (token: string) => (await as(token).get("/assistant/workspace/capabilities")).body.modelRouting;
  const release = async (): Promise<AiReleaseStatusDto> => (await as(platform).get("/platform-admin/ai-release")).body;

  beforeAll(async () => {
    process.env.AI_RELEASE_ENFORCEMENT = "on";
    const url = process.env.DIRECT_URL;
    if (!url) throw new Error("DIRECT_URL is required: release events are append-only for the runtime role, so only the migration role can reset them.");
    direct = createPrismaClient(url);
    // A known starting point for the PLATFORM-level release log (append-only for app_user).
    await direct.$executeRawUnsafe("TRUNCATE ai_release_events");

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), InertRedisAuthModule, PlatformAdminModule, AiTermsModule, AssistantWorkspaceModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    })
      .overrideProvider(AiGenerationService).useValue(new AiGenerationService(new ConfigService({}), port))
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();

    const mkSchool = async (label: string) => {
      const s = await basePrisma.school.create({
        data: { name: `Synthetic Governance ${label} ${run}`, slug: `synthetic-gov-${label}-${run}`, status: "ACTIVE", aiEnabled: true, featureSwitches: PANEL },
        select: { id: true },
      });
      schoolIds.push(s.id);
      const mk = (roleKey: string, extra: { isPlatformAdmin?: boolean } = {}) =>
        withTenant(s.id, async (db) => {
          const u = await db.user.create({ data: { schoolId: s.id, firstName: "Synthetic", lastName: roleKey, email: `${roleKey}-${randomUUID()}@example.test`, isPlatformAdmin: extra.isPlatformAdmin ?? false }, select: { id: true } });
          const role = await db.role.findFirst({ where: { schoolId: null, key: roleKey, isSystem: true }, select: { id: true } });
          if (!role) throw new Error(`system role '${roleKey}' not seeded — run pnpm db:seed`);
          await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
          return u.id;
        });
      const ownerId = await mk("owner");
      const adminId = await mk("admin");
      return {
        id: s.id, ownerId,
        owner: (await createSession(s.id, ownerId, reqCtx)).rawToken,
        admin: (await createSession(s.id, adminId, reqCtx)).rawToken,
        mkPlatform: async () => {
          const id = await mk("owner", { isPlatformAdmin: true });
          auditUsers.push(id);
          return (await createSession(s.id, id, reqCtx)).rawToken;
        },
      };
    };
    const f = await mkSchool("fictional");
    const l = await mkSchool("live");
    const ops = await mkSchool("ops");
    platform = await ops.mkPlatform();
    fictional = f;
    live = l;
    // The live school already holds a real-looking record.
    await withTenant(live.id, (db) => db.student.create({ data: { schoolId: live.id, firstName: "Real", lastName: "Child", admissionNumber: "L-1", dateOfBirth: new Date("2014-01-01"), gender: "MALE" } }));
  }, 60_000);

  afterAll(async () => {
    process.env.AI_RELEASE_ENFORCEMENT = envBefore;
    await direct.$executeRawUnsafe("TRUNCATE ai_release_events");
    await basePrisma.auditLog.deleteMany({ where: { userId: { in: auditUsers } } });
    for (const id of schoolIds) {
      await basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
        await deleteSchoolRows(tx, id);
      }, { timeout: 60_000 });
    }
    await direct.$disconnect();
    await app.close();
  });

  it("[release-check:eng.fictional-classification] only the platform admin classifies a school, only while it is empty, and seeds invented records only into a fictional one", async () => {
    // A school's own owner and admin cannot reach any governance route.
    for (const token of [fictional.owner, fictional.admin]) {
      expect((await as(token).patch(`/platform-admin/schools/${fictional.id}/ai-data-classification`, { classification: "FICTIONAL" })).status).toBe(403);
      expect((await as(token).post(`/platform-admin/schools/${fictional.id}/fictional-pilot/seed`)).status).toBe(403);
    }
    // Real records can never be relabelled fictional.
    const refused = await as(platform).patch(`/platform-admin/schools/${live.id}/ai-data-classification`, { classification: "FICTIONAL" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("SCHOOL_HAS_RECORDS");
    // Seeding a LIVE school is refused.
    expect((await as(platform).post(`/platform-admin/schools/${live.id}/fictional-pilot/seed`)).body.error.code).toBe("SCHOOL_NOT_FICTIONAL");

    expect((await as(platform).patch(`/platform-admin/schools/${fictional.id}/ai-data-classification`, { classification: "FICTIONAL" })).body).toEqual({ schoolId: fictional.id, classification: "FICTIONAL" });
    const seeded = await as(platform).post(`/platform-admin/schools/${fictional.id}/fictional-pilot/seed`);
    expect(seeded.status).toBe(200);
    expect(seeded.body).toMatchObject({ students: 30, guardians: 30, classArms: 5, terms: 3 });
    // Invented contacts only: reserved test domain, non-routable numbers.
    const contacts = await withTenant(fictional.id, (db) => db.guardian.findMany({ select: { email: true, phone: true } }));
    expect(contacts.every((g) => g.email!.endsWith("@example.test") && g.phone.startsWith("+2340000000"))).toBe(true);
    // Seeding twice, or relabelling once it holds records, is refused.
    expect((await as(platform).post(`/platform-admin/schools/${fictional.id}/fictional-pilot/seed`)).body.error.code).toBe("SCHOOL_HAS_RECORDS");
    expect((await as(platform).patch(`/platform-admin/schools/${fictional.id}/ai-data-classification`, { classification: "LIVE" })).body.error.code).toBe("SCHOOL_HAS_RECORDS");
    const audits = await basePrisma.auditLog.findMany({ where: { entityId: fictional.id, action: { in: ["platform_admin.schools.set-ai-data-classification", "platform_admin.schools.seed-fictional-pilot"] } } });
    expect(audits).toHaveLength(2);
  });

  it("the release cannot be authorised while anything is open; engineering checks cannot be attested; the LIVE release stays blocked on the CLAUDE.md row", async () => {
    let s = await release();
    expect(s.scopes.FICTIONAL).toMatchObject({ complete: false, authorised: false, enforced: true });
    expect(s.scopes.FICTIONAL.requirements.filter((r) => r.kind === "engineering").every((r) => r.status === "verified")).toBe(true);
    expect(s.scopes.FICTIONAL.requirements.filter((r) => r.status === "open").map((r) => r.id).sort()).toEqual(["att.fictional.records-only", "att.fictional.staff-briefed", "att.provider-retention"]);
    expect(ASSISTANT_ORCHESTRATOR_APPROVAL).toBe("pending");
    expect(s.scopes.LIVE.requirements.find((r) => r.id === "live.allowlist-row")?.status).toBe("open");

    const early = await as(platform).post("/platform-admin/ai-release/FICTIONAL/authorise", { confirm: true, reference: "too early" });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("AI_RELEASE_INCOMPLETE");
    expect((await as(platform).post("/platform-admin/ai-release/FICTIONAL/attestations", { requirementId: "eng.tenant-isolation", confirm: true, reference: "nope" })).body.error.code).toBe("AI_RELEASE_NOT_ATTESTABLE");
    expect((await as(platform).post("/platform-admin/ai-release/FICTIONAL/attestations", { requirementId: "att.live.counsel", confirm: true, reference: "wrong scope" })).status).toBe(404);
    expect((await as(platform).post("/platform-admin/ai-release/NOPE/authorise", { confirm: true, reference: "x" })).status).toBe(400);
    // A school's owner cannot record or read the platform's release.
    expect((await as(fictional.owner).get("/platform-admin/ai-release")).status).toBe(403);
    expect((await as(fictional.owner).post("/platform-admin/ai-release/FICTIONAL/attestations", { requirementId: "att.provider-retention", confirm: true, reference: "owner" })).status).toBe(403);

    for (const id of ["att.fictional.records-only", "att.fictional.staff-briefed", "att.provider-retention"]) {
      const res = await as(platform).post("/platform-admin/ai-release/FICTIONAL/attestations", { requirementId: id, confirm: true, reference: `pilot evidence note ${id}` });
      expect(res.status).toBe(200);
    }
    s = await release();
    expect(s.scopes.FICTIONAL).toMatchObject({ complete: true, authorised: false });
    // The provider attestation is shared, but LIVE still has counsel, notices, evals and the allowlist row open.
    expect(s.scopes.LIVE.complete).toBe(false);
    expect((await as(platform).post("/platform-admin/ai-release/LIVE/authorise", { confirm: true, reference: "not yet" })).body.error.details.open).toEqual(
      expect.arrayContaining(["live.allowlist-row", "att.live.counsel", "att.live.terms-and-notices", "att.live.release-evals"]),
    );
    expect((await as(platform).post("/platform-admin/ai-release/FICTIONAL/authorise", { confirm: true, reference: "Virgo pilot go" })).body.scopes.FICTIONAL.authorised).toBe(true);
  });

  it("[release-check:eng.terms-gate] only the owner accepts the terms; accepting activates nothing; the platform admin alone switches the school on", async () => {
    // The platform admin switches it on for the fictional school (its release is authorised)...
    expect((await as(platform).patch(`/platform-admin/schools/${fictional.id}/features`, { key: "assistant-model-routing", enabled: true })).status).toBe(200);
    // ...but a live school cannot be switched on: the FICTIONAL release does not cover it.
    const liveOn = await as(platform).patch(`/platform-admin/schools/${live.id}/features`, { key: "assistant-model-routing", enabled: true });
    expect(liveOn.status).toBe(409);
    expect(liveOn.body.error).toMatchObject({ code: "ASSISTANT_MODEL_NOT_APPROVED", details: { classification: "LIVE" } });
    // The school's owner cannot switch anything on.
    expect((await as(fictional.owner).patch(`/platform-admin/schools/${fictional.id}/features`, { key: "assistant-model-routing", enabled: true })).status).toBe(403);

    // No acceptance yet: no model call.
    expect(await routing(fictional.admin)).toEqual({ available: false, reason: "TERMS_NOT_ACCEPTED" });
    expect((await turn(fictional.admin)).body.outcome).toBe("unavailable");
    expect(port.calls).toBe(0);

    // Anyone may read the terms; only the owner may decide.
    const terms = await as(fictional.admin).get("/schools/me/ai-terms");
    expect(terms.body).toMatchObject({ currentVersion: SCHOOL_AI_TERMS_VERSION, accepted: false, canDecide: false });
    expect(terms.body.points.join(" ")).toMatch(/Anthropic.*OpenAI.*30 days.*zero data retention/s);
    expect((await as(fictional.admin).post("/schools/me/ai-terms/accept", { version: SCHOOL_AI_TERMS_VERSION, accept: true })).body.error.code).toBe("AI_TERMS_OWNER_ONLY");
    expect((await as(fictional.owner).post("/schools/me/ai-terms/accept", { version: "2020-01-01", accept: true })).body.error.code).toBe("AI_TERMS_VERSION_CHANGED");
    expect((await as(fictional.owner).post("/schools/me/ai-terms/accept", { version: SCHOOL_AI_TERMS_VERSION, accept: false })).status).toBe(400);
    const accepted = await as(fictional.owner).post("/schools/me/ai-terms/accept", { version: SCHOOL_AI_TERMS_VERSION, accept: true });
    expect(accepted.body).toMatchObject({ accepted: true, canDecide: true, latest: { action: "ACCEPT", version: SCHOOL_AI_TERMS_VERSION } });

    expect(await routing(fictional.admin)).toEqual({ available: true, reason: null });
    expect((await turn(fictional.admin)).body.outcome).toBe("answered");
    expect(port.calls).toBe(1);

    // The live school's own acceptance would not help it: its release is not authorised.
    await as(live.owner).post("/schools/me/ai-terms/accept", { version: SCHOOL_AI_TERMS_VERSION, accept: true });
    await basePrisma.school.update({ where: { id: live.id }, data: { featureSwitches: { ...PANEL, "assistant-model-routing": true } } }); // forced past the write refusal
    expect(await routing(live.admin)).toEqual({ available: false, reason: "NOT_APPROVED" });
    expect((await turn(live.admin)).body.outcome).toBe("unavailable");
    expect(port.calls).toBe(1);
  });

  it("[release-check:eng.kill-switch] revoking the release, switching the school off, or withdrawing the terms stops the very next request", async () => {
    const before = port.calls;
    // Revoke: the platform-wide kill for this data scope.
    expect((await as(platform).post("/platform-admin/ai-release/FICTIONAL/revoke", { reason: "incident drill" })).body.scopes.FICTIONAL.authorised).toBe(false);
    expect((await turn(fictional.admin)).body.outcome).toBe("unavailable");
    expect(await routing(fictional.admin)).toEqual({ available: false, reason: "NOT_APPROVED" });
    // Re-authorise without re-attesting (attestations stand for this requirements version).
    await as(platform).post("/platform-admin/ai-release/FICTIONAL/authorise", { confirm: true, reference: "drill over" });
    expect((await turn(fictional.admin)).body.outcome).toBe("answered");

    // The school's switch, read from the row (no cache) on every turn.
    await as(platform).patch(`/platform-admin/schools/${fictional.id}/features`, { key: "assistant-model-routing", enabled: false });
    expect((await turn(fictional.admin)).body.outcome).toBe("unavailable");
    await as(platform).patch(`/platform-admin/schools/${fictional.id}/features`, { key: "assistant-model-routing", enabled: true });
    expect((await turn(fictional.admin)).body.outcome).toBe("answered");

    // The owner withdraws: the next turn stops, and live voice sessions end at once.
    const voice = await withTenant(fictional.id, (db) =>
      db.assistantVoiceSession.create({ data: { schoolId: fictional.id, userId: fictional.ownerId, provider: "openai", expiresAt: new Date(Date.now() + 300_000) } }),
    );
    const withdrawn = await as(fictional.owner).post("/schools/me/ai-terms/withdraw", { withdraw: true });
    expect(withdrawn.body).toMatchObject({ accepted: false, latest: { action: "WITHDRAW" } });
    expect((await turn(fictional.admin)).body.outcome).toBe("unavailable");
    expect(await withTenant(fictional.id, (db) => db.assistantVoiceSession.findUniqueOrThrow({ where: { id: voice.id } }))).toMatchObject({ status: "ENDED", endReason: "REVOKED" });
    expect(port.calls).toBe(before + 2);
  });

  it("[release-check:eng.tenant-isolation] governance records stay with their school; the release log is append-only for the runtime role", async () => {
    // The fictional school's terms rows are invisible under the live school's tenant.
    const seenFromLive = await withTenant(live.id, (db) => db.schoolAiTermsEvent.count({ where: { schoolId: fictional.id } }));
    expect(seenFromLive).toBe(0);
    expect(await withTenant(fictional.id, (db) => db.schoolAiTermsEvent.count())).toBe(2);
    // app_user can add and read release events, never change or remove them.
    await expect(basePrisma.$executeRawUnsafe("UPDATE ai_release_events SET reference = 'tampered'")).rejects.toThrow(/permission denied/i);
    await expect(basePrisma.$executeRawUnsafe("DELETE FROM ai_release_events")).rejects.toThrow(/permission denied/i);
    await expect(withTenant(fictional.id, (db) => db.$executeRawUnsafe("UPDATE school_ai_terms_events SET version = 'x'"))).rejects.toThrow(/permission denied/i);
    // Every release decision is in the platform audit log too.
    const audits = await basePrisma.auditLog.findMany({ where: { action: "platform_admin.ai-release", userId: { in: auditUsers } } });
    expect(audits.length).toBeGreaterThanOrEqual(6);
    expect(AI_RELEASE_REQUIREMENTS.length).toBeGreaterThan(10);
  });
});
