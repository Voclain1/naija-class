import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";

import { basePrisma, withTenant } from "@school-kit/db";
import {
  NotFoundError,
  type DebtorDto,
  type FinanceDashboardDto,
  type SendRemindersInput,
  type SendRemindersResult,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { EmailService } from "../../common/email/email.service.js";
import { redactPhone } from "../../common/redact.js";
import { normalizeNigerianPhone, TermiiService } from "../../common/termii/termii.service.js";
import { NotificationPreferencesService } from "../notifications/notification-preferences.service.js";

// onModuleInit must never block NestFactory.create() indefinitely. Same fix
// as PartitionService (see docs/deferred.md's "recurring dev-server bootstrap
// hang" entry) — transitionOverdueInvoices() sweeps every ACTIVE school with
// no bound, and a large school count (54,106 accumulated test schools were
// found doing exactly this during Payroll CP4b's manual gate) makes this the
// slow-startup path, not PartitionService. 10s, not 5s: this sweep
// legitimately has more work per call (a school loop, not 3 fixed calls), so
// it gets more headroom before we give up and let boot continue anyway.
const ON_MODULE_INIT_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// FinanceService — cross-entity aggregation: debtor list, OVERDUE cron, email
// ---------------------------------------------------------------------------

@Injectable()
export class FinanceService implements OnModuleInit {
  private readonly logger = new Logger(FinanceService.name);

  // Phase 4 / Slice 6 — email/SMS send paths + preference enforcement moved
  // to shared services (see docs/modules/phase-4.md §8 D5). Previously this
  // field held FinanceService's own `new Resend(...)` client, constructed
  // straight from process.env; EmailService centralises that so guardian-
  // invite email (also Slice 6) shares the same tested send path.
  constructor(
    private readonly email: EmailService,
    private readonly termii: TermiiService,
    private readonly notificationPreferences: NotificationPreferencesService,
  ) {}

  // On startup: catch any invoices that went overdue while the API was down.
  // Deliberately non-fatal, same reasoning as PartitionService: the daily
  // @Cron below (5 0 * * *) is the durable path; onModuleInit is only a
  // best-effort cold-start convenience on top of it. A slow/huge sweep here
  // logs a warning and lets NestJS finish starting rather than hanging or
  // crashing boot.
  async onModuleInit() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.transitionOverdueInvoices(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${ON_MODULE_INIT_TIMEOUT_MS}ms`)),
            ON_MODULE_INIT_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`FinanceService.onModuleInit failed (non-fatal): ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  // ─── Debtor list ──────────────────────────────────────────────────────────

  async listDebtors(authCtx: AuthContext, termId: string): Promise<DebtorDto[]> {
    return withTenant(authCtx.schoolId, async (db) => {
      // Step 1: load outstanding invoices for the term.
      const invoices = await db.invoice.findMany({
        where: {
          termId,
          status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
        },
        select: {
          id: true,
          studentId: true,
          totalDue: true,
          totalPaid: true,
          status: true,
          dueDate: true,
        },
      });

      if (invoices.length === 0) return [];

      // Step 2: batch-load student details + enrollment for the class arm name.
      // Invoice uses a plain-FK (no Prisma relation to Student), so we batch
      // a separate query keyed by the student IDs collected above.
      const studentIds = [...new Set(invoices.map((inv) => inv.studentId))];
      const students = await db.student.findMany({
        where: { id: { in: studentIds } },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          admissionNumber: true,
          enrollments: {
            where: { termId },
            select: { classArm: { select: { name: true } } },
            take: 1,
          },
        },
      });
      const studentMap = new Map(students.map((s) => [s.id, s]));

      // Step 3: check which invoices have a payment plan — one batch query.
      const invoiceIds = invoices.map((inv) => inv.id);
      const plans = await db.paymentPlan.findMany({
        where: { invoiceId: { in: invoiceIds } },
        select: { invoiceId: true },
      });
      const planSet = new Set(plans.map((p) => p.invoiceId));

      const STATUS_ORDER: Record<string, number> = {
        OVERDUE: 0,
        PARTIALLY_PAID: 1,
        ISSUED: 2,
      };

      const debtors: DebtorDto[] = invoices.map((inv) => {
        const student = studentMap.get(inv.studentId);
        const classArm = student?.enrollments[0]?.classArm.name ?? "—";
        const dueDateStr = inv.dueDate
          ? (inv.dueDate instanceof Date ? inv.dueDate.toISOString() : String(inv.dueDate)).slice(0, 10)
          : null;

        return {
          invoiceId: inv.id,
          studentId: inv.studentId,
          studentName: student ? `${student.firstName} ${student.lastName}` : "—",
          admissionNumber: student?.admissionNumber ?? "—",
          classArm,
          totalDue: inv.totalDue,
          totalPaid: inv.totalPaid,
          balance: inv.totalDue - inv.totalPaid,
          status: inv.status as "ISSUED" | "PARTIALLY_PAID" | "OVERDUE",
          dueDate: dueDateStr,
          hasPaymentPlan: planSet.has(inv.id),
        };
      });

      // Sort: OVERDUE → PARTIALLY_PAID → ISSUED; within group by balance desc.
      debtors.sort((a, b) => {
        const orderDiff = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
        if (orderDiff !== 0) return orderDiff;
        return b.balance - a.balance;
      });

      return debtors;
    });
  }

  // ─── Finance dashboard ─────────────────────────────────────────────────────
  //
  // Phase 3 / Slice 14. Read-only aggregation — no audit log (same precedent
  // as listDebtors: reads aren't audited in this codebase, only mutations).
  //
  // "Collections vs target": target = totalDue on invoices that were actually
  // issued (excludes DRAFT — never issued, no frozen snapshot — and CANCELLED
  // — voided, no longer expected). REFUNDED IS included in totalInvoiced (it
  // was legitimately invoiced and collected at some point) but its totalPaid
  // is already zeroed by slice 11's reversal recompute, so it correctly nets
  // to zero on the "collected" side without special-casing here.
  //
  // Debtor set (ISSUED/PARTIALLY_PAID/OVERDUE only) is a separate, LEANER
  // aggregate than listDebtors() — the dashboard only needs two numbers
  // (outstandingBalance, debtorCount), not the per-invoice student/class-arm/
  // payment-plan joins listDebtors does for its UI list. Invoice carries
  // @@unique([schoolId, studentId, termId]), so debtorCount === the aggregate
  // count directly — no distinct-student dance needed.
  //
  // Expense has no termId (only a bare incurredAt date), so "expenses for
  // this term" is resolved via the Term row's own date range rather than a
  // direct FK filter.
  async getDashboard(authCtx: AuthContext, termId: string): Promise<FinanceDashboardDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findUnique({
        where: { id: termId },
        select: { id: true, name: true, startDate: true, endDate: true },
      });
      if (!term) throw new NotFoundError("Term not found.");

      const [invoicedAgg, debtorAgg, expenseAgg] = await Promise.all([
        db.invoice.aggregate({
          where: { termId, status: { notIn: ["DRAFT", "CANCELLED"] } },
          _sum: { totalDue: true, totalPaid: true },
        }),
        db.invoice.aggregate({
          where: { termId, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } },
          _sum: { totalDue: true, totalPaid: true },
          _count: true,
        }),
        db.expense.aggregate({
          where: { incurredAt: { gte: term.startDate, lte: term.endDate } },
          _sum: { amount: true },
        }),
      ]);

      const totalInvoiced = invoicedAgg._sum.totalDue ?? 0;
      const totalCollected = invoicedAgg._sum.totalPaid ?? 0;
      const collectionRatePercent =
        totalInvoiced > 0 ? Math.round((totalCollected / totalInvoiced) * 100) : 0;

      const outstandingBalance =
        (debtorAgg._sum.totalDue ?? 0) - (debtorAgg._sum.totalPaid ?? 0);
      const debtorCount = debtorAgg._count;

      const totalExpenses = expenseAgg._sum.amount ?? 0;
      const netPosition = totalCollected - totalExpenses;

      return {
        termId: term.id,
        termName: term.name,
        totalInvoiced,
        totalCollected,
        collectionRatePercent,
        outstandingBalance,
        debtorCount,
        totalExpenses,
        netPosition,
      };
    });
  }

  // ─── Send reminders (email + SMS) ──────────────────────────────────────────
  //
  // Phase 4 / Slice 6 extends this Phase 3 Slice 10 cron/admin-triggered
  // action two ways (docs/modules/phase-4.md §8 D2): (1) both channels are
  // now gated by the school's NotificationPreference — the acceptance
  // criterion this whole slice hinges on ("a school with SMS disabled sends
  // no Termii messages regardless of event type") applies here as much as
  // to guardian invites; (2) SMS is a real second channel, not just email.
  //
  // A student counts as "sent" if AT LEAST ONE enabled channel reached the
  // guardian; "skipped" covers no-invoice, no-contact-info-on-the-enabled-
  // channels, and every-attempted-channel-failed. SendRemindersResult's
  // {sent, skipped} shape is unchanged — deliberately coarse, matching its
  // pre-existing per-student (not per-channel) granularity.
  async sendReminders(
    authCtx: AuthContext,
    dto: SendRemindersInput,
  ): Promise<SendRemindersResult> {
    const channels = await this.notificationPreferences.getEnabledChannels(authCtx.schoolId);
    const emailAttemptable = channels.email && this.email.isConfigured;
    const smsAttemptable = channels.sms && this.termii.isConfigured;

    if (!emailAttemptable && !smsAttemptable) {
      this.logger.warn(
        `Reminders skipped for school ${authCtx.schoolId} — no enabled/configured channel ` +
          `(emailEnabled=${channels.email}, emailConfigured=${this.email.isConfigured}, ` +
          `smsEnabled=${channels.sms}, smsConfigured=${this.termii.isConfigured})`,
      );
      return { sent: 0, skipped: dto.studentIds.length };
    }

    return withTenant(authCtx.schoolId, async (db) => {
      const school = await db.school.findUniqueOrThrow({
        where: { id: authCtx.schoolId },
        select: { name: true },
      });

      let sent = 0;
      let skipped = 0;

      for (const studentId of dto.studentIds) {
        // Load the outstanding invoice for this student in the specified term.
        const invoice = await db.invoice.findFirst({
          where: {
            studentId,
            termId: dto.termId,
            status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
          },
          select: { totalDue: true, totalPaid: true, dueDate: true },
        });
        if (!invoice) {
          skipped++;
          continue;
        }

        // Load the student name for the message body.
        const student = await db.student.findUnique({
          where: { id: studentId },
          select: { firstName: true, lastName: true },
        });

        // Load primary guardian contact info (same pattern as Slice 8 initPaystack).
        const guardianLink = await db.studentGuardian.findFirst({
          where: { studentId, isPrimary: true },
          select: { guardian: { select: { email: true, phone: true, firstName: true } } },
        });
        const guardianEmail = guardianLink?.guardian?.email;
        const guardianPhone = guardianLink?.guardian?.phone;

        if ((!emailAttemptable || !guardianEmail) && (!smsAttemptable || !guardianPhone)) {
          this.logger.warn(
            `No usable guardian contact info on an enabled channel for student ${studentId} — skipping`,
          );
          skipped++;
          continue;
        }

        const balance = invoice.totalDue - invoice.totalPaid;
        const dueDateStr = invoice.dueDate
          ? (invoice.dueDate instanceof Date
              ? invoice.dueDate.toISOString()
              : String(invoice.dueDate)
            ).slice(0, 10)
          : null;

        const studentName = student
          ? `${student.firstName} ${student.lastName}`
          : "your child";
        const guardianFirstName = guardianLink?.guardian?.firstName ?? "Parent/Guardian";

        let sentAny = false;

        if (emailAttemptable && guardianEmail) {
          try {
            await this.email.send({
              to: guardianEmail,
              subject: `Fee reminder from ${school.name}`,
              html: buildReminderHtml({
                guardianFirstName,
                studentName,
                schoolName: school.name,
                balance,
                dueDate: dueDateStr,
              }),
            });
            sentAny = true;
          } catch (err) {
            this.logger.error(`Failed to email reminder to ${guardianEmail}: ${String(err)}`);
          }
        }

        if (smsAttemptable && guardianPhone) {
          const normalized = normalizeNigerianPhone(guardianPhone);
          if (!normalized) {
            this.logger.warn(
              `Reminder SMS skipped — unrecognized phone format (${redactPhone(guardianPhone)})`,
            );
          } else {
            try {
              await this.termii.sendSms(
                normalized,
                buildReminderSms({ studentName, schoolName: school.name, balance, dueDate: dueDateStr }),
              );
              sentAny = true;
            } catch (err) {
              this.logger.error(`Failed to SMS reminder to ${redactPhone(guardianPhone)}: ${String(err)}`);
            }
          }
        }

        if (sentAny) sent++;
        else skipped++;
      }

      this.logger.log(`Reminders: sent=${sent} skipped=${skipped} school=${authCtx.schoolId}`);
      return { sent, skipped };
    });
  }

  // ─── OVERDUE transition cron ──────────────────────────────────────────────
  //
  // Runs daily at 00:05 UTC. Also called at onModuleInit to catch invoices that
  // went overdue while the server was down.
  //
  // Iterates over ACTIVE schools using withTenant so each update runs within
  // the correct RLS context (app.current_school_id set). This avoids needing a
  // 6th SECURITY DEFINER function before the slice-12 SD inventory refactor.

  // schoolIds is an optional allow-list used by tests to scope the sweep to
  // one school and avoid iterating thousands of accumulated test-DB schools.
  // The production @Cron call passes nothing → all ACTIVE schools are swept.
  @Cron("5 0 * * *")
  async transitionOverdueInvoices(schoolIds?: string[]): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let schools: Array<{ id: string }>;
    try {
      schools = await basePrisma.school.findMany({
        where: {
          status: "ACTIVE",
          ...(schoolIds?.length ? { id: { in: schoolIds } } : {}),
        },
        select: { id: true },
      });
    } catch (err) {
      this.logger.error(`OVERDUE cron: failed to list schools: ${String(err)}`);
      return;
    }

    let totalUpdated = 0;

    for (const school of schools) {
      try {
        // ISSUED → totalPaid = 0 < totalDue (always). PARTIALLY_PAID → 0 <
        // totalPaid < totalDue (always). Status filter is sufficient — no
        // column-to-column comparison needed.
        const result = await withTenant(school.id, (db) =>
          db.invoice.updateMany({
            where: {
              status: { in: ["ISSUED", "PARTIALLY_PAID"] },
              dueDate: { not: null, lt: today },
            },
            data: { status: "OVERDUE" },
          }),
        );
        totalUpdated += result.count;
      } catch (err) {
        this.logger.error(`OVERDUE cron: school ${school.id} failed: ${String(err)}`);
      }
    }

    if (totalUpdated > 0) {
      this.logger.log(
        `OVERDUE transition: ${totalUpdated} invoice(s) marked across ${schools.length} school(s)`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Email template helper
// ---------------------------------------------------------------------------

function formatKoboForEmail(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`;
}

function buildReminderHtml(opts: {
  guardianFirstName: string;
  studentName: string;
  schoolName: string;
  balance: number;
  dueDate: string | null;
}): string {
  const dueLine = opts.dueDate
    ? `<p>Due date: <strong>${opts.dueDate}</strong></p>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Fee Reminder</title></head>
<body style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <h2 style="color:#1a1a1a">${opts.schoolName}</h2>
  <p>Dear ${opts.guardianFirstName},</p>
  <p>This is a reminder that the following outstanding school fees are due for <strong>${opts.studentName}</strong>:</p>
  <table style="border-collapse:collapse;width:100%">
    <tr>
      <td style="padding:8px;border:1px solid #e5e7eb">Outstanding balance</td>
      <td style="padding:8px;border:1px solid #e5e7eb;font-weight:600">${formatKoboForEmail(opts.balance)}</td>
    </tr>
  </table>
  ${dueLine}
  <p>Please contact the school's bursar to arrange payment.</p>
  <p style="color:#6b7280;font-size:13px">This message was sent by ${opts.schoolName} via School Kit.</p>
</body>
</html>`;
}

// SMS body — plain text, kept short (Termii bills per 160-character page,
// special characters drop that to 70 — see docs/modules/phase-4.md §8 D6).
// No greeting/sign-off flourish the email version has room for.
function buildReminderSms(opts: {
  studentName: string;
  schoolName: string;
  balance: number;
  dueDate: string | null;
}): string {
  const dueClause = opts.dueDate ? ` Due ${opts.dueDate}.` : "";
  return `${opts.schoolName}: ${formatKoboForEmail(opts.balance)} outstanding for ${opts.studentName}.${dueClause} Contact the bursar to pay.`;
}
