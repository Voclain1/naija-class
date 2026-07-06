import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Resend } from "resend";

import { basePrisma, withTenant } from "@school-kit/db";
import type { DebtorDto, SendRemindersInput, SendRemindersResult } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";

// ---------------------------------------------------------------------------
// FinanceService — cross-entity aggregation: debtor list, OVERDUE cron, email
// ---------------------------------------------------------------------------

@Injectable()
export class FinanceService implements OnModuleInit {
  private readonly logger = new Logger(FinanceService.name);

  // Lazy-initialised: if RESEND_API_KEY is absent the app still boots and
  // sendReminders returns { sent: 0, skipped: all } with a warning log.
  private readonly resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;

  // On startup: catch any invoices that went overdue while the API was down.
  async onModuleInit() {
    await this.transitionOverdueInvoices();
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

  // ─── Send email reminders ─────────────────────────────────────────────────

  async sendReminders(
    authCtx: AuthContext,
    dto: SendRemindersInput,
  ): Promise<SendRemindersResult> {
    if (!this.resend) {
      this.logger.warn("RESEND_API_KEY is not configured — reminder emails skipped");
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

        // Load the student name for the email body.
        const student = await db.student.findUnique({
          where: { id: studentId },
          select: { firstName: true, lastName: true },
        });

        // Load primary guardian email (same pattern as Slice 8 initPaystack).
        const guardianLink = await db.studentGuardian.findFirst({
          where: { studentId, isPrimary: true },
          select: { guardian: { select: { email: true, firstName: true } } },
        });
        const guardianEmail = guardianLink?.guardian?.email;
        if (!guardianEmail) {
          this.logger.warn(`No guardian email for student ${studentId} — skipping`);
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

        try {
          await this.resend!.emails.send({
            from: "no-reply@schoolkit.ng",
            to: guardianEmail,
            subject: `Fee reminder from ${school.name}`,
            html: buildReminderHtml({
              guardianFirstName: guardianLink?.guardian?.firstName ?? "Parent/Guardian",
              studentName,
              schoolName: school.name,
              balance,
              dueDate: dueDateStr,
            }),
          });
          sent++;
        } catch (err) {
          this.logger.error(`Failed to send reminder to ${guardianEmail}: ${String(err)}`);
          skipped++;
        }
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
