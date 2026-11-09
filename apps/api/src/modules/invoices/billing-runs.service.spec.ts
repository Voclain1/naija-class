import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { basePrisma, withTenant } from "@school-kit/db";
import { AiGenerationService } from "../../common/ai/ai-generation.service.js";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service.js";
import { deleteSchoolRows } from "../platform-admin/school-deletion.js";
import { InvoiceGenerationService } from "./invoice-generation.service.js";
import { BillingRunsService } from "./billing-runs.service.js";

const schoolIds: string[] = [];
const features = new FeatureSwitchesService(new ConfigService({}));
const invoices = new InvoiceGenerationService();
const fakeTurn = vi.fn();
const ai = { runConversationTurn: fakeTurn } as unknown as AiGenerationService;
const service = new BillingRunsService(invoices, features, ai);

async function fixture() {
  const school = await basePrisma.school.create({ data: { name: "Billing fixture", slug: `billing-${randomUUID()}`, status: "ACTIVE", featureSwitches: { "assistant-billing": true } } });
  schoolIds.push(school.id);
  return withTenant(school.id, async (db) => {
    const user = await db.user.create({ data: { schoolId: school.id, firstName: "PrivateStaff", lastName: "Fixture" } });
    const role = await db.role.create({ data: { schoolId: school.id, key: "billing-test", name: "Billing test", permissions: ["invoice.read", "invoice.issue"] } });
    await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
    const year = await db.academicYear.create({ data: { schoolId: school.id, label: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") } });
    const term = await db.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "Second Term", sequence: 2, isCurrent: true, startDate: new Date("2027-01-01"), endDate: new Date("2027-04-30") } });
    const level = await db.classLevel.create({ data: { schoolId: school.id, name: "JSS 2", code: "jss2", orderIndex: 1, stage: "JSS" } });
    const arms: { id: string; name: string }[] = [];
    for (const suffix of ["A", "B"]) {
      const arm = await db.classArm.create({ data: { schoolId: school.id, classLevelId: level.id, name: `JSS 2 ${suffix}`, code: suffix } });
      arms.push(arm);
      const student = await db.student.create({ data: { schoolId: school.id, firstName: `PrivateStudent${suffix}`, lastName: "Confidential", admissionNumber: suffix, dateOfBirth: new Date("2012-05-02"), gender: "MALE" } });
      await db.enrollment.create({ data: { schoolId: school.id, academicYearId: year.id, termId: term.id, classArmId: arm.id, studentId: student.id, status: "ENROLLED" } });
    }
    const cat = await db.feeCategory.create({ data: { schoolId: school.id, name: "Tuition", createdBy: user.id } });
    const fee = await db.feeItem.create({ data: { schoolId: school.id, categoryId: cat.id, name: "Tuition", amount: 4_735_251, createdBy: user.id } });
    return { auth: { schoolId: school.id, userId: user.id, sessionId: "test" }, role, fee, arms,
      input: { termId: term.id, classArmIds: arms.map((a) => a.id) } };
  }, { timeoutMs: 30_000 });
}

