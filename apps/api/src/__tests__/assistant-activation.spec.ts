import { randomUUID } from "node:crypto";

import type { INestApplication } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_FILTER } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { basePrisma, withTenant } from "@school-kit/db";
import { ASSISTANT_ORCHESTRATOR_APPROVAL } from "@school-kit/ai";
import { ASSISTANT_BLOCKERS, ASSISTANT_BLOCKER_TEXT, FEATURE_KEYS, type PlatformAdminAssistantStatusDto } from "@school-kit/types";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { AiGenerationService } from "../common/ai/ai-generation.service";
import { currentPeriodStart } from "../common/ai/ai.constants";
import type { AuthContext } from "../common/auth/auth-context";
import { createSession } from "../common/auth/sessions";
import { FeatureSwitchesService } from "../common/features/feature-switches.service";
import { HttpExceptionFilter } from "../common/http-exception.filter";
import { AssistantWorkspaceService } from "../modules/assistant-workspace/assistant-workspace.service";
import { ModelRoutingGate } from "../modules/assistant-workspace/orchestrator/model-routing-gate";
import { AuthService } from "../modules/auth/auth.service";
import { AssistantActivationService } from "../modules/platform-admin/assistant-activation.service";
import { PlatformAdminModule } from "../modules/platform-admin/platform-admin.module";
import { deleteSchoolRows } from "../modules/platform-admin/school-deletion";

// Controlled activation of the SchoolKit Assistant (2026-11-10,
// docs/modules/assistant-workspace.md, "Controlled activation").
//
// The owner's rules, each proven here against PostgreSQL and the real guard:
//   - only the platform admin switches the Assistant on or off for a school;
//   - it is off for every school by default, including a newly registered one;
//   - a school's own owner or admin cannot switch anything on;
//   - the status the platform admin sees says what is WORKING, never just what
//     is switched on, and names every blocker;
//   - the platform kill and a rollback take effect for staff;
//   - the prompt's approval gate is neither removed nor bypassed.
//
// Synthetic schools only. No model is called anywhere in this file.

const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
const ASSISTANT_KEYS = ["assistant-workspace", "assistant-billing", "reminder-campaigns", "student-intake", "student-corrections"] as const;

