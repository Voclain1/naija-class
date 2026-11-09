import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigService } from "@nestjs/config";
import { basePrisma, withTenant } from "@school-kit/db";
import { afterAll, describe, expect, it } from "vitest";

import type { AuthContext } from "../../common/auth/auth-context";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service";
import { deleteSchoolRows } from "../platform-admin/school-deletion";
import { AssistantWorkspaceService } from "./assistant-workspace.service";

// Real PostgreSQL as app_user (docs/modules/assistant-workspace.md).

const schoolIds: string[] = [];
const ALL_ON = { "assistant-workspace": true, "assistant-billing": true, "reminder-campaigns": true, "student-intake": true, "student-corrections": true };

async function school(switches: Record<string, boolean>) {
  const s = await basePrisma.school.create({ data: { name: "Assistant", slug: `aw-${randomUUID()}`, status: "ACTIVE", featureSwitches: switches } });
  schoolIds.push(s.id);
  return withTenant(s.id, async (db) => {
    const mk = async (key: string, permissions: string[]) => {
      const user = await db.user.create({ data: { schoolId: s.id, firstName: "S", lastName: key } });
      const role = await db.role.create({ data: { schoolId: s.id, key, name: key, permissions } });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return { schoolId: s.id, userId: user.id, sessionId: "t" } as AuthContext;
    };
    return {
      id: s.id,
      admin: await mk("admin", ["*"]),
      bursar: await mk("bursar", ["invoice.read", "finance.debtors.read", "finance.debtors.remind"]),
      teacher: await mk("teacher", ["student.read", "student.update", "student.create"]),
    };
  });
}

describe("assistant workspace capabilities against PostgreSQL", () => {
  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
        await deleteSchoolRows(tx, id);
      }, { timeout: 60_000 });
    }
    await basePrisma.$disconnect();
  });

  it("derives each workflow from the person's own permissions, role and the school's switches", async () => {
    const s = await school(ALL_ON);
    const service = new AssistantWorkspaceService(new FeatureSwitchesService(new ConfigService({})));
    const admin = await service.capabilities(s.admin);
    expect(admin.enabled).toBe(true);
    expect(Object.values(admin.workflows).every((w) => w.available && w.canApprove)).toBe(true);
    // Model routing has its own switch, off here; every one of its gates is
    // covered in orchestrator/assistant-orchestrator.service.spec.ts.
    expect(admin.modelRouting).toEqual({ available: false, reason: "FEATURE_OFF" });
    expect(admin.inactivityMinutes).toBe(15);

    const bursar = await service.capabilities(s.bursar);
    expect(bursar.workflows.invoices).toEqual({ available: true, reason: null, canApprove: false }); // no invoice.issue
    expect(bursar.workflows.reminders).toEqual({ available: true, reason: null, canApprove: true });
    expect(bursar.workflows.intake).toMatchObject({ available: false, reason: "NO_PERMISSION" });
    // Permissions alone are not enough for student work: an owner or admin role, as the services require.
    const teacher = await service.capabilities(s.teacher);
    expect(teacher.workflows.intake).toMatchObject({ available: false, reason: "NO_PERMISSION" });
    expect(teacher.workflows.corrections).toMatchObject({ available: false, reason: "NO_PERMISSION" });
  });

  it("honours the workspace switch, each workflow switch and the platform kill", async () => {
    const off = await school({ ...ALL_ON, "assistant-workspace": false });
    const service = new AssistantWorkspaceService(new FeatureSwitchesService(new ConfigService({})));
    const a = await service.capabilities(off.admin);
    expect(a.enabled).toBe(false);
    expect(Object.values(a.workflows).every((w) => !w.available && w.reason === "FEATURE_OFF")).toBe(true);
    await expect(service.help(off.admin, "how do I add parents")).rejects.toMatchObject({ code: "FORBIDDEN" });

    const partial = await school({ "assistant-workspace": true, "student-intake": true });
    const p = await service.capabilities(partial.admin);
    expect(p.workflows.intake.available).toBe(true);
    expect(p.workflows.invoices).toMatchObject({ available: false, reason: "FEATURE_OFF" });

    const killed = new AssistantWorkspaceService(new FeatureSwitchesService(new ConfigService({ FEATURES_DISABLED: "assistant-workspace" })));
    const k = await killed.capabilities(partial.admin);
    expect(k.enabled).toBe(false);
    expect(k.workflows.intake.available).toBe(false);
  });

  it("refuses a deactivated account and answers help from the guide without a model", async () => {
    const s = await school(ALL_ON);
    const service = new AssistantWorkspaceService(new FeatureSwitchesService(new ConfigService({})));
    const { hits } = await service.help(s.admin, "How do I add parents?");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]).toMatchObject({ anchor: expect.any(String), title: expect.any(String) });
    await withTenant(s.id, (db) => db.user.update({ where: { id: s.admin.userId }, data: { isActive: false } }));
    await expect(service.capabilities(s.admin)).rejects.toMatchObject({ code: "USER_INACTIVE" });
    for (const f of ["assistant-workspace.service.ts", "assistant-workspace.module.ts", "assistant-workspace.controller.ts"]) {
      const imports = readFileSync(join(__dirname, f), "utf8").split("\n").filter((l) => /from "/.test(l)).join("\n");
      expect(imports).not.toMatch(/AiGenerationService|common\/ai|AiModule/);
    }
  });
});
