import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  type CreatePaystackSetupRequestInput,
  type PaystackSetupRequestDto,
  type PaystackSetupStatus,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { EmailService } from "../../common/email/email.service";

// Paystack assisted setup — school side. See
// docs/modules/paystack-assisted-setup.md for the full plan-first.
//
// Split out of SchoolsService deliberately: that file is already the largest
// in this module and owns the onboarding wizard state machine. This is a
// self-contained concern with its own external dependency (EmailService), and
// the routes still hang off SchoolsController, so the API surface is
// unchanged from the approved plan.

// Redacts an account number for logs and audit metadata. Never store or log
// the full value — D2 accepts plaintext AT REST (matching
// StaffBankAccount.account_number) but not plaintext in the log stream, which
// ships to a third party and has no tenant boundary.
export function maskAccountNumber(accountNumber: string): string {
  return accountNumber.length <= 4
    ? "*".repeat(accountNumber.length)
    : `${"*".repeat(accountNumber.length - 4)}${accountNumber.slice(-4)}`;
}

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

@Injectable()
export class PaystackSetupService {
  private readonly logger = new Logger(PaystackSetupService.name);

  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // GET /schools/me/paystack-setup-request — the latest request, or null if
  // the school has never submitted one (the settings page shows the form in
  // that case). Owner/admin only, matching patchMe's gate: this reads back a
  // banking submission, not general school config.
  async findLatest(authCtx: AuthContext): Promise<PaystackSetupRequestDto | null> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.paystackSetupRequest.findFirst({
        where: { schoolId: authCtx.schoolId },
        orderBy: { submittedAt: "desc" },
      });
      return row ? toDto(row) : null;
    });
  }

  // POST /schools/me/paystack-setup-request.
  //
  // Ordering is load-bearing: the row is committed BEFORE the notification is
  // attempted, and a notification failure is logged but never thrown (D6).
  // The database row is the source of truth and the platform-admin dashboard
  // is the real notification mechanism — the email is a nudge. Losing a
  // school's banking submission because Resend had a bad minute would be the
  // worse failure by a wide margin.
  async create(
    authCtx: AuthContext,
    input: CreatePaystackSetupRequestInput,
    reqCtx: RequestContext,
  ): Promise<PaystackSetupRequestDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const { created, schoolName } = await withTenant(authCtx.schoolId, async (db) => {
      // One open request at a time. Mirrors the "invitation already pending"
      // rule: a second submission while the operator is mid-way through the
      // first is almost always an impatient re-send, and two rows with
      // different account numbers is exactly the ambiguity that gets money
      // sent to the wrong place.
      const existing = await db.paystackSetupRequest.findFirst({
        where: { schoolId: authCtx.schoolId, status: "PENDING" },
      });
      if (existing) {
        throw new ConflictError(
          "PAYSTACK_SETUP_REQUEST_PENDING",
          "You already have a Paystack setup request in progress. We'll email you when it's ready — reply to that thread if the details need to change.",
        );
      }

      const row = await db.paystackSetupRequest.create({
        data: {
          schoolId: authCtx.schoolId,
          businessName: input.businessName,
          bankName: input.bankName,
          accountNumber: input.accountNumber,
          accountName: input.accountName,
          contactName: input.contactName,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          submittedBy: authCtx.userId,
        },
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "paystack.setup_requested",
          entityType: "paystack_setup_request",
          entityId: row.id,
          ipAddress: reqCtx.ipAddress,
          // Last 4 only — the audit trail records THAT an account number was
          // submitted and enough to recognise which, never the number itself.
          // Same contract as bvn.service.ts's reveal metadata.
          metadata: {
            bankName: row.bankName,
            accountNumberLast4: row.accountNumber.slice(-4),
            businessName: row.businessName,
          },
        },
      });

      const school = await db.school.findUnique({
        where: { id: authCtx.schoolId },
        select: { name: true },
      });

      return { created: row, schoolName: school?.name ?? "Unknown school" };
    });

    await this.notify(created.id, schoolName);

    return toDto(created);
  }

  // Best-effort notification. Carries school name + request id + a link and
  // NOTHING else — no bank name, no account number, no contact details (D1).
  // payments@schoolkit.ng is an ImprovMX forwarder relaying to an ordinary
  // mailbox, which is the wrong place for banking data to come to rest.
  private async notify(requestId: string, schoolName: string): Promise<void> {
    const to = this.config.get<string>("PAYSTACK_SETUP_EMAIL");
    if (!to) {
      // No silent default: a missing address must be visible in the logs
      // rather than guessed at. The request is already committed and will
      // still appear in the operator's queue, so this is degraded, not lost.
      this.logger.error(
        `PAYSTACK_SETUP_EMAIL is not configured — no notification sent for setup request ${requestId}. The request IS saved and visible in the platform-admin dashboard.`,
      );
      return;
    }

    const dashboardUrl = `${this.config.get<string>("WEB_BASE_URL") ?? "http://localhost:3001"}/super-admin/dashboard`;

    try {
      await this.email.send({
        to,
        subject: `Paystack setup request — ${schoolName}`,
        html: `<p><strong>${schoolName}</strong> has requested Paystack setup.</p><p>Request ID: <code>${requestId}</code></p><p>Banking details are deliberately not included in this email. Open the platform-admin dashboard to review them:</p><p><a href="${dashboardUrl}">${dashboardUrl}</a></p>`,
      });
    } catch (err) {
      this.logger.error(
        `Paystack setup notification failed for request ${requestId}: ${String(err)}. The request IS saved and visible in the platform-admin dashboard.`,
      );
    }
  }
}

interface PaystackSetupRow {
  id: string;
  status: string;
  businessName: string;
  submittedAt: Date;
  fulfilledAt: Date | null;
  subaccountCode: string | null;
  notes: string | null;
}

function toDto(row: PaystackSetupRow): PaystackSetupRequestDto {
  return {
    id: row.id,
    status: row.status as PaystackSetupStatus,
    businessName: row.businessName,
    submittedAt: row.submittedAt.toISOString(),
    fulfilledAt: row.fulfilledAt?.toISOString() ?? null,
    subaccountCode: row.subaccountCode,
    // Only surfaced on REJECTED — a fulfilment note is an operator's internal
    // record, not something the school asked for or should be shown.
    notes: row.status === "REJECTED" ? row.notes : null,
  };
}
