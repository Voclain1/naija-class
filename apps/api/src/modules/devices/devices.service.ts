import { Injectable, Logger } from "@nestjs/common";

import { withTenant } from "@school-kit/db";
import type { RegisterDeviceInput, RegisterDeviceResponse } from "@school-kit/types";

import type { GuardianAuthContext } from "../../common/auth/guardian-auth-context";
import type { StudentAuthContext } from "../../common/auth/student-auth-context";

// Phase 6 / Slice 5 (D34, D35, D40) — Expo push device registration.
//
// Both principals register through this one service, but never share a row:
// the OWNER is derived from the session, never accepted from the body. That
// is the same rule D27 established for guardian actions on a child, applied
// to the principal's own device.
//
// No SECURITY DEFINER function anywhere here. Every call arrives inside an
// authenticated session, so a school_id is already known and these are
// ordinary withTenant writes governed by RLS — the pre-tenant chicken-and-egg
// that forces SD elsewhere in the auth layer does not arise.

/** A token that is currently believed reachable, with who owns it. */
export interface LiveDeviceToken {
  id: string;
  expoPushToken: string;
}

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  async registerForGuardian(
    ctx: GuardianAuthContext,
    input: RegisterDeviceInput,
  ): Promise<RegisterDeviceResponse> {
    return this.register(ctx.schoolId, "GUARDIAN", ctx.guardianId, input);
  }

  async registerForStudent(
    ctx: StudentAuthContext,
    input: RegisterDeviceInput,
  ): Promise<RegisterDeviceResponse> {
    return this.register(ctx.schoolId, "STUDENT", ctx.studentId, input);
  }

  /**
   * Claim a token for the signed-in principal.
   *
   * WHY THIS IS AN UPSERT ON THE TOKEN, NOT AN INSERT. One physical install
   * owns exactly one Expo token, and the app re-registers on every launch.
   * Inserting would either accumulate duplicates or fail on the unique index
   * at the second launch. Upserting also handles the shared-family-handset
   * case correctly and deliberately: when a parent signs out and their child
   * signs in on the same phone, the row is REASSIGNED to the child rather
   * than duplicated — so the parent stops receiving notifications on a device
   * they no longer hold a session on. Both owner columns are written on every
   * update precisely so the previous owner is cleared rather than left
   * alongside the new one, which the CHECK constraint would reject anyway.
   */
  private async register(
    schoolId: string,
    principalType: "GUARDIAN" | "STUDENT",
    ownerId: string,
    input: RegisterDeviceInput,
  ): Promise<RegisterDeviceResponse> {
    const owner =
      principalType === "GUARDIAN"
        ? { guardianId: ownerId, studentId: null }
        : { guardianId: null, studentId: ownerId };

    await withTenant(schoolId, async (db) => {
      await db.deviceToken.upsert({
        where: { expoPushToken: input.expoPushToken },
        create: {
          schoolId,
          principalType,
          ...owner,
          expoPushToken: input.expoPushToken,
          platform: input.platform,
        },
        update: {
          // schoolId is rewritten too: a device legitimately moves between
          // schools when a parent with children at two schools signs in to
          // the other one. RLS's WITH CHECK still governs what may be
          // written, so this can only ever move a row INTO the caller's own
          // tenant, never out of someone else's into theirs unseen.
          schoolId,
          principalType,
          ...owner,
          platform: input.platform,
          lastSeenAt: new Date(),
        },
      });
    });

    // Deliberately not logged with the token value. It is not a credential,
    // but it is a per-device identifier and CLAUDE.md's rule is that the
    // logger redacts identifying values rather than that each caller decides.
    return { registered: true, platform: input.platform };
  }

  async unregisterForGuardian(ctx: GuardianAuthContext, expoPushToken: string): Promise<void> {
    return this.unregister(ctx.schoolId, { guardianId: ctx.guardianId }, expoPushToken);
  }

  async unregisterForStudent(ctx: StudentAuthContext, expoPushToken: string): Promise<void> {
    return this.unregister(ctx.schoolId, { studentId: ctx.studentId }, expoPushToken);
  }

  /**
   * Release a token on sign-out (D40).
   *
   * Scoped to the caller's own id as well as the token, so one principal
   * cannot unregister another's device by guessing a token. Deleting a row
   * that does not exist is NOT an error: sign-out must succeed even if the
   * token was already pruned by the receipt job, and a 404 here would leave
   * a user unable to complete a sign-out they have every right to complete.
   */
  private async unregister(
    schoolId: string,
    owner: { guardianId: string } | { studentId: string },
    expoPushToken: string,
  ): Promise<void> {
    await withTenant(schoolId, async (db) => {
      await db.deviceToken.deleteMany({ where: { expoPushToken, ...owner } });
    });
  }
}
