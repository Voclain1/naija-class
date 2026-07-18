import { Injectable } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import type {
  NotificationPreferenceDto,
  UpdateNotificationPreferencesInput,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

const AUDIT = {
  update: "notification-preferences.update",
} as const;

// Schema defaults (matches schema.prisma's @default values). A school with
// no row yet reads these back rather than 404ing or auto-creating a row on
// first GET — the row is only created on first PUT (see upsert in update()
// below). Every enforcement call site (guardian-invite, fee reminders) goes
// through getEnabledChannels(), which applies the same defaults.
const DEFAULTS = { emailEnabled: true, smsEnabled: false, pushEnabled: false } as const;

const SELECT = {
  id: true,
  emailEnabled: true,
  smsEnabled: true,
  pushEnabled: true,
  updatedBy: true,
  updatedAt: true,
} as const;

function toDto(row: {
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
  updatedBy: string;
  updatedAt: Date;
}): NotificationPreferenceDto {
  return {
    emailEnabled: row.emailEnabled,
    smsEnabled: row.smsEnabled,
    pushEnabled: row.pushEnabled,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class NotificationPreferencesService {
  async get(authCtx: AuthContext): Promise<NotificationPreferenceDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const row = await db.notificationPreference.findUnique({
        where: { schoolId: authCtx.schoolId },
        select: SELECT,
      });
      if (!row) {
        return { ...DEFAULTS, updatedBy: null, updatedAt: null };
      }
      return toDto(row);
    });
  }

  async update(
    authCtx: AuthContext,
    input: UpdateNotificationPreferencesInput,
    reqCtx: RequestContext,
  ): Promise<NotificationPreferenceDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return withTenant(authCtx.schoolId, async (db) => {
      const updated = await db.notificationPreference.upsert({
        where: { schoolId: authCtx.schoolId },
        create: {
          schoolId: authCtx.schoolId,
          emailEnabled: input.emailEnabled,
          smsEnabled: input.smsEnabled,
          updatedBy: authCtx.userId,
        },
        update: {
          emailEnabled: input.emailEnabled,
          smsEnabled: input.smsEnabled,
          updatedBy: authCtx.userId,
        },
        select: SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.update,
          entityType: "notification_preference",
          entityId: updated.id,
          ipAddress: reqCtx.ipAddress,
          metadata: { emailEnabled: input.emailEnabled, smsEnabled: input.smsEnabled },
        },
      });

      return toDto(updated);
    });
  }

  // Enforcement helper — the acceptance criterion this whole slice hinges
  // on: "a school with SMS disabled sends no Termii messages regardless of
  // event type" (docs/modules/phase-4.md §6 item 6). Callers (guardian
  // invite, fee reminders) call this AFTER their own withTenant block has
  // closed (matches GuardiansService.invite's existing shape, where the
  // console-log/send happens outside the transaction), so this method opens
  // its own tenant-scoped read rather than assuming an open transaction.
  // No permission check here — this is an internal service-to-service call,
  // not an admin-facing endpoint; the caller already authorized its own
  // action (e.g. guardian.invite) before reaching this point.
  async getEnabledChannels(schoolId: string): Promise<{ email: boolean; sms: boolean }> {
    return withTenant(schoolId, async (db) => {
      const row = await db.notificationPreference.findUnique({
        where: { schoolId },
        select: { emailEnabled: true, smsEnabled: true },
      });
      return row
        ? { email: row.emailEnabled, sms: row.smsEnabled }
        : { email: DEFAULTS.emailEnabled, sms: DEFAULTS.smsEnabled };
    });
  }
}