describe("billing runs against PostgreSQL", () => {
  let fx: Awaited<ReturnType<typeof fixture>>;
  beforeEach(async () => { fakeTurn.mockReset(); fx = await fixture(); });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
      await deleteSchoolRows(tx, id);
    }, { timeout: 60_000 });
    await basePrisma.$disconnect();
  });
  const count = (id: string) => withTenant(id, (db) => db.invoice.count({ where: { schoolId: id } }));
  const prepare = () => service.prepare(fx.auth, fx.input, null);
  const approve = (r: Awaited<ReturnType<typeof prepare>>) => service.approve(fx.auth, r.id, r.previewHash, null);

  it("uses serializable isolation and disables automatic connection retries only for opted-out calls", async () => {
    const [isolation] = await withTenant(fx.auth.schoolId, (db) => db.$queryRaw<{ transaction_isolation: string }[]>`SHOW transaction_isolation`, { isolationLevel: "Serializable" });
    expect(isolation?.transaction_isolation).toBe("serializable");
    let attempts = 0;
    const lost = Object.assign(new Error("simulated lost connection"), { code: "ECONNRESET" });
    await expect(withTenant(fx.auth.schoolId, async () => { attempts += 1; throw lost; }, { retryConnectionErrors: false })).rejects.toBe(lost);
    expect(attempts).toBe(1);
    attempts = 0;
    expect(await withTenant(fx.auth.schoolId, async () => { attempts += 1; if (attempts === 1) throw lost; return "recovered"; })).toBe("recovered");
    expect(attempts).toBe(2);
  });

  it("prepares without issuing, commits matching totals, and repeats exactly once after a lost response", async () => {
    const run = await prepare();
    expect(await count(fx.auth.schoolId)).toBe(0);
    expect(run).toMatchObject({ status: "PENDING", createCount: 2, skipCount: 0, totalDueKobo: "9470502", blockers: [] });
    const done = await approve(run);
    expect(done.result).toMatchObject({ created: 2, skipped: 0, totalDueKobo: "9470502" });
    expect((await approve(run)).result).toEqual(done.result);
    expect(await count(fx.auth.schoolId)).toBe(2);
    const audits = await withTenant(fx.auth.schoolId, (db) => db.auditLog.findMany({ where: { schoolId: fx.auth.schoolId, action: "invoice.issue" } }));
    expect(audits).toHaveLength(2);
    expect(audits.every((a) => (a.metadata as { proposalId?: string }).proposalId === run.id)).toBe(true);
  });

  it("re-running normal generation skips existing term invoices, including cancelled ones", async () => {
    const run = await prepare(); const done = await approve(run);
    await invoices.cancel(fx.auth, done.result!.invoiceIds[0]!, { ipAddress: null });
    const repeated = await invoices.generateForArm(fx.auth, { termId: fx.input.termId, classArmId: fx.arms[0]!.id }, { ipAddress: null });
    expect(repeated).toMatchObject({ created: 0, skipped: 1 });
    expect((await prepare()).createCount).toBe(0);
  });

  it("concurrent approvals create one set of invoices", async () => {
    const run = await prepare();
    const outcomes = await Promise.allSettled([approve(run), approve(run)]);
    expect(outcomes.filter((o) => o.status === "fulfilled").length).toBeGreaterThanOrEqual(1);
    expect(await count(fx.auth.schoolId)).toBe(2);
    expect((await service.get(fx.auth, run.id)).status).toBe("COMPLETED");
  });

  it("a same-total fee rename invalidates the preview", async () => {
    const run = await prepare();
    await withTenant(fx.auth.schoolId, (db) => db.feeItem.update({ where: { id: fx.fee.id }, data: { name: "Changed wording" } }));
    await expect(approve(run)).rejects.toMatchObject({ code: "BILLING_PREVIEW_CHANGED" });
    expect(await count(fx.auth.schoolId)).toBe(0);
  });

  it("a roster change invalidates the preview", async () => {
    const run = await prepare();
    await withTenant(fx.auth.schoolId, (db) => db.enrollment.updateMany({ where: { schoolId: fx.auth.schoolId }, data: { status: "WITHDRAWN" } }));
    await expect(approve(run)).rejects.toMatchObject({ code: "BILLING_PREVIEW_CHANGED" });
    expect(await count(fx.auth.schoolId)).toBe(0);
  });

  it("permission removal after preview refuses execution", async () => {
    const run = await prepare();
    await withTenant(fx.auth.schoolId, (db) => db.role.update({ where: { id: fx.role.id }, data: { permissions: ["invoice.read"] } }));
    await expect(approve(run)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await count(fx.auth.schoolId)).toBe(0);
  });

  it("deactivation, suspension and feature removal each refuse an approved write", async () => {
    const run = await prepare();
    await withTenant(fx.auth.schoolId, (db) => db.user.update({ where: { id: fx.auth.userId }, data: { isActive: false } }));
    await expect(approve(run)).rejects.toMatchObject({ code: "USER_INACTIVE" });
    await withTenant(fx.auth.schoolId, (db) => db.user.update({ where: { id: fx.auth.userId }, data: { isActive: true } }));
    await basePrisma.school.update({ where: { id: fx.auth.schoolId }, data: { suspendedAt: new Date() } });
    await expect(approve(run)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await basePrisma.school.update({ where: { id: fx.auth.schoolId }, data: { suspendedAt: null, featureSwitches: {} } });
    await expect(approve(run)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await count(fx.auth.schoolId)).toBe(0);
  });

  it("expiry and a forged hash refuse before any invoice write", async () => {
    const run = await prepare();
    await expect(service.approve(fx.auth, run.id, "f".repeat(64), null)).rejects.toMatchObject({ code: "BILLING_PREVIEW_CHANGED" });
    await withTenant(fx.auth.schoolId, (db) => db.$executeRaw`UPDATE assistant_billing_runs SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE school_id = ${fx.auth.schoolId} AND id = ${run.id}`);
    await expect(approve(run)).rejects.toMatchObject({ code: "BILLING_EXPIRED" });
    expect(await count(fx.auth.schoolId)).toBe(0);
  });

  it("a later-arm failure rolls back earlier invoices, audits and the completion marker", async () => {
    const run = await prepare();
    const real = invoices.generateForArmInTransaction.bind(invoices);
    const logs = vi.spyOn(Logger.prototype, "error").mockImplementation(() => {});
    vi.spyOn(invoices, "generateForArmInTransaction").mockImplementationOnce(real).mockRejectedValueOnce(new Error("PrivateStudentA 4735251 simulated driver detail"));
    await expect(approve(run)).rejects.toThrow("The billing operation could not finish");
    expect(await count(fx.auth.schoolId)).toBe(0);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("PrivateStudentA");
    expect(JSON.stringify(logs.mock.calls)).not.toContain("4735251");
    expect((await service.get(fx.auth, run.id)).status).toBe("PENDING");
    expect(await withTenant(fx.auth.schoolId, (db) => db.auditLog.count({ where: { schoolId: fx.auth.schoolId, action: "invoice.issue" } }))).toBe(0);
    vi.restoreAllMocks();
    expect((await approve(run)).result?.created).toBe(2);
  });

  it("a crash after the last write and completion update rolls everything back together", async () => {
    const run = await prepare();
    vi.spyOn(service as unknown as { audit: (...args: unknown[]) => Promise<void> }, "audit")
      .mockRejectedValueOnce(new Error("crash just before commit"));
    await expect(approve(run)).rejects.toThrow("The billing operation could not finish");
    expect(await count(fx.auth.schoolId)).toBe(0);
    expect((await service.get(fx.auth, run.id)).status).toBe("PENDING");
    vi.restoreAllMocks();
    expect((await approve(run)).result?.created).toBe(2);
  });

  it("another school cannot read, approve or select this school's records, under RLS", async () => {
    const run = await prepare(); const other = await fixture();
    await expect(service.get(other.auth, run.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.approve(other.auth, run.id, run.previewHash, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.prepare(other.auth, fx.input, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const leaked = await withTenant(other.auth.schoolId, (db) => db.$queryRaw<{ id: string }[]>`SELECT id FROM assistant_billing_runs WHERE id = ${run.id}`);
    expect(leaked).toEqual([]);
  });

  it("missing fees block approval, and the model never overrides this rule", async () => {
    await withTenant(fx.auth.schoolId, (db) => db.feeItem.delete({ where: { id: fx.fee.id } }));
    const run = await prepare(); expect(run.blockers).toHaveLength(1);
    await expect(approve(run)).rejects.toMatchObject({ code: "BILLING_BLOCKED" });
    expect(await count(fx.auth.schoolId)).toBe(0);
  });

  it("the task loop sees counts only and cannot change scope or execute an invoice", async () => {
    fakeTurn.mockImplementation(async (params) => {
      expect(params.interactionLogId).toMatch(/^[a-f0-9-]{36}$/);
      expect(JSON.stringify(params.history)).not.toContain("JSS");
      expect(JSON.stringify(params.history)).not.toContain(fx.input.termId);
      const checked = await params.executeTool({ id: "one", name: "billing_check_scope", input: {} });
      expect(JSON.parse(checked.content)).toEqual({ classCount: 2, newInvoiceCount: 2, existingInvoiceCount: 0, classesMissingFees: 0 });
      expect(checked.content).not.toContain("4735251"); expect(checked.content).not.toContain("Private");
      const injected = await params.executeTool({ id: "bad", name: "billing_request_review", input: { schoolId: "other" } });
      expect(injected.isError).toBe(true);
      await params.executeTool({ id: "two", name: "billing_request_review", input: {} });
      return { outcome: "answered" };
    });
    const run = await service.request(fx.auth, { termId: fx.input.termId, request: "Prepare invoices for JSS 2" }, null);
    expect(run.createCount).toBe(2); expect(await count(fx.auth.schoolId)).toBe(0);
    const stored = await withTenant(fx.auth.schoolId, (db) => db.$queryRaw<{ payload: unknown }[]>`SELECT payload FROM assistant_billing_runs WHERE school_id = ${fx.auth.schoolId}`);
    expect(JSON.stringify(stored)).not.toContain("Prepare invoices for JSS 2");
    const metadata = await withTenant(fx.auth.schoolId, (db) => db.aIInteractionLog.findMany({ where: { schoolId: fx.auth.schoolId } }));
    expect(metadata).toHaveLength(1);
    expect(metadata[0]!.payload).toEqual({ feature: "billing-run-planning" });
  });

  it.each(["budget_exhausted", "step_limit", "refused"])("%s cannot create a proposal or invoice", async (outcome) => {
    fakeTurn.mockResolvedValue({ outcome });
    await expect(service.request(fx.auth, { termId: fx.input.termId, request: "Prepare invoices for JSS 2" }, null)).rejects.toMatchObject({ code: "BILLING_NOT_PREPARED" });
    expect(await service.list(fx.auth)).toEqual([]); expect(await count(fx.auth.schoolId)).toBe(0);
  });
});
