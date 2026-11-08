import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DEFAULT_GRADE_BOUNDARIES,
  SYSTEM_ROLE_SEEDS,
  applySchoolDefaults,
  basePrisma,
  withTenant,
} from "@school-kit/db";
import { ForbiddenError, resolveLetterGrade } from "@school-kit/types";

import type { AuthContext } from "../../auth/auth-context";
import { GradingService } from "../../../modules/grading/grading.service";
import { NotificationPreferencesService } from "../../../modules/notifications/notification-preferences.service";
import { deleteSchoolRows } from "../../../modules/platform-admin/school-deletion";
import { SetupStateService } from "../../../modules/setup-state/setup-state.service";
import { buildAssistantToolRegistry } from "./assistant-tools";
import { SETTINGS_TOOLS } from "./settings-tools";
import { TOOL_OUTPUT_MAX_CHARS, TOOL_REFUSAL } from "./tool-registry";

// FD-5b — the settings tools (docs/reviews/agentic-implementation-plan.md
// §3.3, §4.4). Real Postgres, real role grants, real default grading. The
// PII/money/behaviour/health scan over these tools is the FD-3b gate
// (__tests__/assistant-tool-conformance.spec.ts); this file covers who may
// call each one, that it stays inside its school, and how big it gets.

const runId = Math.random().toString(36).slice(2, 8);
const schoolIds: string[] = [];
const registry = buildAssistantToolRegistry();

interface TestSchool {
  readonly id: string;
  readonly people: Record<string, AuthContext>;
}

