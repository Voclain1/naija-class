import { Injectable, Logger } from "@nestjs/common";
import { withTenant } from "@school-kit/db";
import {
  ConflictError,
  ForbiddenError,
  SCHOOL_AI_TERMS_POINTS,
  SCHOOL_AI_TERMS_VERSION,
  UnauthorizedError,
  type SchoolAiTermsDto,
} from "@school-kit/types";

import { aiTermsWordingHash, termsAcceptedNow } from "../../common/ai-release/ai-governance.js";
import type { AuthContext } from "../../common/auth/auth-context.js";
import { VoiceLedger } from "../assistant-voice/voice-ledger.js";

// The school owner's acceptance of the SchoolKit Assistant AI terms
// (2026-11-22, docs/modules/assistant-ai-governance.md, "School AI terms").
//
// Versioned like the school's data-protection consent: the record holds the
// version AND a hash of the exact wording shown. Append-only: accepting and
// withdrawing are both new rows; the latest decides.
//
// ACCEPTING NEVER ACTIVATES ANYTHING. AI understanding is switched on only by
// the platform admin, per school. Without a current acceptance the model gate
// refuses every turn; withdrawing stops the next turn and ends live voice
// sessions at once.
//
// Owner only: re-read from the database on every write (active, holds the
// owner role at THIS school), never trusted from the session alone.

const AUDIT = { accepted: "school.ai_terms.accepted", withdrawn: "school.ai_terms.withdrawn" } as const;

@Injectable()
export class AiTermsService {
  private readonly logger = new Logger(AiTermsService.name);

  constructor(private readonly voiceLedger: VoiceLedger) {}

  async get(auth: AuthContext): Promise<SchoolAiTermsDto> {
    return withTenant(auth.schoolId, async (db) => {
      const person = await this.person(db, auth);
      return this.dto(db, auth.schoolId, person.isOwner);
    }, { label: "ai-terms-get" });
  }

  async accept(auth: AuthContext, version: string, reqCtx: { ipAddress: string | null }): Promise<SchoolAiTermsDto> {
    if (version !== SCHOOL_AI_TERMS_VERSION) {
      throw new ConflictError("AI_TERMS_VERSION_CHANGED", "These terms have changed. Read the current version and accept it again.", { currentVersion: SCHOOL_AI_TERMS_VERSION });
    }
    return withTenant(auth.schoolId, async (db) => {
      const person = await this.person(db, auth);
      if (!person.isOwner) throw new ForbiddenError("AI_TERMS_OWNER_ONLY", "Only the school's owner can accept the AI terms.");
      await db.schoolAiTermsEvent.create({
        data: { schoolId: auth.schoolId, action: "ACCEPT", version, wordingSha256: aiTermsWordingHash(), userId: auth.userId, ipAddress: reqCtx.ipAddress },
      });
      await db.auditLog.create({
        data: { schoolId: auth.schoolId, userId: auth.userId, action: AUDIT.accepted, entityType: "school", entityId: auth.schoolId, ipAddress: reqCtx.ipAddress, metadata: { version } },
      });
      return this.dto(db, auth.schoolId, true);
    }, { label: "ai-terms-accept" });
  }

  async withdraw(auth: AuthContext, reqCtx: { ipAddress: string | null }): Promise<SchoolAiTermsDto> {
    const dto = await withTenant(auth.schoolId, async (db) => {
      const person = await this.person(db, auth);
      if (!person.isOwner) throw new ForbiddenError("AI_TERMS_OWNER_ONLY", "Only the school's owner can withdraw the AI terms.");
      await db.schoolAiTermsEvent.create({
        data: { schoolId: auth.schoolId, action: "WITHDRAW", version: SCHOOL_AI_TERMS_VERSION, wordingSha256: aiTermsWordingHash(), userId: auth.userId, ipAddress: reqCtx.ipAddress },
      });
      await db.auditLog.create({
        data: { schoolId: auth.schoolId, userId: auth.userId, action: AUDIT.withdrawn, entityType: "school", entityId: auth.schoolId, ipAddress: reqCtx.ipAddress, metadata: { version: SCHOOL_AI_TERMS_VERSION } },
      });
      return this.dto(db, auth.schoolId, true);
    }, { label: "ai-terms-withdraw" });
    // Live voice sessions end now, not at their next request.
    const ended = await this.voiceLedger.endAll(auth.schoolId, "REVOKED");
    this.logger.log(`AI terms withdrawn: school=${auth.schoolId} voiceSessionsEnded=${ended}`);
    return dto;
  }

  private async person(db: Parameters<Parameters<typeof withTenant>[1]>[0], auth: AuthContext): Promise<{ isOwner: boolean }> {
    const user = await db.user.findFirst({ where: { id: auth.userId, schoolId: auth.schoolId }, select: { isActive: true } });
    if (!user?.isActive) throw new UnauthorizedError("USER_INACTIVE", "Your account is unavailable.");
    const owner = await db.userRole.findFirst({ where: { userId: auth.userId, role: { key: "owner" } }, select: { userId: true } });
    return { isOwner: owner !== null };
  }

  private async dto(db: Parameters<Parameters<typeof withTenant>[1]>[0], schoolId: string, canDecide: boolean): Promise<SchoolAiTermsDto> {
    const latest = await db.schoolAiTermsEvent.findFirst({ where: { schoolId }, orderBy: { recordedAt: "desc" } });
    let byName: string | null = null;
    if (latest) {
      const u = await db.user.findFirst({ where: { id: latest.userId, schoolId }, select: { firstName: true, lastName: true } });
      byName = u ? `${u.firstName} ${u.lastName}` : null;
    }
    return {
      currentVersion: SCHOOL_AI_TERMS_VERSION,
      points: SCHOOL_AI_TERMS_POINTS,
      accepted: termsAcceptedNow(latest),
      latest: latest ? { action: latest.action as "ACCEPT" | "WITHDRAW", version: latest.version, at: latest.recordedAt.toISOString(), byName } : null,
      canDecide,
    };
  }
}
