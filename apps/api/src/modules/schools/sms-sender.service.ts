import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

import { withTenant } from "@school-kit/db";
import { ConflictError, type RequestSmsSenderInput, type SmsSenderDto, type SmsSenderStatus } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { EmailService } from "../../common/email/email.service";
import { escapeHtml } from "../payments/receipt";

// The school's own SMS sender name (docs/modules/school-identity.md slice 2).
//
// The networks approve a sender name against the school's CAC registration,
// so the school only ASKS here. The platform operator submits the request and
// records the outcome (PATCH /platform-admin/schools/:id/sms-sender); only an
// APPROVED name is ever sent (smsSenderFor, common/termii/sms-sender.ts). Same division of labour as
// Paystack assisted setup, without a table of its own: one live request per
// school, and the history is the audit log.

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface SmsSenderColumns {
  smsSenderId: string | null;
  smsSenderStatus: SmsSenderStatus;
  smsSenderRequestedAt: Date | null;
  smsSenderDecidedAt: Date | null;
}

const SMS_SENDER_SELECT = {
  smsSenderId: true,
  smsSenderStatus: true,
  smsSenderRequestedAt: true,
  smsSenderDecidedAt: true,
} as const;

@Injectable()
export class SmsSenderService {
  private readonly logger = new Logger(SmsSenderService.name);

  constructor(
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  async get(authCtx: AuthContext): Promise<SmsSenderDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    const school = await withTenant(authCtx.schoolId, (db) =>
      db.school.findUniqueOrThrow({ where: { id: authCtx.schoolId }, select: SMS_SENDER_SELECT }),
    );
    return toDto(school);
  }

  async request(authCtx: AuthContext, input: RequestSmsSenderInput, reqCtx: RequestContext): Promise<SmsSenderDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const { dto, schoolName, changed } = await withTenant(authCtx.schoolId, async (db) => {
      const current = await db.school.findUniqueOrThrow({
        where: { id: authCtx.schoolId },
        select: { name: true, ...SMS_SENDER_SELECT },
      });

      const same = current.smsSenderId?.toLowerCase() === input.senderId.toLowerCase();
      if (same && current.smsSenderStatus === "APPROVED") {
        throw new ConflictError("SMS_SENDER_ALREADY_APPROVED", "This sender name is already approved for your school.");
      }
      // Asking again for the name already waiting changes nothing, and must
      // not tell the operator twice.
      if (same && current.smsSenderStatus === "REQUESTED") {
        return { dto: toDto(current), schoolName: current.name, changed: false };
      }

      // A new name replaces whatever was there, approved or not: from now
      // until the networks clear it, the school's SMS go out under SchoolKit's
      // name. The settings page says so before the school asks.
      const updated = await db.school.update({
        where: { id: authCtx.schoolId },
        data: {
          smsSenderId: input.senderId,
          smsSenderStatus: "REQUESTED",
          smsSenderRequestedAt: new Date(),
          smsSenderDecidedAt: null,
        },
        select: SMS_SENDER_SELECT,
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "sms_sender.requested",
          entityType: "school",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            senderId: input.senderId,
            previous: current.smsSenderId ? { senderId: current.smsSenderId, status: current.smsSenderStatus } : null,
          },
        },
      });
      return { dto: toDto(updated), schoolName: current.name, changed: true };
    });

    if (changed) await this.notify(schoolName, input.senderId);
    return dto;
  }

  // Tells the platform operator there is a request to submit. The request is
  // saved and on the platform-admin roster whether or not this email goes.
  private async notify(schoolName: string, senderId: string): Promise<void> {
    const to = this.config.get<string>("SMS_SENDER_REQUEST_EMAIL") ?? this.config.get<string>("PAYSTACK_SETUP_EMAIL");
    if (!to) {
      this.logger.error(
        "Neither SMS_SENDER_REQUEST_EMAIL nor PAYSTACK_SETUP_EMAIL is set — no one was told about an SMS sender request. It is saved and on the platform-admin roster.",
      );
      return;
    }
    const dashboardUrl = `${this.config.get<string>("WEB_BASE_URL") ?? "http://localhost:3001"}/super-admin/dashboard`;
    try {
      await this.email.send({
        to,
        purpose: "sms-sender-request",
        subject: `SMS sender name request — ${schoolName}`,
        html:
          `<p><strong>${escapeHtml(schoolName)}</strong> has asked to send SMS as ` +
          `<strong>${escapeHtml(senderId)}</strong>.</p>` +
          `<p>Ask the school for its CAC certificate and a request letter on its letterhead, submit the name ` +
          `through SchoolKit's Termii account, then record the networks' decision on the platform-admin dashboard:</p>` +
          `<p><a href="${dashboardUrl}">${dashboardUrl}</a></p>`,
      });
    } catch (err) {
      this.logger.error(`SMS sender request notification failed: ${String(err)}. It is saved and on the roster.`);
    }
  }
}

function toDto(row: SmsSenderColumns): SmsSenderDto {
  return {
    senderId: row.smsSenderId,
    status: row.smsSenderStatus,
    requestedAt: row.smsSenderRequestedAt?.toISOString() ?? null,
    decidedAt: row.smsSenderDecidedAt?.toISOString() ?? null,
  };
}