async function makeSchool(label: string, opts: { plan?: "FREE" | "GROWTH"; schemeName?: string } = {}): Promise<TestSchool> {
  const school = await basePrisma.school.create({
    data: { name: `${label} ${runId}`, slug: `settings-tools-${runId}-${schoolIds.length}`, plan: opts.plan ?? "FREE" },
    select: { id: true },
  });
  schoolIds.push(school.id);
  const people: Record<string, AuthContext> = {};
  await withTenant(school.id, async (db) => {
    await applySchoolDefaults(db as never, school.id);
    if (opts.schemeName) await db.gradingScheme.updateMany({ data: { name: opts.schemeName } });
    const year = await db.academicYear.create({
      data: { schoolId: school.id, label: `${label}-Y`, startDate: new Date("2026-09-07"), endDate: new Date("2027-07-23"), isCurrent: true },
      select: { id: true },
    });
    await db.term.create({
      data: {
        schoolId: school.id,
        academicYearId: year.id,
        sequence: 1,
        name: `${label} First Term`,
        startDate: new Date("2026-09-07"),
        endDate: new Date("2026-12-11"),
        isCurrent: true,
      },
    });
    for (const seed of SYSTEM_ROLE_SEEDS) {
      const role = await db.role.findFirst({ where: { schoolId: null, key: seed.key, isSystem: true }, select: { id: true } });
      if (!role) throw new Error(`system role '${seed.key}' not seeded — run pnpm db:seed`);
      const u = await db.user.create({
        data: {
          schoolId: school.id,
          firstName: seed.key,
          lastName: `Settings-${runId}`,
          email: `${seed.key}-${runId}-${schoolIds.length}@example.test`,
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
      people[seed.key] = { sessionId: "settings-tools", userId: u.id, schoolId: school.id };
    }
  });
  return { id: school.id, people };
}

const call = (name: string, input: unknown = {}) => ({ id: `toolu_${name}`, name, input });

let a: TestSchool;
let b: TestSchool;

beforeAll(async () => {
  a = await makeSchool("Settings School A", { plan: "GROWTH", schemeName: `Scheme-A-${runId}` });
  b = await makeSchool("Settings School B", { schemeName: `Scheme-B-${runId}` });
  // School B's own, distinctive settings: none may appear in A's answers.
  await withTenant(b.id, async (db) => {
    await db.gradeBoundary.updateMany({ where: { letter: "A1" }, data: { remark: `B-only remark ${runId}` } });
    await db.gradingComponent.updateMany({ where: { key: "exam" }, data: { label: `B-only exam ${runId}` } });
    await db.notificationPreference.create({
      data: { schoolId: b.id, emailEnabled: false, smsEnabled: true, pushEnabled: false, updatedBy: b.people.owner!.userId },
    });
  });
}, 60_000);

afterAll(async () => {
  for (const id of schoolIds) {
    await basePrisma
      .$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
          await deleteSchoolRows(tx, id);
        },
        { timeout: 60_000 },
      )
      .catch(() => undefined);
  }
});

describe("settings tools (FD-5b): who may call each one", () => {
  // What the matching settings PAGE would let this person see: the route's
  // permission (PermissionsGuard) and then the service's own role check.
  const grading = new GradingService();
  const setup = new SetupStateService();
  const prefs = new NotificationPreferencesService();
  const holds = (roleKey: string, p: string) => {
    const perms = SYSTEM_ROLE_SEEDS.find((r) => r.key === roleKey)!.permissions;
    return perms.includes("*") || perms.includes(p);
  };
  const pageAllows: Record<string, (roleKey: string, ctx: AuthContext) => Promise<boolean>> = {
    school_profile_summary: async () => true,
    school_setup_progress: (_k, ctx) => setup.getSetupState(ctx).then(() => true, refusedOnly),
    grading_scheme: (k, ctx) => (holds(k, "grading-scheme.read") ? grading.getScheme(ctx).then(() => true, refusedOnly) : Promise.resolve(false)),
    grading_boundaries: (k, ctx) => (holds(k, "grade-boundary.read") ? grading.listBoundaries(ctx).then(() => true, refusedOnly) : Promise.resolve(false)),
    grading_explain_score: (k, ctx) => (holds(k, "grade-boundary.read") ? grading.listBoundaries(ctx).then(() => true, refusedOnly) : Promise.resolve(false)),
    notification_channels: (k, ctx) => (holds(k, "notification-preferences.read") ? prefs.get(ctx).then(() => true, refusedOnly) : Promise.resolve(false)),
  };
  function refusedOnly(err: unknown): false {
    if (err instanceof ForbiddenError) return false;
    throw err;
  }

  it("every role gets exactly what its settings pages show it, and a refusal is the fixed sentence", async () => {
    expect(Object.keys(pageAllows).sort()).toEqual(SETTINGS_TOOLS.map((t) => t.name).sort());
    const mismatches: string[] = [];
    for (const seed of SYSTEM_ROLE_SEEDS) {
      const ctx = a.people[seed.key]!;
      for (const tool of SETTINGS_TOOLS) {
        const expected = await pageAllows[tool.name]!(seed.key, ctx);
        const res = await registry.execute(ctx, call(tool.name, tool.conformanceCalls[0]));
        if (expected && res.isError) mismatches.push(`${seed.key} ${tool.name}: refused (${res.content})`);
        if (!expected && res.content !== TOOL_REFUSAL.NOT_PERMITTED) mismatches.push(`${seed.key} ${tool.name}: got ${res.content.slice(0, 60)}`);
      }
    }
    expect(mismatches).toEqual([]);
  }, 60_000);

  it("reads the table the way a person would expect", async () => {
    const ok = async (role: string, tool: string, input: unknown = {}) =>
      !(await registry.execute(a.people[role]!, call(tool, input))).isError;
    // Owner and admin: everything.
    for (const role of ["owner", "admin"]) {
      for (const t of SETTINGS_TOOLS) expect(await ok(role, t.name, t.conformanceCalls[0]), `${role} ${t.name}`).toBe(true);
    }
    // A teacher: the school, and the scheme the gradebook shows them. Not the
    // boundaries, notification settings or the owner's setup checklist.
    expect(await ok("teacher", "school_profile_summary")).toBe(true);
    expect(await ok("teacher", "grading_scheme")).toBe(true);
    expect(await ok("teacher", "grading_boundaries")).toBe(false);
    expect(await ok("teacher", "grading_explain_score", { score: 50 })).toBe(false);
    expect(await ok("teacher", "notification_channels")).toBe(false);
    expect(await ok("teacher", "school_setup_progress")).toBe(false);
    // A bursar: only the school's name, plan and term.
    expect(await ok("bursar", "school_profile_summary")).toBe(true);
    expect(await ok("bursar", "grading_scheme")).toBe(false);
  });

  it("a member of staff switched off is refused by every tool", async () => {
    const ctx = a.people.admin!;
    await withTenant(a.id, (db) => db.user.update({ where: { id: ctx.userId }, data: { isActive: false } }));
    try {
      for (const t of SETTINGS_TOOLS) {
        const res = await registry.execute(ctx, call(t.name, t.conformanceCalls[0]));
        expect(res.content, t.name).toBe(TOOL_REFUSAL.INACTIVE);
      }
    } finally {
      await withTenant(a.id, (db) => db.user.update({ where: { id: ctx.userId }, data: { isActive: true } }));
    }
  });
});

describe("settings tools (FD-5b): each school sees only itself", () => {
  it("school A's owner gets A's settings, and none of B's", async () => {
    const owner = a.people.owner!;
    const out: Record<string, string> = {};
    for (const t of SETTINGS_TOOLS) out[t.name] = (await registry.execute(owner, call(t.name, t.conformanceCalls[0]))).content;
    const all = Object.values(out).join("\n");

    expect(JSON.parse(out.school_profile_summary!)).toEqual({
      schoolName: `Settings School A ${runId}`,
      plan: "Growth",
      currentYear: { label: "Settings School A-Y", starts: "2026-09-07", ends: "2027-07-23" },
      currentTerm: { name: "Settings School A First Term", starts: "2026-09-07", ends: "2026-12-11" },
    });
    expect(JSON.parse(out.grading_scheme!).name).toBe(`Scheme-A-${runId}`);
    expect(JSON.parse(out.notification_channels!)).toEqual({ email: true, sms: false, push: false });

    for (const bOnly of [`Settings School B ${runId}`, `Scheme-B-${runId}`, `B-only remark ${runId}`, `B-only exam ${runId}`, "Settings School B First Term"]) {
      expect(all).not.toContain(bOnly);
    }
    // And B's owner sees B's own values, so the A result is not just "defaults".
    const bScheme = JSON.parse((await registry.execute(b.people.owner!, call("grading_scheme"))).content);
    expect(bScheme.components.map((c: { label: string }) => c.label)).toContain(`B-only exam ${runId}`);
    expect(JSON.parse((await registry.execute(b.people.owner!, call("notification_channels"))).content)).toEqual({
      email: false,
      sms: true,
      push: false,
    });
  });

  it("no output carries an id, a user id or a who-changed-it timestamp", async () => {
    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    for (const t of SETTINGS_TOOLS) {
      for (const input of t.conformanceCalls) {
        const res = await registry.execute(a.people.owner!, call(t.name, input));
        expect(res.content, t.name).not.toMatch(uuid);
        expect(res.content, t.name).not.toMatch(/"(id|userId|updatedBy|updatedAt|createdAt)"/);
      }
    }
  });
});

describe("settings tools (FD-5b): output size", () => {
  it("at the largest settings the API accepts, every tool's output fits under the cap untruncated", async () => {
    const big = await makeSchool(`Settings School With A Very Long Name For Size ${"x".repeat(80)}`);
    await withTenant(big.id, async (db) => {
      // 20 boundaries and 20 components, each label and remark at the API's 80-character limit.
      await db.gradeBoundary.deleteMany({});
      await db.gradeBoundary.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({
          schoolId: big.id,
          letter: `G${String(i).padStart(2, "0")}xyz`.slice(0, 8),
          minScore: i * 5,
          maxScore: i === 19 ? 100 : i * 5 + 4,
          remark: `R${i}`.padEnd(80, "r"),
          orderIndex: i,
        })),
      });
      const scheme = await db.gradingScheme.findFirstOrThrow({ select: { id: true } });
      await db.gradingComponent.deleteMany({});
      await db.gradingComponent.createMany({
        data: Array.from({ length: 20 }, (_, i) => ({
          schoolId: big.id,
          schemeId: scheme.id,
          key: `k${i}`,
          label: `L${i}`.padEnd(80, "l"),
          weight: 5,
          orderIndex: i,
        })),
      });
    });
    const sizes: Record<string, number> = {};
    for (const t of SETTINGS_TOOLS) {
      for (const input of t.conformanceCalls) {
        const res = await registry.execute(big.people.owner!, call(t.name, input));
        expect(res.isError, t.name).toBeUndefined();
        expect(res.content, t.name).not.toContain("[truncated]");
        sizes[t.name] = Math.max(sizes[t.name] ?? 0, res.content.length);
      }
    }
    for (const [name, size] of Object.entries(sizes)) expect(size, name).toBeLessThan(TOOL_OUTPUT_MAX_CHARS / 2);
  }, 60_000);
});

