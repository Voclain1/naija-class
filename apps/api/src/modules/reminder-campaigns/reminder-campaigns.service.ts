import { randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";
import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  BaseError,
  ConflictError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  PERMISSION_WILDCARD,
  REMINDER_CAMPAIGN_CONFLICT_CODES as C,
  REMINDER_CAMPAIGN_KIND,
  REMINDER_CAMPAIGN_LIMITS,
  REMINDER_CAMPAIGN_TTL_MINUTES,
  REMINDER_TEMPLATE_VERSION,
  UnauthorizedError,
  type PrepareReminderCampaignInput,
  type ReminderCampaignDto,
  type ReminderCampaignProposalDto,
  type ReminderCampaignSendDto,
  type ReminderCampaignStudentPreview,
  type ReminderHaltReason,
  type ReminderSendOutcome,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { FeatureSwitchesService } from "../../common/features/feature-switches.service";
import { smsSenderFor } from "../../common/termii/sms-sender";
import { normalizeNigerianPhone } from "../../common/termii/termii.service";
import { fingerprint } from "../../common/workflow/fingerprint";
import { expireWorkflowProposals } from "../../common/workflow/workflow-proposals";
import { blockedAddresses } from "../announcements/announcement-email.shared";
import { buildReminderHtml, buildReminderSms } from "../finance/finance.service";
import { isQuietHour } from "../notifications/quiet-hours";
import {
  attemptableChannels,
  computeReminderPreview,
  debtEligibility,
  loadDebtFacts,
  type PlannedSlots,
  type ReminderInput,
  type ReminderPreview,
} from "./reminder-campaign-preview";
import { ReminderSendPort, type SendOutcome } from "./reminder-send.port";

// Durable fee reminder campaigns (docs/modules/reminder-campaigns.md).
//
// prepare -> review -> confirm -> a journal of planned sends -> a worker that
// claims, sends and records each one. External sends cannot share a database
// transaction, so the guarantee is per send, not per campaign:
//   - a send is claimed (SENDING) and committed BEFORE the provider is called;
//   - its outcome is committed after the provider answers;
//   - a claim left SENDING (the process died, the response was lost) becomes
//     UNKNOWN after the lease, and UNKNOWN is never retried automatically.
// So nothing is sent twice by this system, and a send that may have gone out
// is reported as such rather than repeated. Exactly-once delivery is not
// claimed: providers' own idempotency is not relied on (not verified).
//
// No model call, no AI log. Logs carry ids and counts only: never a name, a
// contact detail, an amount or message text.

type Db = PrismaClient;

interface Payload {
  input: ReminderInput;
  students: ReminderCampaignStudentPreview[];
  plan: PlannedSlots[];
}

interface ProposalRow {
  id: string;
  status: "PENDING" | "COMPLETED" | "EXPIRED";
  requested_by: string;
  request_hash: string;
  preview_hash: string;
  payload: Payload | null;
  summary: ReminderPreview["summary"];
  result: { campaignId: string } | null;
  expires_at: Date;
  created_at: Date;
}

interface CampaignRow {
  id: string;
  school_id: string;
  proposal_id: string;
  term_id: string;
  requested_by: string;
  confirmed_by: string;
  status: "RUNNING" | "HALTED" | "COMPLETED";
  halt_reason: ReminderHaltReason | null;
  template_version: string;
  include_payment_plans: boolean;
  overdue_only: boolean;
  created_at: Date;
  halted_at: Date | null;
  completed_at: Date | null;
}

interface SendRow {
  id: string;
  student_id: string;
  guardian_id: string;
  channel: "EMAIL" | "MOBILE";
  channel_used: "EMAIL" | "PUSH" | "SMS" | null;
  status: "PENDING" | "SENDING" | "ACCEPTED" | "SKIPPED" | "FAILED" | "UNKNOWN";
  reason: string | null;
  claim_token: string | null;
  finished_at: Date | null;
}

/** A claimed send, with what is needed to send it, held only in memory. */
interface Job {
  id: string;
  claimToken: string;
  channel: "EMAIL" | "MOBILE";
  schoolId: string;
  guardianId: string;
  schoolName: string;
  smsSender: string | undefined;
  studentName: string;
  balance: number;
  dueDate: string | null;
  email?: { to: string; firstName: string | null };
  phone: string | null;
  smsAvailable: boolean;
}

export interface RunOptions {
  now?: () => Date;
  /** Students claimed per batch. */
  batchStudents?: number;
  /** Stop after this many batches (the cron runner bounds each tick). */
  maxBatches?: number;
}

/** How long a claim may stay SENDING before it is presumed lost: UNKNOWN. */
export const SEND_LEASE_MS = 10 * 60_000;
const FEATURE = "reminder-campaigns" as const;

@Injectable()
export class ReminderCampaignsService {
  private readonly logger = new Logger(ReminderCampaignsService.name);
  /** Start sending in-process after confirm/resume. Tests turn it off and drive the worker. */
  autoRun = true;

  constructor(
    private readonly features: FeatureSwitchesService,
    private readonly port: ReminderSendPort,
  ) {}

  async available(auth: AuthContext): Promise<{ enabled: boolean }> {
    return { enabled: await this.features.isOn(auth.schoolId, FEATURE) };
  }

  // ---------------------------------------------------------------------
  // Proposals
  // ---------------------------------------------------------------------

  async prepare(auth: AuthContext, input: PrepareReminderCampaignInput, ip: string | null): Promise<ReminderCampaignProposalDto> {
    const stored: ReminderInput = { termId: input.termId, studentIds: input.studentIds, options: input.options };
    const requestHash = fingerprint(stored);
    try {
      return await withTenant(auth.schoolId, async (db) => {
        await this.requireAccess(db, auth.schoolId, auth.userId, { feature: true });
        await expireWorkflowProposals(db, auth.schoolId, new Date(), REMINDER_CAMPAIGN_KIND);
        const existing = await this.findByClientRequest(db, auth, input.clientRequestId);
        if (existing) return this.proposalDtoFor(existing, requestHash);
        return this.insertProposal(db, auth, input.clientRequestId, requestHash, stored, ip);
      }, { timeoutMs: 30_000, label: "reminder-campaign-prepare" });
    } catch (e) {
      this.failSafely(auth.schoolId, "prepare", e);
    }
  }

  async getProposal(auth: AuthContext, id: string): Promise<ReminderCampaignProposalDto> {
    try {
      return await withTenant(auth.schoolId, async (db) => {
        await this.requireAccess(db, auth.schoolId, auth.userId, { feature: false });
        await expireWorkflowProposals(db, auth.schoolId, new Date(), REMINDER_CAMPAIGN_KIND);
        return this.proposalDto(await this.loadProposal(db, auth, id, false));
      }, { label: "reminder-campaign-proposal" });
    } catch (e) {
      this.failSafely(auth.schoolId, "read", e);
    }
  }

  async refresh(auth: AuthContext, id: string, clientRequestId: string, ip: string | null): Promise<ReminderCampaignProposalDto> {
    try {
      return await withTenant(auth.schoolId, async (db) => {
        await this.requireAccess(db, auth.schoolId, auth.userId, { feature: true });
        const old = await this.loadProposal(db, auth, id, true);
        const already = await this.findByClientRequest(db, auth, clientRequestId);
        if (already) return this.proposalDto(already);
        if (old.status === "COMPLETED") throw new ConflictError(C.alreadyConfirmed, "This selection was already confirmed. Open its campaign instead.");
        if (!old.payload) throw new ConflictError(C.expired, "This review expired and its rows were cleared. Prepare it again from your selection.");
        await db.$executeRaw`
          UPDATE workflow_proposals SET status = 'EXPIRED', payload = NULL, data_cleared_at = CURRENT_TIMESTAMP
           WHERE school_id = ${auth.schoolId} AND id = ${old.id} AND status = 'PENDING'`;
        return this.insertProposal(db, auth, clientRequestId, old.request_hash, old.payload.input, ip, old.id);
      }, { timeoutMs: 30_000, label: "reminder-campaign-refresh" });
    } catch (e) {
      this.failSafely(auth.schoolId, "refresh", e);
    }
  }

  /**
   * One transaction: re-check access, lock the proposal, recompute the
   * preview, create the campaign and its planned sends, mark the proposal
   * COMPLETED. A repeat returns the same campaign. Sending starts after commit.
   */
  async confirm(auth: AuthContext, id: string, previewHash: string, ip: string | null): Promise<ReminderCampaignDto> {
    let campaignId: string;
    let created = false;
    try {
      campaignId = await withTenant(auth.schoolId, async (db) => {
        await this.requireAccess(db, auth.schoolId, auth.userId, { feature: true, lock: true });
        const proposal = await this.loadProposal(db, auth, id, true);
        if (proposal.preview_hash !== previewHash) {
          throw new ConflictError(C.previewMismatch, "This is not the review you saw. Open it again.");
        }
        if (proposal.status === "COMPLETED") return proposal.result!.campaignId;
        if (proposal.status === "EXPIRED" || proposal.expires_at.getTime() <= Date.now() || !proposal.payload) {
          throw new ConflictError(C.expired, "This review expired. Refresh it, check it again, then confirm.");
        }
        const fresh = await computeReminderPreview(db, this.port, auth.schoolId, proposal.payload.input);
        if (fresh.previewHash !== proposal.preview_hash) {
          throw new ConflictError(C.stale, "Balances, plans, contacts or settings changed since you reviewed. Refresh and review again. Nothing was sent.");
        }
        if (!fresh.canConfirm) throw new ConflictError(C.blocked, "This review has problems to fix first. Nothing was sent.");
        const cid = randomUUID();
        const { input } = proposal.payload;
        await db.$executeRaw`
          INSERT INTO reminder_campaigns
            (id, school_id, proposal_id, term_id, requested_by, confirmed_by, template_version, include_payment_plans, overdue_only)
          VALUES (${cid}, ${auth.schoolId}, ${proposal.id}, ${input.termId}, ${proposal.requested_by}, ${auth.userId},
                  ${REMINDER_TEMPLATE_VERSION}, ${input.options.includePaymentPlans}, ${input.options.overdueOnly})`;
        await db.reminderCampaignSend.createMany({
          data: fresh.plan.flatMap((p) => [
            ...p.emailGuardianIds.map((g) => ({ schoolId: auth.schoolId, campaignId: cid, studentId: p.studentId, guardianId: g, channel: "EMAIL" })),
            ...(p.mobileGuardianId ? [{ schoolId: auth.schoolId, campaignId: cid, studentId: p.studentId, guardianId: p.mobileGuardianId, channel: "MOBILE" }] : []),
          ]),
        });
        await db.$executeRaw`
          UPDATE workflow_proposals
             SET status = 'COMPLETED', confirmed_by = ${auth.userId}, confirmed_at = CURRENT_TIMESTAMP,
                 result = ${JSON.stringify({ campaignId: cid })}::jsonb, payload = NULL, data_cleared_at = CURRENT_TIMESTAMP
           WHERE school_id = ${auth.schoolId} AND id = ${proposal.id} AND status = 'PENDING'`;
        await this.audit(db, auth.schoolId, auth.userId, cid, "reminder-campaign.confirm", ip, {
          proposalId: proposal.id, students: fresh.plan.length, plannedSends: fresh.summary.counts.plannedSends,
        });
        created = true;
        return cid;
      }, { timeoutMs: 60_000, retryConnectionErrors: false, label: "reminder-campaign-confirm" });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "P2002" || code === "P2034") {
        throw new ConflictError(C.stale, "Another confirmation ran at the same time. Open the review to see its campaign.");
      }
      this.failSafely(auth.schoolId, "confirm", e);
    }
    if (created) this.kick(auth.schoolId, campaignId);
    return this.getCampaign(auth, campaignId);
  }

  // ---------------------------------------------------------------------
  // Campaigns
  // ---------------------------------------------------------------------

  /** The requester's campaign, with every planned send's outcome. Works with the switch off. */
  async getCampaign(auth: AuthContext, id: string, now: Date = new Date()): Promise<ReminderCampaignDto> {
    try {
      return await withTenant(auth.schoolId, async (db) => {
        await this.requireAccess(db, auth.schoolId, auth.userId, { feature: false });
        const campaign = await this.loadCampaign(db, auth, id, false);
        return this.campaignDto(db, campaign, now);
      }, { label: "reminder-campaign-get" });
    } catch (e) {
      this.failSafely(auth.schoolId, "read", e);
    }
  }

  /** Stop before the next send. Sends already in flight finish and are recorded. */
  async halt(auth: AuthContext, id: string, ip: string | null): Promise<ReminderCampaignDto> {
    try {
      await withTenant(auth.schoolId, async (db) => {
        await this.requireAccess(db, auth.schoolId, auth.userId, { feature: false, lock: true });
        const campaign = await this.loadCampaign(db, auth, id, true);
        if (campaign.status !== "RUNNING") return;
        await this.setHalted(db, campaign, "HALTED_BY_REQUESTER", auth.userId, ip);
      }, { label: "reminder-campaign-halt" });
    } catch (e) {
      this.failSafely(auth.schoolId, "halt", e);
    }
    return this.getCampaign(auth, id);
  }

  /**
   * Explicit recovery: sends what was never attempted. UNKNOWN and FAILED sends
   * stay as they are. Never happens without this request.
   */
  async resume(auth: AuthContext, id: string, ip: string | null): Promise<ReminderCampaignDto> {
    try {
      await withTenant(auth.schoolId, async (db) => {
        await this.requireAccess(db, auth.schoolId, auth.userId, { feature: true, lock: true });
        const campaign = await this.loadCampaign(db, auth, id, true);
        if (campaign.status === "RUNNING") return;
        if (campaign.status === "COMPLETED") throw new ConflictError(C.notHalted, "This campaign has finished: nothing is left to send.");
        await db.$executeRaw`
          UPDATE reminder_campaigns SET status = 'RUNNING', halt_reason = NULL, halted_at = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE school_id = ${auth.schoolId} AND id = ${campaign.id}`;
        await this.audit(db, auth.schoolId, auth.userId, campaign.id, "reminder-campaign.resume", ip, { previousHaltReason: campaign.halt_reason ?? "" });
      }, { label: "reminder-campaign-resume" });
    } catch (e) {
      this.failSafely(auth.schoolId, "resume", e);
    }
    this.kick(auth.schoolId, id);
    return this.getCampaign(auth, id);
  }

  // ---------------------------------------------------------------------
  // Worker
  // ---------------------------------------------------------------------

  /** Runs a campaign in bounded batches. Safe to call from several workers at once. */
  async processCampaign(schoolId: string, campaignId: string, opts: RunOptions = {}): Promise<"DONE" | "HALTED" | "HELD" | "BUSY" | "BUDGET"> {
    const now = opts.now ?? (() => new Date());
    const maxBatches = opts.maxBatches ?? 1_000;
    for (let batch = 0; batch < maxBatches; batch++) {
      if (isQuietHour(now())) return "HELD";
      const claimed = await this.claimBatch(schoolId, campaignId, now(), opts.batchStudents ?? 10);
      if (claimed.kind !== "JOBS") return claimed.kind;
      for (const job of claimed.jobs) {
        const outcome = await this.send(job);
        await this.finish(job, outcome);
      }
    }
    return "BUDGET";
  }

  private kick(schoolId: string, campaignId: string): void {
    if (!this.autoRun) return;
    setImmediate(() => {
      this.processCampaign(schoolId, campaignId).catch(() => {
        this.logger.error(`Reminder campaign ${campaignId} worker stopped; details omitted. The scheduled runner continues it.`);
      });
    });
  }

  private async claimBatch(
    schoolId: string,
    campaignId: string,
    now: Date,
    batchStudents: number,
  ): Promise<{ kind: "JOBS"; jobs: Job[] } | { kind: "DONE" | "HALTED" | "BUSY" }> {
    return withTenant(schoolId, async (db) => {
      const [campaign] = await db.$queryRaw<CampaignRow[]>`
        SELECT * FROM reminder_campaigns WHERE school_id = ${schoolId} AND id = ${campaignId} FOR UPDATE`;
      if (!campaign) return { kind: "DONE" as const };
      if (campaign.status === "HALTED") return { kind: "HALTED" as const };
      if (campaign.status === "COMPLETED") return { kind: "DONE" as const };

      // A claim older than the lease: the worker died or lost the answer.
      await db.$executeRaw`
        UPDATE reminder_campaign_sends SET status = 'UNKNOWN', reason = 'INTERRUPTED', finished_at = ${now}
         WHERE school_id = ${schoolId} AND campaign_id = ${campaignId} AND status = 'SENDING'
           AND claimed_at < ${new Date(now.getTime() - SEND_LEASE_MS)}`;

      const problem = await this.accessProblem(db, schoolId, campaign.confirmed_by, true);
      if (problem) {
        await this.setHalted(db, campaign, problem === "INACTIVE" ? "CONFIRMER_ACCESS_REVOKED" : problem, null, null);
        return { kind: "HALTED" as const };
      }
      const { can } = await attemptableChannels(this.port, schoolId);
      if (!can.email && !can.sms && !can.push) {
        await this.setHalted(db, campaign, "NO_CHANNEL", null, null);
        return { kind: "HALTED" as const };
      }

      const students = await db.$queryRaw<{ student_id: string }[]>`
        SELECT DISTINCT student_id FROM reminder_campaign_sends
         WHERE school_id = ${schoolId} AND campaign_id = ${campaignId} AND status = 'PENDING'
         ORDER BY student_id LIMIT ${batchStudents}`;
      const rows = students.length
        ? await db.$queryRaw<SendRow[]>`
            SELECT * FROM reminder_campaign_sends
             WHERE school_id = ${schoolId} AND campaign_id = ${campaignId} AND status = 'PENDING'
               AND student_id = ANY(${students.map((s) => s.student_id)}::text[])
             ORDER BY student_id, channel, guardian_id
             FOR UPDATE SKIP LOCKED`
        : [];
      if (rows.length === 0) {
        const [left] = await db.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM reminder_campaign_sends
           WHERE school_id = ${schoolId} AND campaign_id = ${campaignId} AND status IN ('PENDING', 'SENDING')`;
        if (Number(left!.n) > 0) return { kind: "BUSY" as const };
        await db.$executeRaw`
          UPDATE reminder_campaigns SET status = 'COMPLETED', completed_at = ${now}, updated_at = ${now}
           WHERE school_id = ${schoolId} AND id = ${campaignId}`;
        await this.audit(db, schoolId, null, campaignId, "reminder-campaign.complete", null, {});
        return { kind: "DONE" as const };
      }

      const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { name: true, smsSenderId: true, smsSenderStatus: true } });
      const ids = [...new Set(rows.map((r) => r.student_id))];
      // The server's own figures, re-read now: a payment or plan since the
      // review changes this student's eligibility before anything is sent.
      const debt = await loadDebtFacts(db, schoolId, campaign.term_id, ids);
      const students2 = await db.student.findMany({ where: { schoolId, id: { in: ids } }, select: { id: true, firstName: true, lastName: true } });
      const nameOf = new Map(students2.map((s) => [s.id, `${s.firstName} ${s.lastName}`]));
      const guardians = await db.guardian.findMany({
        where: { schoolId, id: { in: [...new Set(rows.map((r) => r.guardian_id))] } },
        select: { id: true, email: true, phone: true, firstName: true },
      });
      const guardianOf = new Map(guardians.map((g) => [g.id, g]));
      const linked = new Set(
        (await db.studentGuardian.findMany({ where: { schoolId, studentId: { in: ids } }, select: { studentId: true, guardianId: true } })).map(
          (l) => `${l.studentId}:${l.guardianId}`,
        ),
      );
      const emails = guardians.flatMap((g) => (g.email ? [g.email.trim().toLowerCase()] : []));
      const blocked = can.email ? await blockedAddresses(db, schoolId, emails) : new Map<string, string>();

      const jobs: Job[] = [];
      const skip = async (row: SendRow, reason: string) => {
        await db.$executeRaw`
          UPDATE reminder_campaign_sends SET status = 'SKIPPED', reason = ${reason}, finished_at = ${now}
           WHERE school_id = ${schoolId} AND id = ${row.id} AND status = 'PENDING'`;
      };
      for (const row of rows) {
        const facts = debt.get(row.student_id);
        const eligibility = nameOf.has(row.student_id)
          ? debtEligibility(facts, { includePaymentPlans: campaign.include_payment_plans, overdueOnly: campaign.overdue_only })
          : "NOT_FOUND";
        if (eligibility !== "ELIGIBLE") { await skip(row, eligibility); continue; }
        const g = guardianOf.get(row.guardian_id);
        if (!g || !linked.has(`${row.student_id}:${row.guardian_id}`)) { await skip(row, "GUARDIAN_UNLINKED"); continue; }
        const email = g.email?.trim().toLowerCase() ?? null;
        if (row.channel === "EMAIL") {
          if (!can.email) { await skip(row, "CHANNEL_OFF"); continue; }
          if (!email) { await skip(row, "NO_CONTACT"); continue; }
          if (blocked.get(email) === "SUPPRESSED") { await skip(row, "EMAIL_SUPPRESSED"); continue; }
        } else {
          const smsOk = can.sms && !!g.phone;
          if (!can.push && !smsOk) { await skip(row, can.sms ? "NO_CONTACT" : "CHANNEL_OFF"); continue; }
        }
        const token = randomUUID();
        await db.$executeRaw`
          UPDATE reminder_campaign_sends SET status = 'SENDING', claim_token = ${token}, claimed_at = ${now}
           WHERE school_id = ${schoolId} AND id = ${row.id} AND status = 'PENDING'`;
        jobs.push({
          id: row.id, claimToken: token, channel: row.channel, schoolId, guardianId: g.id,
          schoolName: school.name, smsSender: smsSenderFor(school), studentName: nameOf.get(row.student_id)!,
          balance: facts!.balance, dueDate: facts!.earliestDueDate,
          email: row.channel === "EMAIL" ? { to: email!, firstName: g.firstName } : undefined,
          phone: g.phone, smsAvailable: can.sms && !!g.phone,
        });
      }
      await db.$executeRaw`UPDATE reminder_campaigns SET updated_at = ${now} WHERE school_id = ${schoolId} AND id = ${campaignId}`;
      return { kind: "JOBS" as const, jobs };
    }, { timeoutMs: 30_000, label: "reminder-campaign-claim" });
  }

  /** One outbound action. Never throws: an unclassifiable failure is UNKNOWN. */
  private async send(job: Job): Promise<{ status: "ACCEPTED" | "FAILED" | "UNKNOWN" | "SKIPPED"; reason: string | null; channelUsed: "EMAIL" | "PUSH" | "SMS" | null; providerRef: string | null }> {
    const asResult = (o: SendOutcome, channelUsed: "EMAIL" | "SMS") =>
      o.status === "ACCEPTED"
        ? { status: "ACCEPTED" as const, reason: null, channelUsed, providerRef: o.providerRef }
        : { status: o.status === "REJECTED" ? ("FAILED" as const) : ("UNKNOWN" as const), reason: o.reason, channelUsed, providerRef: null };
    try {
      if (job.channel === "EMAIL") {
        const o = await this.port.sendEmail({
          to: job.email!.to,
          subject: `Fee reminder from ${job.schoolName}`,
          schoolName: job.schoolName,
          idempotencyKey: `reminder-send/${job.id}`,
          html: buildReminderHtml({
            guardianFirstName: job.email!.firstName ?? "Parent/Guardian",
            studentName: job.studentName, schoolName: job.schoolName, balance: job.balance, dueDate: job.dueDate,
          }),
        });
        return asResult(o, "EMAIL");
      }
      let channel: "PUSH" | "SMS" | "NONE";
      try {
        channel = await this.port.pushOrSms({
          schoolId: job.schoolId, guardianId: job.guardianId, title: job.schoolName,
          // Lockscreen-safe, as POST /finance/debtors/remind: no name, no amount.
          body: "You have a new fee reminder.", data: { kind: "fee-reminder" }, smsAvailable: job.smsAvailable,
        });
      } catch {
        return { status: "UNKNOWN", reason: "PUSH_QUEUE_NO_ANSWER", channelUsed: "PUSH", providerRef: null };
      }
      if (channel === "PUSH") return { status: "ACCEPTED", reason: "QUEUED_FOR_APP", channelUsed: "PUSH", providerRef: null };
      if (channel === "NONE" || !job.phone) return { status: "SKIPPED", reason: "NO_ROUTE", channelUsed: null, providerRef: null };
      const to = normalizeNigerianPhone(job.phone);
      if (!to) return { status: "FAILED", reason: "INVALID_PHONE", channelUsed: "SMS", providerRef: null };
      return asResult(
        await this.port.sendSms(to, buildReminderSms({ studentName: job.studentName, schoolName: job.schoolName, balance: job.balance, dueDate: job.dueDate }), job.smsSender),
        "SMS",
      );
    } catch {
      return { status: "UNKNOWN", reason: "SEND_ERROR", channelUsed: job.channel === "EMAIL" ? "EMAIL" : null, providerRef: null };
    }
  }

  /** Records an outcome against its own claim only. A lease-expired UNKNOWN is corrected by a late answer. */
  private async finish(job: Job, r: Awaited<ReturnType<ReminderCampaignsService["send"]>>): Promise<void> {
    await withTenant(job.schoolId, (db) => db.$executeRaw`
      UPDATE reminder_campaign_sends
         SET status = ${r.status}, reason = ${r.reason}, channel_used = ${r.channelUsed}, provider_ref = ${r.providerRef}, finished_at = CURRENT_TIMESTAMP
       WHERE school_id = ${job.schoolId} AND id = ${job.id} AND claim_token = ${job.claimToken} AND status IN ('SENDING', 'UNKNOWN')`,
      { label: "reminder-campaign-finish", retryConnectionErrors: true });
  }

  // ---------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------

  private async insertProposal(
    db: Db, auth: AuthContext, clientRequestId: string, requestHash: string, input: ReminderInput, ip: string | null, refreshedFrom?: string,
  ): Promise<ReminderCampaignProposalDto> {
    const preview = await computeReminderPreview(db, this.port, auth.schoolId, input);
    const id = randomUUID();
    const expires = new Date(Date.now() + REMINDER_CAMPAIGN_TTL_MINUTES * 60_000);
    const payload: Payload = { input, students: preview.students, plan: preview.plan };
    const [row] = await db.$queryRaw<ProposalRow[]>`
      INSERT INTO workflow_proposals
        (id, school_id, kind, requested_by, client_request_id, request_hash, preview_hash, payload, summary, expires_at)
      VALUES (${id}, ${auth.schoolId}, ${REMINDER_CAMPAIGN_KIND}, ${auth.userId}, ${clientRequestId}, ${requestHash},
              ${preview.previewHash}, ${JSON.stringify(payload)}::jsonb, ${JSON.stringify(preview.summary)}::jsonb, ${expires})
      ON CONFLICT (school_id, kind, requested_by, client_request_id) DO NOTHING
      RETURNING *`;
    if (!row) {
      const winner = await this.findByClientRequest(db, auth, clientRequestId);
      if (!winner) throw new ConflictError(C.stale, "Prepare this selection again.");
      return this.proposalDtoFor(winner, requestHash);
    }
    await this.audit(db, auth.schoolId, auth.userId, id, "reminder-campaign.prepare", ip, {
      selected: preview.summary.counts.selected, eligible: preview.summary.counts.eligible, ...(refreshedFrom ? { refreshedFrom } : {}),
    });
    return this.proposalDto(row);
  }

  private async findByClientRequest(db: Db, auth: AuthContext, clientRequestId: string): Promise<ProposalRow | null> {
    const rows = await db.$queryRaw<ProposalRow[]>`
      SELECT * FROM workflow_proposals
       WHERE school_id = ${auth.schoolId} AND kind = ${REMINDER_CAMPAIGN_KIND}
         AND requested_by = ${auth.userId} AND client_request_id = ${clientRequestId}`;
    return rows[0] ?? null;
  }

  private async loadProposal(db: Db, auth: AuthContext, id: string, lock: boolean): Promise<ProposalRow> {
    const rows = lock
      ? await db.$queryRaw<ProposalRow[]>`
          SELECT * FROM workflow_proposals
           WHERE school_id = ${auth.schoolId} AND kind = ${REMINDER_CAMPAIGN_KIND} AND id = ${id} AND requested_by = ${auth.userId}
           FOR UPDATE`
      : await db.$queryRaw<ProposalRow[]>`
          SELECT * FROM workflow_proposals
           WHERE school_id = ${auth.schoolId} AND kind = ${REMINDER_CAMPAIGN_KIND} AND id = ${id} AND requested_by = ${auth.userId}`;
    if (!rows[0]) throw new NotFoundError("Reminder review not found.");
    return rows[0];
  }

  private async loadCampaign(db: Db, auth: AuthContext, id: string, lock: boolean): Promise<CampaignRow> {
    const rows = lock
      ? await db.$queryRaw<CampaignRow[]>`
          SELECT * FROM reminder_campaigns WHERE school_id = ${auth.schoolId} AND id = ${id} AND requested_by = ${auth.userId} FOR UPDATE`
      : await db.$queryRaw<CampaignRow[]>`
          SELECT * FROM reminder_campaigns WHERE school_id = ${auth.schoolId} AND id = ${id} AND requested_by = ${auth.userId}`;
    if (!rows[0]) throw new NotFoundError("Reminder campaign not found.");
    return rows[0];
  }

  private async setHalted(db: Db, campaign: CampaignRow, reason: ReminderHaltReason, userId: string | null, ip: string | null): Promise<void> {
    await db.$executeRaw`
      UPDATE reminder_campaigns SET status = 'HALTED', halt_reason = ${reason}, halted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE school_id = ${campaign.school_id} AND id = ${campaign.id} AND status = 'RUNNING'`;
    await this.audit(db, campaign.school_id, userId, campaign.id, "reminder-campaign.halt", ip, { reason });
    this.logger.warn(`Reminder campaign ${campaign.id} halted: ${reason}`);
  }

  /** Throws for a person acting now. */
  private async requireAccess(db: Db, schoolId: string, userId: string, opts: { feature: boolean; lock?: boolean }): Promise<void> {
    const problem = await this.accessProblem(db, schoolId, userId, opts.feature);
    if (problem === "SCHOOL_UNAVAILABLE") throw new ForbiddenError("School access is unavailable.");
    if (problem === "FEATURE_OFF") throw new ForbiddenError("Fee reminder campaigns are switched off for this school.");
    if (problem === "INACTIVE") throw new UnauthorizedError("USER_INACTIVE", "Your account is unavailable.");
    if (problem) throw new ForbiddenError("Not permitted.");
  }

  /**
   * School live, switch on (when asked), person active and holding both
   * finance.debtors.read and finance.debtors.remind. Locks the rows read
   * FOR SHARE, so a revocation cannot land halfway through a confirm or claim.
   */
  private async accessProblem(db: Db, schoolId: string, userId: string, feature: boolean): Promise<ReminderHaltReason | "INACTIVE" | null> {
    const [school] = await db.$queryRaw<{ ok: boolean; feature_switches: unknown }[]>`
      SELECT (status = 'ACTIVE' AND suspended_at IS NULL) AS ok, feature_switches FROM schools WHERE id = ${schoolId} FOR SHARE`;
    if (!school?.ok) return "SCHOOL_UNAVAILABLE";
    if (feature && !this.features.isOnFromStored(FEATURE, school.feature_switches)) return "FEATURE_OFF";
    const grants = await db.$queryRaw<{ is_active: boolean; permissions: unknown }[]>`
      SELECT u.is_active, r.permissions FROM users u
        JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id
       WHERE u.school_id = ${schoolId} AND u.id = ${userId}
       FOR SHARE OF u, ur, r`;
    if (!grants.length || grants.some((g) => !g.is_active)) return grants.length ? "INACTIVE" : "CONFIRMER_ACCESS_REVOKED";
    const held = new Set(grants.flatMap((g) => (Array.isArray(g.permissions) ? (g.permissions as string[]) : [])));
    const ok = held.has(PERMISSION_WILDCARD) || (held.has("finance.debtors.read") && held.has("finance.debtors.remind"));
    return ok ? null : "CONFIRMER_ACCESS_REVOKED";
  }

  private proposalDtoFor(row: ProposalRow, requestHash: string): ReminderCampaignProposalDto {
    if (row.request_hash !== requestHash) {
      throw new ConflictError(C.requestIdReused, "This request id was already used for a different selection. Use a new id.");
    }
    return this.proposalDto(row);
  }

  private proposalDto(row: ProposalRow): ReminderCampaignProposalDto {
    const expired = row.status === "EXPIRED" || (row.status === "PENDING" && row.expires_at.getTime() <= Date.now());
    const status = row.status === "COMPLETED" ? "CONFIRMED" : expired ? "EXPIRED" : "PENDING";
    const s = row.summary;
    return {
      id: row.id,
      status,
      previewHash: row.preview_hash,
      expiresAt: row.expires_at.toISOString(),
      createdAt: row.created_at.toISOString(),
      termId: s.termId,
      termLabel: s.termLabel,
      templateVersion: s.templateVersion,
      options: s.options,
      channels: s.channels,
      counts: s.counts,
      batchErrors: s.batchErrors,
      batchWarnings: s.batchWarnings,
      canConfirm: status === "PENDING" && s.batchErrors.length === 0,
      students: status === "PENDING" ? (row.payload?.students ?? []) : [],
      dataCleared: row.payload === null,
      campaignId: row.result?.campaignId ?? null,
      limits: REMINDER_CAMPAIGN_LIMITS,
    };
  }

  private async campaignDto(db: Db, c: CampaignRow, now: Date): Promise<ReminderCampaignDto> {
    const sends = await db.$queryRaw<SendRow[]>`
      SELECT * FROM reminder_campaign_sends WHERE school_id = ${c.school_id} AND campaign_id = ${c.id}
       ORDER BY student_id, channel, guardian_id`;
    const ids = [...new Set(sends.map((s) => s.student_id))];
    const students = await db.student.findMany({ where: { schoolId: c.school_id, id: { in: ids } }, select: { id: true, firstName: true, lastName: true, admissionNumber: true } });
    const byId = new Map(students.map((s) => [s.id, s]));
    const counts: Record<ReminderSendOutcome, number> = { PENDING: 0, SENDING: 0, ACCEPTED: 0, SKIPPED: 0, FAILED: 0, UNKNOWN: 0, NOT_REQUESTED: 0 };
    const grouped = new Map<string, ReminderCampaignSendDto[]>();
    for (const s of sends) {
      const outcome: ReminderSendOutcome = s.status === "PENDING" && c.status === "HALTED" ? "NOT_REQUESTED" : s.status;
      counts[outcome] += 1;
      grouped.set(s.student_id, [
        ...(grouped.get(s.student_id) ?? []),
        { guardianId: s.guardian_id, slot: s.channel, channelUsed: s.channel_used, outcome, reason: s.reason, finishedAt: s.finished_at?.toISOString() ?? null },
      ]);
    }
    return {
      id: c.id,
      proposalId: c.proposal_id,
      termId: c.term_id,
      status: c.status,
      haltReason: c.halt_reason,
      templateVersion: c.template_version,
      createdAt: c.created_at.toISOString(),
      haltedAt: c.halted_at?.toISOString() ?? null,
      completedAt: c.completed_at?.toISOString() ?? null,
      heldForQuietHours: c.status === "RUNNING" && isQuietHour(now),
      counts,
      students: ids.map((id) => {
        const s = byId.get(id);
        return { studentId: id, name: s ? `${s.firstName} ${s.lastName}` : null, admissionNumber: s?.admissionNumber ?? null, sends: grouped.get(id) ?? [] };
      }),
      limits: REMINDER_CAMPAIGN_LIMITS,
    };
  }

  private async audit(db: Db, schoolId: string, userId: string | null, id: string, action: string, ip: string | null, metadata: Record<string, string | number>) {
    // Counts and ids only: never a name, a contact detail or an amount.
    await db.auditLog.create({
      data: { schoolId, userId, action, entityType: "reminder_campaign", entityId: id, ipAddress: ip, metadata: { via: "reminder-campaign", ...metadata } },
    });
  }

  private failSafely(schoolId: string, operation: string, error: unknown): never {
    if (error instanceof BaseError) throw error;
    // Driver errors can quote names, contacts or amounts. Never log them.
    this.logger.error(`Reminder campaign ${operation} failed: school=${schoolId}; details omitted`);
    throw new InternalError("The reminder campaign operation could not finish. Open it to check its status before retrying.");
  }
}
