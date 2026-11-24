import { createHash, randomBytes } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { withTenant } from "@school-kit/db";
import { ForbiddenError, ValidationError } from "@school-kit/types";

import type { GuardianAuthContext } from "../../../common/auth/guardian-auth-context";
import { normalizeNigerianPhone } from "../../../common/termii/termii.service";

export const WHATSAPP_CONSENT_VERSION = "whatsapp-transactional-v1";
export const WHATSAPP_CONSENT_WORDING = "I agree to receive transactional school messages on WhatsApp at this number. I can withdraw in the parent portal or reply STOP.";

export function normalizeGuardianWhatsAppPhone(value: string): string | null {
  if (!/^[+0-9 ().-]+$/.test(value)) return null;
  const compact = value.replace(/[ ().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(compact)) return compact.slice(1);
  return normalizeNigerianPhone(compact);
}

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

@Injectable()
export class GuardianMessagingConsentService {
  async createChallenge(auth: GuardianAuthContext, consentVersion: string) {
    if (consentVersion !== WHATSAPP_CONSENT_VERSION) throw new ValidationError("Review the current WhatsApp consent wording.");
    return withTenant(auth.schoolId, async (db) => {
      await db.$queryRaw`SELECT id FROM schools WHERE id = ${auth.schoolId} FOR UPDATE`;
      const connection = await db.messagingSchoolMetaConnection.findFirst({
        where: { schoolId: auth.schoolId, disconnectedAt: null, activationPending: false, encryptedToken: { not: null } },
        select: { displayPhone: true },
      });
      const guardian = await db.guardian.findFirst({
        where: { id: auth.guardianId, schoolId: auth.schoolId, portalDisabledAt: null, emailVerified: true },
        select: { phone: true },
      });
      const phone = guardian && normalizeGuardianWhatsAppPhone(guardian.phone);
      if (!connection?.displayPhone || !phone) throw new ForbiddenError("WhatsApp verification is unavailable for this account.");
      const challenge = randomBytes(16).toString("hex");
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + 10 * 60_000);
      const data = {
        phone, consentVersion, challengeHash: hash(challenge), challengeIssuedAt: issuedAt,
        challengeExpiresAt: expiresAt, verifiedAt: null, withdrawnAt: null,
      };
      await db.messagingGuardianConsent.upsert({
        where: { schoolId_guardianId: { schoolId: auth.schoolId, guardianId: auth.guardianId } },
        create: { ...data, schoolId: auth.schoolId, guardianId: auth.guardianId }, update: data,
      });
      const text = encodeURIComponent(`SCHOOLKIT CONSENT ${challenge}`);
      return { url: `https://wa.me/${connection.displayPhone}?text=${text}`, expiresAt: expiresAt.toISOString() };
    });
  }

  async withdraw(auth: GuardianAuthContext): Promise<void> {
    await withTenant(auth.schoolId, async (db) => {
      const withdrawn = await db.messagingGuardianConsent.updateMany({
        where: { schoolId: auth.schoolId, guardianId: auth.guardianId, withdrawnAt: null },
        data: { withdrawnAt: new Date(), challengeHash: null, challengeExpiresAt: null, challengeIssuedAt: null },
      });
      if (withdrawn.count) await db.auditLog.create({ data: {
        schoolId: auth.schoolId, action: "messaging.whatsapp.consent.withdraw",
        entityType: "guardian", entityId: auth.guardianId, metadata: { source: "portal" },
      } });
    });
  }

  /** Only called for inbound messages authenticated by the Meta webhook. */
  async applyVerifiedInbound(input: {
    schoolId: string; wabaId: string; phoneNumberId: string; from: string; text: string; occurredAt: Date;
  }): Promise<void> {
    const command = input.text.trim();
    const challenge = /^SCHOOLKIT CONSENT ([0-9a-f]{32})$/.exec(command)?.[1];
    const stop = /^(?:STOP|UNSUBSCRIBE)$/i.test(command);
    if ((!challenge && !stop) || !/^[1-9]\d{7,14}$/.test(input.from)) return;
    await withTenant(input.schoolId, async (db) => {
      // Serialize inbound activation with account disconnect. Only an active,
      // school-owned binding may complete a consent challenge.
      await db.$queryRaw`SELECT id FROM schools WHERE id = ${input.schoolId} FOR UPDATE`;
      const binding = await db.messagingSchoolMetaConnection.findFirst({
        where: {
          schoolId: input.schoolId, wabaId: input.wabaId, phoneNumberId: input.phoneNumberId,
          disconnectedAt: null, activationPending: false,
        },
      });
      if (!binding) return;
      const where = { schoolId: input.schoolId, phone: input.from };
      if (stop) {
        const revoked = await db.messagingGuardianConsent.findMany({
          where: { ...where, withdrawnAt: null, OR: [{ verifiedAt: null }, { verifiedAt: { lte: input.occurredAt } }] },
          select: { guardianId: true },
        });
        for (const { guardianId } of revoked) {
          const result = await db.messagingGuardianConsent.updateMany({
            where: { ...where, guardianId, withdrawnAt: null, OR: [{ verifiedAt: null }, { verifiedAt: { lte: input.occurredAt } }] },
            data: { withdrawnAt: new Date(), challengeHash: null, challengeExpiresAt: null, challengeIssuedAt: null },
          });
          if (result.count) await db.auditLog.create({ data: {
            schoolId: input.schoolId, action: "messaging.whatsapp.consent.withdraw",
            entityType: "guardian", entityId: guardianId, metadata: { source: "whatsapp" },
          } });
        }
        return;
      }
      if (!challenge) return;
      const pending = await db.messagingGuardianConsent.findFirst({
        where: {
          ...where, challengeHash: hash(challenge), verifiedAt: null, withdrawnAt: null,
          challengeExpiresAt: { gt: new Date() },
          // Meta's timestamp has second resolution.
          challengeIssuedAt: { lte: new Date(input.occurredAt.getTime() + 999) },
        },
        include: { guardian: { select: { phone: true, portalDisabledAt: true } } },
      });
      if (!pending || pending.guardian.portalDisabledAt || normalizeGuardianWhatsAppPhone(pending.guardian.phone) !== input.from) return;
      const updated = await db.messagingGuardianConsent.updateMany({
        where: { ...where, guardianId: pending.guardianId, challengeHash: hash(challenge), withdrawnAt: null },
        data: { verifiedAt: input.occurredAt, challengeHash: null, challengeExpiresAt: null },
      });
      if (updated.count) await db.auditLog.create({ data: {
        schoolId: input.schoolId, action: "messaging.whatsapp.consent.grant",
        entityType: "guardian", entityId: pending.guardianId,
        metadata: { version: WHATSAPP_CONSENT_VERSION, source: "verified-whatsapp" },
      } });
    });
  }

  /** Recheck immediately before a new tenant send. Legacy SMS is independent. */
  async verifiedRecipient(schoolId: string, guardianId: string): Promise<string | null> {
    return withTenant(schoolId, async (db) => {
      const consent = await db.messagingGuardianConsent.findFirst({
        where: { schoolId, guardianId, consentVersion: WHATSAPP_CONSENT_VERSION, verifiedAt: { not: null }, withdrawnAt: null },
        include: { guardian: { select: { phone: true, portalDisabledAt: true } } },
      });
      return consent && !consent.guardian.portalDisabledAt && normalizeGuardianWhatsAppPhone(consent.guardian.phone) === consent.phone
        ? `+${consent.phone}` : null;
    });
  }
}