describe("grading_explain_score (FD-5b)", () => {
  it("gives the grade the gradebook gives, for every whole score 0–100 (so every boundary edge)", async () => {
    const owner = a.people.owner!;
    const bands = DEFAULT_GRADE_BOUNDARIES.map((x) => ({ letter: x.letter, minScore: x.minScore, maxScore: x.maxScore }));
    const wrong: string[] = [];
    for (let score = 0; score <= 100; score++) {
      const res = JSON.parse((await registry.execute(owner, call("grading_explain_score", { score }))).content);
      if (res.grade !== resolveLetterGrade(score, bands)) wrong.push(`${score}: ${res.grade}`);
    }
    expect(wrong).toEqual([]);
  }, 60_000);

  it("explains the edges: 39 is F9 one mark short of E8, 40 is E8, 59 is C5, 60 is C4", async () => {
    const owner = a.people.owner!;
    const at = async (score: number) => JSON.parse((await registry.execute(owner, call("grading_explain_score", { score }))).content);
    expect(await at(39)).toEqual({
      score: 39,
      grade: "F9",
      band: { min: 0, max: 39, remark: "Fail" },
      nextUp: { grade: "E8", from: 40, marksNeeded: 1 },
      nextDown: null,
    });
    expect((await at(40)).grade).toBe("E8");
    expect((await at(40)).nextDown).toEqual({ grade: "F9", upTo: 39 });
    expect((await at(59)).grade).toBe("C5");
    expect((await at(60)).grade).toBe("C4");
    expect((await at(100)).nextUp).toBeNull();
  });

  it("refuses a score that is not a whole number from 0 to 100, without echoing it", async () => {
    for (const input of [{ score: -1 }, { score: 101 }, { score: 59.5 }, { score: "60" }, {}, { score: 60, studentId: "x" }]) {
      const res = await registry.execute(a.people.owner!, call("grading_explain_score", input));
      expect(res.content).toBe(TOOL_REFUSAL.INVALID_ARGS);
    }
  });

  it("says so when a school's bands leave a score uncovered", async () => {
    const gap = await makeSchool("Settings School Gap");
    await withTenant(gap.id, (db) => db.gradeBoundary.deleteMany({ where: { letter: "E8" } }));
    const res = JSON.parse((await registry.execute(gap.people.owner!, call("grading_explain_score", { score: 42 }))).content);
    expect(res).toMatchObject({ score: 42, grade: null, band: null, nextUp: { grade: "D7", from: 45, marksNeeded: 3 }, nextDown: { grade: "F9", upTo: 39 } });
  }, 60_000);
});
