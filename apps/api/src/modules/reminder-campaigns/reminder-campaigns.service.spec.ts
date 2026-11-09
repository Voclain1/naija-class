import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import { basePrisma, withTenant } from "@school-kit/db";
import { sendRemindersSchema, type ReminderCampaignProposalDto } from "@school-kit/types";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../../common/auth/auth-context";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service";
import type { DeliveryChannel, NotificationRequest } from "../notifications/notification-dispatch.service";
import { deleteSchoolRows } from "../platform-admin/school-deletion";
import { ReminderCampaignRunnerService } from "./reminder-campaign-runner.service";
import { ReminderCampaignsService, SEND_LEASE_MS } from "./reminder-campaigns.service";
import { ReminderSendPort, type SendOutcome } from "./reminder-send.port";

// Real PostgreSQL, as app_user under RLS, with fake providers: no real family
// is ever contacted (docs/modules/reminder-campaigns.md).

class FakePort extends ReminderSendPort {
  channels = { email: true, sms: true, push: false };
  emailReady = true;
  smsReady = true;
  emails: { to: string; html: string; idempotencyKey: string }[] = [];
  texts: { to: string; text: string }[] = [];
  pushes: NotificationRequest[] = [];
  emailOutcome: () => SendOutcome = () => ({ status: "ACCEPTED", providerRef: `em_${this.emails.length}` });
  smsOutcome: () => SendOutcome = () => ({ status: "ACCEPTED", providerRef: `sm_${this.texts.length}` });
  pushAnswer: (req: NotificationRequest) => DeliveryChannel = (req) => (req.smsAvailable ? "SMS" : "NONE");
  emailConfigured() { return this.emailReady; }
  smsConfigured() { return this.smsReady; }
  async enabledChannels() { return { ...this.channels }; }
  async sendEmail(p: { to: string; html: string; idempotencyKey: string }) { this.emails.push(p); return this.emailOutcome(); }
  async sendSms(to: string, text: string) { this.texts.push({ to, text }); return this.smsOutcome(); }
  async pushOrSms(req: NotificationRequest) {
    const a = this.pushAnswer(req);
    if (a === "PUSH") this.pushes.push(req);
    return a;
  }
}

const DAY = () => new Date("2026-11-09T10:00:00.000Z"); // 11:00 Lagos
const NIGHT = () => new Date("2026-11-09T21:30:00.000Z"); // 22:30 Lagos
const schoolIds: string[] = [];
const features = new FeatureSwitchesService(new ConfigService({}));
let port: FakePort;
let service: ReminderCampaignsService;