describe("SchoolKit Assistant: controlled activation by the platform admin", () => {
  const run = randomUUID().slice(0, 8);
  const schoolIds: string[] = [];
  const auditUserIds: string[] = [];
  let app: INestApplication;
  let platformToken: string;
  let ownerToken: string;
  let adminToken: string;
  let schoolId: string;
  let owner: AuthContext;
  let teacher: AuthContext;
  let features: FeatureSwitchesService;
  let ai: AiGenerationService;
  let staffSide: AssistantWorkspaceService;
  const envBefore = process.env.NODE_ENV;

  const statusUrl = (id: string) => `/api/v1/platform-admin/schools/${id}/assistant`;
  const status = async (id = schoolId): Promise<PlatformAdminAssistantStatusDto> => {
    const res = await request(app.getHttpServer()).get(statusUrl(id)).set("Authorization", `Bearer ${platformToken}`);
    expect(res.status).toBe(200);
    return res.body;
  };
  const set = (key: string, enabled: boolean, token = platformToken, id = schoolId) =>
    request(app.getHttpServer()).patch(`/api/v1/platform-admin/schools/${id}/features`).set("Authorization", `Bearer ${token}`).send({ key, enabled });
  const stored = async (id = schoolId) => (await basePrisma.school.findUnique({ where: { id }, select: { featureSwitches: true } }))?.featureSwitches;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), PlatformAdminModule],
      providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.init();
    features = app.get(FeatureSwitchesService, { strict: false });
    ai = app.get(AiGenerationService, { strict: false });
    // The staff side, on the SAME switch resolver the platform admin's writes
    // invalidate: what a member of staff's panel is told.
    staffSide = new AssistantWorkspaceService(features, new ModelRoutingGate(ai, features));

    const school = await basePrisma.school.create({
      data: { name: `Synthetic Activation School ${run}`, slug: `synthetic-activation-${run}`, status: "ACTIVE", aiEnabled: true },
      select: { id: true },
    });
    schoolId = school.id;
    schoolIds.push(schoolId);
    const mk = (roleKey: string, extra: { isPlatformAdmin?: boolean } = {}) =>
      withTenant(schoolId, async (db) => {
        const u = await db.user.create({
          data: { schoolId, firstName: "Synthetic", lastName: roleKey, email: `${roleKey}-${randomUUID()}@example.test`, isPlatformAdmin: extra.isPlatformAdmin ?? false },
          select: { id: true },
        });
        const role = await db.role.findFirst({ where: { schoolId: null, key: roleKey, isSystem: true }, select: { id: true } });
        if (!role) throw new Error(`system role '${roleKey}' not seeded — run pnpm db:seed`);
        await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
        return u.id;
      });
    const ownerId = await mk("owner");
    const adminId = await mk("admin");
    const teacherId = await mk("teacher");
    const platformId = await mk("owner", { isPlatformAdmin: true });
    auditUserIds.push(platformId);
    owner = { schoolId, userId: ownerId, sessionId: "t" } as AuthContext;
    teacher = { schoolId, userId: teacherId, sessionId: "t" } as AuthContext;
    ownerToken = (await createSession(schoolId, ownerId, reqCtx)).rawToken;
    adminToken = (await createSession(schoolId, adminId, reqCtx)).rawToken;
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
    await basePrisma.$disconnect();
  });

  it("every blocker has exact words for the console", () => {
    for (const b of ASSISTANT_BLOCKERS) expect(ASSISTANT_BLOCKER_TEXT[b].length).toBeGreaterThan(10);
  });

  it("is off for a school nobody switched on: nothing works, and each item says its switch is off", async () => {
    expect(await stored()).toEqual({});
    const s = await status();
    expect(s.workspace).toEqual({ key: "assistant-workspace", switchOn: false, working: false, blockers: ["SWITCH_OFF"] });
    for (const w of Object.values(s.workflows)) {
      expect(w).toMatchObject({ switchOn: false, working: false, blockers: ["SWITCH_OFF", "WORKSPACE_OFF"] });
    }
    expect(s.aiUnderstanding).toMatchObject({ key: "assistant-model-routing", switchOn: false, working: false, approval: ASSISTANT_ORCHESTRATOR_APPROVAL });
    expect(s.aiUnderstanding.blockers.slice(0, 2)).toEqual(["SWITCH_OFF", "WORKSPACE_OFF"]);
    // And staff are told the same.
    const caps = await staffSide.capabilities(owner);
    expect(caps.enabled).toBe(false);
    expect(caps.modelRouting.available).toBe(false);
  });

  it("a newly registered school and a newly provisioned school start with every switch off", async () => {
    const signedUp = await new AuthService().signupOwner(
      {
        schoolName: `Synthetic Signup ${run}`, ownerFirstName: "Synthetic", ownerLastName: "Owner",
        ownerEmail: `synthetic-signup-${run}@example.test`, ownerPhone: `+23480${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        password: "Correct-Horse-Synthetic-9", ndprConsent: true,
      },
      { ipAddress: null, userAgent: null },
    );
    schoolIds.push(signedUp.school.id);
    auditUserIds.push(signedUp.user.id);
    const provisioned = await request(app.getHttpServer())
      .post("/api/v1/platform-admin/schools")
      .set("Authorization", `Bearer ${platformToken}`)
      .send({ schoolName: `Synthetic Provisioned ${run}`, ownerEmail: `synthetic-provisioned-${run}@example.test` });
    expect(provisioned.status).toBe(201);
    schoolIds.push(provisioned.body.schoolId);

    for (const id of [signedUp.school.id, provisioned.body.schoolId as string]) {
      const s = await status(id);
      const items = [s.workspace, ...Object.values(s.workflows), s.aiUnderstanding];
      expect(items.every((i) => !i.switchOn && !i.working && i.blockers.includes("SWITCH_OFF"))).toBe(true);
      for (const key of FEATURE_KEYS) expect(await features.isOn(id, key)).toBe(false);
    }
  });

  it("the school's own owner and admin cannot read the status or switch anything on", async () => {
    for (const token of [ownerToken, adminToken]) {
      expect((await request(app.getHttpServer()).get(statusUrl(schoolId)).set("Authorization", `Bearer ${token}`)).status).toBe(403);
      for (const key of [...ASSISTANT_KEYS, "assistant-model-routing"]) {
        expect((await set(key, true, token)).status).toBe(403);
      }
    }
    expect((await request(app.getHttpServer()).get(statusUrl(schoolId))).status).toBe(401);
    expect(await stored()).toEqual({});
    for (const missing of ["no-such-school", randomUUID()]) {
      expect((await request(app.getHttpServer()).get(statusUrl(missing)).set("Authorization", `Bearer ${platformToken}`)).status).toBe(404);
    }
  });

  it("the platform admin switches the panel and the four tasks on; staff get them at once, by their own permissions; every change is audited", async () => {
    // The panel alone: the tasks are still off, each for its own reason.
    expect((await set("assistant-workspace", true)).status).toBe(200);
    let s = await status();
    expect(s.workspace).toMatchObject({ switchOn: true, working: true, blockers: [] });
    expect(s.workflows.invoices).toMatchObject({ switchOn: false, working: false, blockers: ["SWITCH_OFF"] });

    for (const key of ASSISTANT_KEYS.slice(1)) expect((await set(key, true)).status).toBe(200);
    s = await status();
    for (const w of Object.values(s.workflows)) expect(w).toMatchObject({ switchOn: true, working: true, blockers: [] });
    // AI understanding was not touched, and is not reported as on.
    expect(s.aiUnderstanding).toMatchObject({ switchOn: false, working: false });

    const ownerCaps = await staffSide.capabilities(owner);
    expect(ownerCaps.enabled).toBe(true);
    expect(Object.values(ownerCaps.workflows).every((w) => w.available && w.canApprove)).toBe(true);
    expect(ownerCaps.modelRouting.available).toBe(false);
    // Per-person permissions are untouched by the switches: a teacher gets no
    // invoice, reminder, intake or correction task.
    const teacherCaps = await staffSide.capabilities(teacher);
    expect(teacherCaps.enabled).toBe(true);
    expect(Object.values(teacherCaps.workflows).every((w) => !w.available && w.reason === "NO_PERMISSION" && !w.canApprove)).toBe(true);

    const audits = await basePrisma.auditLog.findMany({
      where: { action: "platform_admin.schools.set-feature", entityId: schoolId },
      select: { metadata: true, userId: true },
    });
    expect(audits).toHaveLength(ASSISTANT_KEYS.length);
    expect(new Set(audits.map((a) => (a.metadata as { key: string }).key))).toEqual(new Set(ASSISTANT_KEYS));
    expect(audits.every((a) => a.userId === auditUserIds[0] && (a.metadata as { from: boolean; to: boolean }).to === true)).toBe(true);
  });

  it("an AI understanding switch that is ON is not reported as working while anything blocks it, and names each blocker", async () => {
    expect((await set("assistant-model-routing", true)).status).toBe(200); // not production: the approval is not enforced here
    const { platformEnabled, providerConfigured } = ai.availability();
    const provider = !platformEnabled ? ["AI_PLATFORM_OFF"] : !providerConfigured ? ["AI_NOT_CONFIGURED"] : [];

    let s = await status();
    expect(s.aiUnderstanding.switchOn).toBe(true);
    expect(s.aiUnderstanding.blockers).toEqual(provider);
    expect(s.aiUnderstanding.working).toBe(provider.length === 0);
    expect(s.aiUnderstanding).toMatchObject({ approval: ASSISTANT_ORCHESTRATOR_APPROVAL, approvalEnforced: false });
    // The report and what staff are told never disagree.
    expect((await staffSide.capabilities(owner)).modelRouting.available).toBe(s.aiUnderstanding.working);

    // AI off for the school.
    await basePrisma.school.update({ where: { id: schoolId }, data: { aiEnabled: false } });
    s = await status();
    expect(s.aiUnderstanding).toMatchObject({ switchOn: true, working: false });
    expect(s.aiUnderstanding.blockers).toEqual([...provider, "SCHOOL_AI_OFF"]);
    expect(s.ai.schoolEnabled).toBe(false);
    expect((await staffSide.capabilities(owner)).modelRouting).toEqual({ available: false, reason: "AI_UNAVAILABLE" });
    await basePrisma.school.update({ where: { id: schoolId }, data: { aiEnabled: true } });

    // The month's budget used up.
    await basePrisma.school.update({ where: { id: schoolId }, data: { aiMonthlyTokenBudget: 1000 } });
    await withTenant(schoolId, (db) => db.aIBudgetPeriod.create({ data: { schoolId, periodStart: currentPeriodStart(), tokensReserved: 1000 } }));
    s = await status();
    expect(s.ai).toMatchObject({ monthlyTokenBudget: 1000, tokensUsedThisMonth: 1000 });
    expect(s.aiUnderstanding).toMatchObject({ switchOn: true, working: false });
    expect(s.aiUnderstanding.blockers).toEqual([...provider, "BUDGET_EXHAUSTED"]);
    await withTenant(schoolId, (db) => db.aIBudgetPeriod.deleteMany({ where: { schoolId } }));
    await basePrisma.school.update({ where: { id: schoolId }, data: { aiMonthlyTokenBudget: null } });

    // The panel off: AI understanding has nothing to serve.
    expect((await set("assistant-workspace", false)).status).toBe(200);
    s = await status();
    expect(s.aiUnderstanding.blockers).toEqual(["WORKSPACE_OFF", ...provider]);
    expect((await set("assistant-workspace", true)).status).toBe(200);
  });

  it("production: with the prompt's approval pending, AI understanding is refused for every school and cannot be switched on", async () => {
    expect(ASSISTANT_ORCHESTRATOR_APPROVAL).toBe("pending");
    process.env.NODE_ENV = "production";

    // The switch left on from the last test does not make it work.
    const s = await status();
    expect(s.aiUnderstanding).toMatchObject({ switchOn: true, working: false, approval: "pending", approvalEnforced: true });
    expect(s.aiUnderstanding.blockers).toContain("APPROVAL_PENDING");
    expect((await staffSide.capabilities(owner)).modelRouting).toEqual({ available: false, reason: "NOT_APPROVED" });

    // Switching it off is always allowed, and audited...
    expect((await set("assistant-model-routing", false)).status).toBe(200);
    // ...switching it on is refused, changes nothing and writes no audit row.
    const before = await basePrisma.auditLog.count({ where: { action: "platform_admin.schools.set-feature", entityId: schoolId } });
    const refused = await set("assistant-model-routing", true);
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("ASSISTANT_MODEL_NOT_APPROVED");
    expect((await stored()) as Record<string, boolean>).toMatchObject({ "assistant-model-routing": false });
    expect(await basePrisma.auditLog.count({ where: { action: "platform_admin.schools.set-feature", entityId: schoolId } })).toBe(before);
    // The other switches are not affected by the approval.
    expect((await status()).workspace.working).toBe(true);
  });

  it("the platform kill (FEATURES_DISABLED) beats a school's switch, and the status says so", async () => {
    const report = (disabled: string) => {
      const killed = new FeatureSwitchesService(new ConfigService({ FEATURES_DISABLED: disabled }));
      return { killed, service: new AssistantActivationService(killed, ai) };
    };
    const one = report("reminder-campaigns");
    const s1 = await one.service.status(schoolId);
    expect(s1.workflows.reminders).toMatchObject({ switchOn: true, working: false, blockers: ["PLATFORM_DISABLED"] });
    expect(s1.workflows.invoices.working).toBe(true);
    const caps1 = await new AssistantWorkspaceService(one.killed, new ModelRoutingGate(ai, one.killed)).capabilities(owner);
    expect(caps1.workflows.reminders).toMatchObject({ available: false, reason: "FEATURE_OFF" });
    expect(caps1.workflows.invoices.available).toBe(true);

    const all = report("*");
    const s2 = await all.service.status(schoolId);
    expect(s2.workspace).toMatchObject({ switchOn: true, working: false, blockers: ["PLATFORM_DISABLED"] });
    for (const w of Object.values(s2.workflows)) expect(w).toMatchObject({ switchOn: true, working: false, blockers: ["PLATFORM_DISABLED", "WORKSPACE_OFF"] });
    expect(s2.aiUnderstanding.blockers).toEqual(expect.arrayContaining(["SWITCH_OFF", "PLATFORM_DISABLED", "WORKSPACE_OFF"]));
    const caps2 = await new AssistantWorkspaceService(all.killed, new ModelRoutingGate(ai, all.killed)).capabilities(owner);
    expect(caps2.enabled).toBe(false);
    expect(Object.values(caps2.workflows).every((w) => !w.available)).toBe(true);
    expect(caps2.modelRouting.available).toBe(false);
  });

  it("rollback: switching everything off takes it away from staff at once and is audited; another school was never touched", async () => {
    const other = await basePrisma.school.create({ data: { name: `Synthetic Other ${run}`, slug: `synthetic-other-${run}`, status: "ACTIVE" }, select: { id: true } });
    schoolIds.push(other.id);

    for (const key of [...ASSISTANT_KEYS, "assistant-model-routing"]) expect((await set(key, false)).status).toBe(200);
    const s = await status();
    expect([s.workspace, ...Object.values(s.workflows), s.aiUnderstanding].every((i) => !i.switchOn && !i.working)).toBe(true);
    const caps = await staffSide.capabilities(owner);
    expect(caps.enabled).toBe(false);
    expect(Object.values(caps.workflows).every((w) => !w.available)).toBe(true);
    await expect(staffSide.help(owner, "how do I add parents")).rejects.toMatchObject({ code: "FORBIDDEN" });

    const offs = await basePrisma.auditLog.findMany({ where: { action: "platform_admin.schools.set-feature", entityId: schoolId }, select: { metadata: true } });
    for (const key of ASSISTANT_KEYS) {
      expect(offs.some((a) => (a.metadata as { key: string; to: boolean }).key === key && (a.metadata as { to: boolean }).to === false)).toBe(true);
    }
    expect(await stored(other.id)).toEqual({});
    expect(await basePrisma.auditLog.count({ where: { action: "platform_admin.schools.set-feature", entityId: other.id } })).toBe(0);
  });
});
