import { Injectable } from "@nestjs/common";

import { withTenant, type PrismaClient } from "@school-kit/db";
import {
  isCurrentConsent,
  NotFoundError,
  PARENT_CONSENT_VERSION,
  SCHOOL_CONSENT_VERSION,
  type GuardianConsentDto,
  type SchoolDataProtectionDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context.js";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check.js";

// Data protection consent (docs/modules/data-protection.md). Two records,
// each with the wording version agreed to: the school owner's confirmation
// (schools.ndpr_consent_*) and each parent's agreement to the privacy policy
// and terms (guardians.portal_consent_*). When the wording changes, the
// version moves and both are asked again.

interface RequestContext {
  ipAddress: string | null;
}

export const AUDIT = {
  schoolConfirmed: "data_protection.school_confirmed",
  guardianConsented: "data_protection.guardian_consented",
} as const;

@Injectable()
export class DataProtectionService {
  /** The school's confirmation. Any member of staff may read it. */
  async school(authCtx: AuthContext): Promise<SchoolDataProtectionDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const school = await db.school.findUnique({
        where: { id: authCtx.schoolId },
        select: { ndprConsent: true, ndprConsentAt: true, ndprConsentVersion: true, ndprConsentBy: true },
      });
      if (!school) throw new NotFoundError("School not found.");
      const by = school.ndprConsentBy
        ? await db.user.findUnique({ where: { id: school.ndprConsentBy }, select: { firstName: true, lastName: true } })
        : null;
      return {
        confirmedAt: school.ndprConsent ? (school.ndprConsentAt?.toISOString() ?? null) : null,
        version: school.ndprConsentVersion,
        confirmedByName: by ? `${by.firstName} ${by.lastName}` : null,
        currentVersion: SCHOOL_CONSENT_VERSION,
        current: school.ndprConsent && isCurrentConsent(school.ndprConsentVersion, SCHOOL_CONSENT_VERSION),
      };
    });
  }

  /** The owner confirms the current wording. Owner only: it binds the school. */
  async confirmSchool(authCtx: AuthContext, reqCtx: RequestContext): Promise<SchoolDataProtectionDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner"]);
    const now = new Date();
    await withTenant(authCtx.schoolId, async (db) => {
      await db.school.update({
        where: { id: authCtx.schoolId },
        data: { ndprConsent: true, ndprConsentAt: now, ndprConsentVersion: SCHOOL_CONSENT_VERSION, ndprConsentBy: authCtx.userId },
      });
      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: AUDIT.schoolConfirmed,
          entityType: "school",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: { version: SCHOOL_CONSENT_VERSION, at: now.toISOString() },
        },
      });
    });
    return this.school(authCtx);
  }

  /** A parent's own agreement. */
  async guardian(schoolId: string, guardianId: string): Promise<GuardianConsentDto> {
    const row = await withTenant(schoolId, (db) =>
      db.guardian.findUnique({ where: { id: guardianId }, select: { portalConsentAt: true, portalConsentVersion: true } }),
    );
    if (!row) throw new NotFoundError("Account not found.");
    return {
      acceptedAt: row.portalConsentAt?.toISOString() ?? null,
      version: row.portalConsentVersion,
      currentVersion: PARENT_CONSENT_VERSION,
      current: row.portalConsentAt !== null && isCurrentConsent(row.portalConsentVersion, PARENT_CONSENT_VERSION),
    };
  }

  /** The parent agrees to the current privacy policy and terms. */
  async consentGuardian(schoolId: string, guardianId: string, reqCtx: RequestContext): Promise<GuardianConsentDto> {
    const now = new Date();
    await withTenant(schoolId, async (db) => {
      const updated = await db.guardian.updateMany({
        where: { id: guardianId },
        data: { portalConsentAt: now, portalConsentVersion: PARENT_CONSENT_VERSION },
      });
      if (updated.count === 0) throw new NotFoundError("Account not found.");
      await db.auditLog.create({
        data: {
          schoolId,
          userId: null,
          action: AUDIT.guardianConsented,
          entityType: "guardian",
          entityId: guardianId,
          ipAddress: reqCtx.ipAddress,
          metadata: { version: PARENT_CONSENT_VERSION, at: now.toISOString() },
        },
      });
    });
    return this.guardian(schoolId, guardianId);
  }
}

/** 1 while the owner has not confirmed the current wording, for the dashboard. Runs on the caller's tenant client. */
export async function dataProtectionUnconfirmed(db: PrismaClient, schoolId: string): Promise<number> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { ndprConsent: true, ndprConsentVersion: true } });
  if (!school) return 0;
  return school.ndprConsent && isCurrentConsent(school.ndprConsentVersion, SCHOOL_CONSENT_VERSION) ? 0 : 1;
}