async function makeSchool(name: string) {
  const school = await basePrisma.school.create({
    data: { name, slug: `rc-${randomUUID()}`, status: "ACTIVE", featureSwitches: { "reminder-campaigns": true } },
  });
  schoolIds.push(school.id);
  return withTenant(school.id, async (db) => {
    const mkUser = async (key: string, permissions: string[]) => {
      const user = await db.user.create({ data: { schoolId: school.id, firstName: "Staff", lastName: key } });
      const role = await db.role.upsert({
        where: { schoolId_key: { schoolId: school.id, key } },
        create: { schoolId: school.id, key, name: key, permissions },
        update: {},
      });
      await db.userRole.create({ data: { userId: user.id, roleId: role.id } });
      return { auth: { schoolId: school.id, userId: user.id, sessionId: "t" } as AuthContext, roleId: role.id };
    };
    const bursar = await mkUser("bursar", ["finance.debtors.read", "finance.debtors.remind"]);
    const other = await mkUser("clerk", []);
    const year = await db.academicYear.create({ data: { schoolId: school.id, label: "2026/2027", startDate: new Date("2026-09-01"), endDate: new Date("2027-07-31") } });
    const term = await db.term.create({ data: { schoolId: school.id, academicYearId: year.id, name: "First Term", sequence: 1, isCurrent: true, startDate: new Date("2026-09-01"), endDate: new Date("2026-12-15") } });
    const level = await db.classLevel.create({ data: { schoolId: school.id, name: "JSS 1", code: "jss1", orderIndex: 1, stage: "JSS" } });
    const arm = await db.classArm.create({ data: { schoolId: school.id, classLevelId: level.id, name: "JSS 1A", code: "a" } });
    await db.notificationPreference.create({ data: { schoolId: school.id, emailEnabled: true, smsEnabled: true, pushEnabled: false, updatedBy: bursar.auth.userId } });

    const invoice = (studentId: string, totalDue: number, extra: { sequence?: number; status?: "ISSUED" | "OVERDUE"; totalPaid?: number } = {}) =>
      db.invoice.create({
        data: {
          schoolId: school.id, studentId, termId: term.id, academicYearId: year.id, classArmId: arm.id, status: extra.status ?? "ISSUED",
          sequence: extra.sequence ?? 1, items: [], totalAmount: totalDue, totalDiscount: 0, totalDue, totalPaid: extra.totalPaid ?? 0,
          dueDate: new Date("2026-10-01"), issuedAt: new Date(), issuedBy: bursar.auth.userId,
        },
      });
    const student = async (first: string, n: string) => {
      const s = await db.student.create({ data: { schoolId: school.id, firstName: first, lastName: "Debtor", admissionNumber: n, dateOfBirth: new Date("2014-01-01"), gender: "FEMALE" } });
      await db.enrollment.create({ data: { schoolId: school.id, studentId: s.id, termId: term.id, academicYearId: year.id, classArmId: arm.id, status: "ENROLLED" } });
      return s;
    };
    const guardian = async (first: string, email: string | null, phone: string) =>
      db.guardian.create({ data: { schoolId: school.id, firstName: first, lastName: "Parent", relationship: "MOTHER", email, phone } });
    const link = (studentId: string, guardianId: string, isPrimary = false) =>
      db.studentGuardian.create({ data: { schoolId: school.id, studentId, guardianId, isPrimary } });

    // Ada: two invoices (term + supplementary), two guardians (both emails, one phone).
    const ada = await student("Ada", "A1");
    const adaInv = await invoice(ada.id, 50_000_00);
    await invoice(ada.id, 5_000_00, { sequence: 2, status: "OVERDUE" });
    const mum = await guardian("Mum", "mum@example.test", "08031234567");
    const dad = await guardian("Dad", "dad@example.test", "08039999999");
    await link(ada.id, mum.id, true);
    await link(ada.id, dad.id);
    // Bo: Ada's sibling, shares Mum.
    const bo = await student("Bo", "A2");
    const boInv = await invoice(bo.id, 20_000_00);
    await link(bo.id, mum.id, true);
    // Paid: nothing owed.
    const paid = await student("Paid", "A3");
    await invoice(paid.id, 10_000_00, { totalPaid: 10_000_00 });
    await link(paid.id, mum.id);
    // Plan: on a payment plan.
    const plan = await student("Plan", "A4");
    const planInv = await invoice(plan.id, 10_000_00);
    await db.paymentPlan.create({ data: { schoolId: school.id, invoiceId: planInv.id, name: "Two parts", createdBy: bursar.auth.userId } });
    await link(plan.id, mum.id);
    // Orphan: owes, no guardian.
    const orphan = await student("Orphan", "A5");
    await invoice(orphan.id, 10_000_00);

    return { schoolId: school.id, bursar, other, termId: term.id, ada, adaInv, bo, boInv, paid, plan, orphan, mum, dad };
  }, { timeoutMs: 30_000 });
}

describe("fee reminder campaigns against PostgreSQL", () => {
  let A: Awaited<ReturnType<typeof makeSchool>>;
  let B: Awaited<ReturnType<typeof makeSchool>>;

  beforeEach(async () => {
    port = new FakePort();
    service = new ReminderCampaignsService(features, port);
    service.autoRun = false;
    A = await makeSchool("Reminders A");
    B = await makeSchool("Reminders B");
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    for (const id of schoolIds) {
      await basePrisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${id}, true)`;
        await deleteSchoolRows(tx, id);
      }, { timeout: 60_000 });
    }
    await basePrisma.$disconnect();
  });

  const prepare = (ids: string[], opts: { includePaymentPlans?: boolean; overdueOnly?: boolean } = {}, who = A.bursar.auth, termId = A.termId) =>
    service.prepare(who, { clientRequestId: randomUUID(), termId, studentIds: ids, options: { includePaymentPlans: false, overdueOnly: false, ...opts } }, null);
  const confirm = (p: ReminderCampaignProposalDto, who = A.bursar.auth) => service.confirm(who, p.id, p.previewHash, null);
  const run = (id: string, now = DAY) => service.processCampaign(A.schoolId, id, { now });
  const all = () => [A.ada.id, A.bo.id, A.paid.id, A.plan.id, A.orphan.id];
  const sendsOf = (id: string) => withTenant(A.schoolId, (db) => db.reminderCampaignSend.findMany({ where: { campaignId: id }, orderBy: [{ studentId: "asc" }, { channel: "asc" }] }));

  // ---------------------------------------------------------------------
  it("previews per student with server figures and exclusions, and sends nothing", async () => {
    const p = await prepare([...all(), B.ada.id]);
    expect(p.canConfirm).toBe(true);
    const by = Object.fromEntries(p.students.map((s) => [s.studentId, s]));
    // Term + supplementary invoices: one student, one balance.
    expect(by[A.ada.id]).toMatchObject({ name: "Ada Debtor", balance: 55_000_00, invoiceCount: 2, overdue: true, eligibility: "ELIGIBLE", classLabel: "JSS 1 · JSS 1A", planned: { emailGuardians: 2, mobile: "SMS_ONLY" } });
    expect(by[A.bo.id]!.eligibility).toBe("ELIGIBLE");
    expect(by[A.paid.id]!.eligibility).toBe("NO_BALANCE");
    expect(by[A.plan.id]!.eligibility).toBe("ON_PAYMENT_PLAN");
    expect(by[A.orphan.id]!.eligibility).toBe("NO_GUARDIAN");
    expect(by[B.ada.id]).toMatchObject({ eligibility: "NOT_FOUND", name: null, balance: 0 });
    expect(p.counts).toMatchObject({ selected: 6, eligible: 2, plannedSends: 5, excluded: { NO_BALANCE: 1, ON_PAYMENT_PLAN: 1, NO_GUARDIAN: 1, NOT_FOUND: 1 } });
    expect(p.batchWarnings.map((w) => w.code)).toContain("SHARED_GUARDIANS");
    expect(p.batchWarnings.map((w) => w.code)).toContain("SMS_SENDER_SCHOOLKIT");
    expect(port.emails.length + port.texts.length).toBe(0);
    // Options: include plans; overdue only keeps Ada (has an OVERDUE invoice) and drops Bo.
    const withPlans = await prepare(all(), { includePaymentPlans: true });
    expect(withPlans.students.find((s) => s.studentId === A.plan.id)!.eligibility).toBe("ELIGIBLE");
    const overdue = await prepare(all(), { overdueOnly: true });
    expect(overdue.students.find((s) => s.studentId === A.bo.id)!.eligibility).toBe("NOT_OVERDUE");
  });

  it("confirms once into a journal, sends each planned slot once, and reports per-send outcomes", async () => {
    const p = await prepare(all());
    const c = await confirm(p);
    expect(c).toMatchObject({ status: "RUNNING", counts: { PENDING: 5 } });
    expect((await confirm(p)).id).toBe(c.id); // a repeat is the same campaign
    expect(await service.getProposal(A.bursar.auth, p.id)).toMatchObject({ status: "CONFIRMED", campaignId: c.id, students: [], dataCleared: true });

    expect(await run(c.id)).toBe("DONE");
    expect(port.emails.map((e) => e.to).sort()).toEqual(["dad@example.test", "mum@example.test", "mum@example.test"]);
    expect(port.texts).toHaveLength(2);
    expect(port.emails[0]!.idempotencyKey).toMatch(/^reminder-send\//);
    const done = await service.getCampaign(A.bursar.auth, c.id, DAY());
    expect(done).toMatchObject({ status: "COMPLETED", counts: { ACCEPTED: 5, PENDING: 0 } });
    expect(done.students.find((s) => s.studentId === A.ada.id)!.sends.map((s) => [s.slot, s.channelUsed, s.outcome])).toEqual([
      ["EMAIL", "EMAIL", "ACCEPTED"], ["EMAIL", "EMAIL", "ACCEPTED"], ["MOBILE", "SMS", "ACCEPTED"],
    ]);
    // Running again sends nothing more.
    expect(await run(c.id)).toBe("DONE");
    expect(port.emails.length + port.texts.length).toBe(5);
    // The journal and audits hold ids and states, never contacts, names or amounts.
    const stored = await withTenant(A.schoolId, async (db) => ({
      sends: await db.reminderCampaignSend.findMany({ where: { campaignId: c.id } }),
      audits: await db.auditLog.findMany({ where: { schoolId: A.schoolId, entityType: "reminder_campaign" } }),
      ai: await db.aIInteractionLog.count({ where: { schoolId: A.schoolId } }),
    }));
    expect(JSON.stringify(stored)).not.toMatch(/@example|0803|Ada|Debtor|55000|5500000/);
    expect(stored.audits.map((a) => a.action).sort()).toEqual(["reminder-campaign.complete", "reminder-campaign.confirm", "reminder-campaign.prepare"]);
    expect(stored.ai).toBe(0);
  });

  it("is tenant- and requester-bound", async () => {
    const p = await prepare(all());
    await expect(service.getProposal(B.bursar.auth, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.getProposal(A.other.auth, p.id)).rejects.toMatchObject({ code: "FORBIDDEN" }); // no finance grants
    await withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.other.roleId }, data: { permissions: ["finance.debtors.read", "finance.debtors.remind"] } }));
    await expect(service.getProposal(A.other.auth, p.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(confirm(p, A.other.auth)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const c = await confirm(p);
    await expect(service.getCampaign(B.bursar.auth, c.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(service.halt(A.other.auth, c.id, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses confirmation after permission removal, deactivation, suspension or the switch going off", async () => {
    const p = await prepare(all());
    await withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.bursar.roleId }, data: { permissions: ["finance.debtors.read"] } }));
    await expect(confirm(p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.bursar.roleId }, data: { permissions: ["finance.debtors.read", "finance.debtors.remind"] } }));
    await withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.bursar.auth.userId }, data: { isActive: false } }));
    await expect(confirm(p)).rejects.toMatchObject({ code: "USER_INACTIVE" });
    await withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.bursar.auth.userId }, data: { isActive: true } }));
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { suspendedAt: new Date() } });
    await expect(confirm(p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { suspendedAt: null, featureSwitches: {} } });
    await expect(confirm(p)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await withTenant(A.schoolId, (db) => db.reminderCampaign.count({ where: { schoolId: A.schoolId } }))).toBe(0);
  });

  it("halts a running campaign when the confirmer loses access or is deactivated, or the school is suspended", async () => {
    for (const change of ["perm", "inactive", "suspend"] as const) {
      const c = await confirm(await prepare(all()));
      if (change === "perm") await withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.bursar.roleId }, data: { permissions: ["finance.debtors.read"] } }));
      if (change === "inactive") await withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.bursar.auth.userId }, data: { isActive: false } }));
      if (change === "suspend") await basePrisma.school.update({ where: { id: A.schoolId }, data: { suspendedAt: new Date() } });
      expect(await run(c.id)).toBe("HALTED");
      const [row] = await withTenant(A.schoolId, (db) => db.reminderCampaign.findMany({ where: { id: c.id } }));
      expect(row!.haltReason).toBe(change === "suspend" ? "SCHOOL_UNAVAILABLE" : "CONFIRMER_ACCESS_REVOKED");
      expect(port.emails.length + port.texts.length).toBe(0);
      // Restore for the next round.
      await withTenant(A.schoolId, (db) => db.role.update({ where: { id: A.bursar.roleId }, data: { permissions: ["finance.debtors.read", "finance.debtors.remind"] } }));
      await withTenant(A.schoolId, (db) => db.user.update({ where: { id: A.bursar.auth.userId }, data: { isActive: true } }));
      await basePrisma.school.update({ where: { id: A.schoolId }, data: { suspendedAt: null } });
    }
  });

  it("refuses a stale review: a payment recorded after preparing changes the fingerprint", async () => {
    const p = await prepare(all());
    await withTenant(A.schoolId, (db) => db.invoice.update({ where: { id: A.boInv.id }, data: { totalPaid: 1_000_00, status: "PARTIALLY_PAID" } }));
    await expect(confirm(p)).rejects.toMatchObject({ code: "REMINDER_PREVIEW_STALE" });
    const fresh = await service.refresh(A.bursar.auth, p.id, randomUUID(), null);
    expect(fresh.students.find((s) => s.studentId === A.bo.id)!.balance).toBe(19_000_00);
    await expect(confirm(p)).rejects.toMatchObject({ code: "REMINDER_PREVIEW_EXPIRED" });
    await expect(service.confirm(A.bursar.auth, fresh.id, "0".repeat(64), null)).rejects.toMatchObject({ code: "REMINDER_PREVIEW_MISMATCH" });
    expect((await confirm(fresh)).status).toBe("RUNNING");
  });

  it("rechecks debt before sending: a balance paid or a plan added mid-run is skipped, with the current amount used otherwise", async () => {
    const c = await confirm(await prepare(all()));
    await withTenant(A.schoolId, async (db) => {
      await db.invoice.update({ where: { id: A.boInv.id }, data: { totalPaid: 20_000_00, status: "PAID" } });
      await db.invoice.update({ where: { id: A.adaInv.id }, data: { totalPaid: 10_000_00, status: "PARTIALLY_PAID" } });
    });
    await run(c.id);
    const dto = await service.getCampaign(A.bursar.auth, c.id, DAY());
    expect(dto.students.find((s) => s.studentId === A.bo.id)!.sends.map((s) => [s.outcome, s.reason])).toEqual([["SKIPPED", "NO_BALANCE"], ["SKIPPED", "NO_BALANCE"]]);
    // Ada's message quotes the balance as it is now (₦45,000), not as reviewed.
    expect(port.texts.map((t) => t.text).join()).toContain("45,000");
    const c2 = await confirm(await prepare([A.ada.id]));
    await withTenant(A.schoolId, (db) => db.paymentPlan.create({ data: { schoolId: A.schoolId, invoiceId: A.adaInv.id, name: "Late plan", createdBy: A.bursar.auth.userId } }));
    await run(c2.id);
    const dto2 = await service.getCampaign(A.bursar.auth, c2.id, DAY());
    expect(dto2.counts).toMatchObject({ SKIPPED: 3, ACCEPTED: 0 });
    expect(dto2.students[0]!.sends.every((s) => s.reason === "ON_PAYMENT_PLAN")).toBe(true);
  });

  it("two confirmations at once make one campaign; two workers at once send each slot once", async () => {
    const p = await prepare(all());
    const [x, y] = await Promise.all([confirm(p), confirm(p)]);
    expect(x.id).toBe(y.id);
    expect(await withTenant(A.schoolId, (db) => db.reminderCampaign.count({ where: { schoolId: A.schoolId } }))).toBe(1);
    await Promise.all([
      service.processCampaign(A.schoolId, x.id, { now: DAY, batchStudents: 1 }),
      service.processCampaign(A.schoolId, x.id, { now: DAY, batchStudents: 1 }),
      service.processCampaign(A.schoolId, x.id, { now: DAY, batchStudents: 1 }),
    ]);
    await run(x.id);
    expect(port.emails).toHaveLength(3);
    expect(port.texts).toHaveLength(2);
    expect((await service.getCampaign(A.bursar.auth, x.id, DAY())).counts.ACCEPTED).toBe(5);
  });

  it("a crash after sending but before recording leaves the send UNKNOWN after the lease, and it is never sent again", async () => {
    const c = await confirm(await prepare([A.bo.id]));
    const err = vi.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
    const finish = vi.spyOn(ReminderCampaignsService.prototype as unknown as { finish: () => Promise<void> }, "finish");
    finish.mockRejectedValueOnce(new Error("process killed"));
    await expect(run(c.id)).rejects.toThrow("process killed");
    finish.mockRestore();
    err.mockRestore();
    // Bo's two slots were claimed together; the process died after the first
    // provider call. Both claims stand (one sent, one not: the journal cannot
    // tell which), so both will be UNKNOWN: conservative, never repeated.
    expect(port.emails.length + port.texts.length).toBe(1);
    // Within the lease the claims stand: nothing is re-sent; the campaign waits.
    expect(await run(c.id)).toBe("BUSY");
    expect((await sendsOf(c.id)).map((s) => s.status)).toEqual(["SENDING", "SENDING"]);
    // After the lease: UNKNOWN, never retried, and the campaign can finish.
    const later = () => new Date(DAY().getTime() + SEND_LEASE_MS + 60_000);
    expect(await run(c.id, later)).toBe("DONE");
    expect((await sendsOf(c.id)).map((s) => [s.status, s.reason])).toEqual([["UNKNOWN", "INTERRUPTED"], ["UNKNOWN", "INTERRUPTED"]]);
    await run(c.id, later);
    expect(port.emails.length + port.texts.length).toBe(1);
    expect((await service.getCampaign(A.bursar.auth, c.id, DAY())).status).toBe("COMPLETED");
  });

  it("a crash before claiming loses nothing: the next run sends each slot once", async () => {
    const c = await confirm(await prepare([A.ada.id]));
    const claim = vi.spyOn(ReminderCampaignsService.prototype as unknown as { claimBatch: () => Promise<never> }, "claimBatch");
    claim.mockRejectedValueOnce(new Error("process killed"));
    await expect(run(c.id)).rejects.toThrow("process killed");
    claim.mockRestore();
    expect(port.emails.length + port.texts.length).toBe(0);
    expect(await run(c.id)).toBe("DONE");
    expect(port.emails).toHaveLength(2);
    expect(port.texts).toHaveLength(1);
  });

  it("a lost provider answer is UNKNOWN and is not retried even on explicit resume; a refusal is FAILED", async () => {
    port.emailOutcome = () => ({ status: "UNKNOWN", reason: "PROVIDER_NO_ANSWER" });
    port.smsOutcome = () => ({ status: "REJECTED", reason: "PROVIDER_REFUSED" });
    const c = await confirm(await prepare([A.ada.id]));
    await run(c.id);
    const dto = await service.getCampaign(A.bursar.auth, c.id, DAY());
    expect(dto.counts).toMatchObject({ UNKNOWN: 2, FAILED: 1 });
    expect(dto.status).toBe("COMPLETED");
    await expect(service.resume(A.bursar.auth, c.id, null)).rejects.toMatchObject({ code: "REMINDER_CAMPAIGN_NOT_HALTED" });
    await run(c.id);
    expect(port.emails).toHaveLength(2);
    expect(port.texts).toHaveLength(1);
  });

  it("honours channel changes, push-before-SMS, and halts when no channel is left", async () => {
    const c = await confirm(await prepare([A.ada.id, A.bo.id]));
    port.channels = { email: false, sms: true, push: true };
    port.pushAnswer = (req) => (req.guardianId === A.mum.id ? "PUSH" : "SMS");
    await run(c.id);
    const dto = await service.getCampaign(A.bursar.auth, c.id, DAY());
    for (const s of dto.students) {
      for (const send of s.sends) {
        if (send.slot === "EMAIL") expect([send.outcome, send.reason]).toEqual(["SKIPPED", "CHANNEL_OFF"]);
        else expect([send.channelUsed, send.outcome, send.reason]).toEqual(["PUSH", "ACCEPTED", "QUEUED_FOR_APP"]);
      }
    }
    expect(port.pushes).toHaveLength(2);
    expect(port.texts).toHaveLength(0);
    port.channels = { email: true, sms: true, push: false };
    const c2 = await confirm(await prepare([A.bo.id]));
    port.channels = { email: false, sms: false, push: false };
    expect(await run(c2.id)).toBe("HALTED");
    expect((await service.getCampaign(A.bursar.auth, c2.id, DAY())).haltReason).toBe("NO_CHANNEL");
  });

  it("holds sends during quiet hours and sends them after 06:00", async () => {
    const c = await confirm(await prepare([A.bo.id]));
    expect(await run(c.id, NIGHT)).toBe("HELD");
    expect(port.emails.length + port.texts.length).toBe(0);
    expect((await service.getCampaign(A.bursar.auth, c.id, NIGHT())).heldForQuietHours).toBe(true);
    expect(await run(c.id, DAY)).toBe("DONE");
    expect(port.emails.length + port.texts.length).toBe(2);
  });

  it("the switch is a kill switch: outcomes stay, nothing new is sent, and resuming needs it back on", async () => {
    const c = await confirm(await prepare(all()));
    await service.processCampaign(A.schoolId, c.id, { now: DAY, batchStudents: 1, maxBatches: 1 });
    const sent = port.emails.length + port.texts.length;
    expect(sent).toBeGreaterThan(0);
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { featureSwitches: {} } });
    expect(await run(c.id)).toBe("HALTED");
    expect(port.emails.length + port.texts.length).toBe(sent);
    const halted = await service.getCampaign(A.bursar.auth, c.id, DAY());
    expect(halted).toMatchObject({ status: "HALTED", haltReason: "FEATURE_OFF" });
    expect(halted.counts.ACCEPTED).toBe(sent);
    expect(halted.counts.NOT_REQUESTED).toBe(5 - sent);
    await expect(service.resume(A.bursar.auth, c.id, null)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await run(c.id)).toBe("HALTED"); // a halted campaign never restarts by itself
    await basePrisma.school.update({ where: { id: A.schoolId }, data: { featureSwitches: { "reminder-campaigns": true } } });
    expect((await service.resume(A.bursar.auth, c.id, null)).status).toBe("RUNNING");
    await run(c.id);
    expect(port.emails.length + port.texts.length).toBe(5);
  });

  it("the requester can halt; resuming sends only what was never attempted", async () => {
    const c = await confirm(await prepare(all()));
    await service.processCampaign(A.schoolId, c.id, { now: DAY, batchStudents: 1, maxBatches: 1 });
    const first = port.emails.length + port.texts.length;
    const halted = await service.halt(A.bursar.auth, c.id, null);
    expect(halted).toMatchObject({ status: "HALTED", haltReason: "HALTED_BY_REQUESTER" });
    expect((await service.halt(A.bursar.auth, c.id, null)).status).toBe("HALTED"); // idempotent
    expect(await run(c.id)).toBe("HALTED");
    expect(port.emails.length + port.texts.length).toBe(first);
    await service.resume(A.bursar.auth, c.id, null);
    await run(c.id);
    expect(port.emails.length + port.texts.length).toBe(5);
    const audits = await withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { schoolId: A.schoolId, entityId: c.id } }));
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["reminder-campaign.halt", "reminder-campaign.resume"]));
  });

  it("prepare is idempotent on clientRequestId; the scheduled runner continues running campaigns", async () => {
    const clientRequestId = randomUUID();
    const body = { clientRequestId, termId: A.termId, studentIds: all(), options: { includePaymentPlans: false, overdueOnly: false } };
    const [a, b] = await Promise.all([service.prepare(A.bursar.auth, body, null), service.prepare(A.bursar.auth, body, null)]);
    expect(a.id).toBe(b.id);
    await expect(service.prepare(A.bursar.auth, { ...body, studentIds: [A.ada.id] }, null)).rejects.toMatchObject({ code: "REMINDER_REQUEST_ID_REUSED" });
    const c = await confirm(a);
    const runner = new ReminderCampaignRunnerService(service);
    expect(await runner.runOnce({ now: DAY })).toBeGreaterThanOrEqual(1);
    expect((await service.getCampaign(A.bursar.auth, c.id, DAY())).status).toBe("COMPLETED");
  });

  it("leaves POST /finance/debtors/remind's contract and the AI boundary unchanged", () => {
    expect(sendRemindersSchema.safeParse({ termId: randomUUID(), studentIds: Array.from({ length: 51 }, () => randomUUID()) }).success).toBe(false);
    expect(sendRemindersSchema.safeParse({ termId: randomUUID(), studentIds: [randomUUID()] }).success).toBe(true);
    for (const f of ["reminder-campaigns.service.ts", "reminder-campaign-preview.ts", "reminder-campaigns.module.ts", "reminder-send.port.ts"]) {
      const imports = readFileSync(join(__dirname, f), "utf8").split("\n").filter((l) => /from "/.test(l)).join("\n");
      expect(imports).not.toMatch(/@school-kit\/ai|AiGenerationService|common\/ai/);
    }
  });
});
