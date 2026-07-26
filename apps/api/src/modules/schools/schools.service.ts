import * as crypto from "node:crypto";
import { Injectable } from "@nestjs/common";

import { Prisma, basePrisma, withTenant } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  type OnboardingStep1Input,
  type OnboardingStep2Input,
  type OnboardingStep3Input,
  type OnboardingStep4Input,
  type OnboardingStep5Input,
  type OnboardingStepResponse,
  type PatchSchoolInput,
  type SchoolLogoUrlDto,
  type SchoolMeDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { redactEmail } from "../../common/redact";
import { StorageService } from "../../common/storage/storage.service";

const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// Visual/UX overhaul initiative (2026-07-26) — real logo upload, replacing
// the raw URL text field. See step2-branding.dto.ts's header comment for
// the full history of why this existed as a text field for so long.
export const LOGO_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB — a logo, not a document
const LOGO_EXT_BY_MIME = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const satisfies Record<string, "png" | "jpg" | "webp">;
type LogoExt = (typeof LOGO_EXT_BY_MIME)[keyof typeof LOGO_EXT_BY_MIME];
// Long relative to receipts' 15 minutes — a logo is displayed persistently
// in the topbar for the life of a session, not fetched once for a single
// click-through. See SchoolLogoUrlDto's own comment in school.dto.ts.
const LOGO_URL_TTL_SECONDS = 60 * 60;

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

// Per-step payload union. The controller validates the raw body against the
// right Zod schema based on the :step param, so by the time the service sees
// it, `payload` is correctly shaped for that step. We keep the discriminator
// (step) explicit so future drift is a type error, not a runtime crash.
export type OnboardingStepPayload =
  | { step: 1; data: OnboardingStep1Input }
  | { step: 2; data: OnboardingStep2Input }
  | { step: 3; data: OnboardingStep3Input }
  | { step: 4; data: OnboardingStep4Input }
  | { step: 5; data: OnboardingStep5Input };

@Injectable()
export class SchoolsService {
  constructor(private readonly storage: StorageService) {}

  // GET /schools/me — owner/admin only (Phase 2 slice 9 cp2, WS4). Returns the
  // authed user's school config. Teachers don't need it: the topbar reads the
  // school name from /auth/me (authCtx.school) and the subject-attendance flag
  // rides on /teacher-scope/me — so tightening this closes the slice-8-cp2
  // finding (any authed user could read school config) without breaking the
  // teacher portal. Role-asserted at the service (matching patchMe) rather than
  // @Permissions("school.read"): the latter would force PermissionsGuard onto
  // the whole Phase-0 schools controller (incl. the onboarding handler, which
  // has no clean permission) — deferred with the rest of the Phase-0 retrofit.
  async findMe(authCtx: AuthContext): Promise<SchoolMeDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);
    return loadSchoolOrThrow(authCtx.schoolId);
  }

  // PATCH /schools/me — owner or admin updates the school's basics and/or
  // branding. Distinct from the wizard's POST /onboarding/:step: this is the
  // everyday edit path, callable both during onboarding (the wizard's
  // go-back-to-edit affordance) and after (settings page in Phase 0). It
  // does NOT touch onboarding_step or status — those are wizard-only.
  async patchMe(
    authCtx: AuthContext,
    input: PatchSchoolInput,
    reqCtx: RequestContext,
  ): Promise<SchoolMeDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    // Build the update payload field-by-field. `motto` and `address` are
    // nullable on the model; the Zod schema strips them when absent but if
    // the caller sent the field as undefined we still want a no-op rather
    // than overwriting with NULL. (.strict() on the schema already rejects
    // unknown keys, so the only fields here are the known seven.)
    const data: Prisma.SchoolUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.motto !== undefined) data.motto = input.motto;
    if (input.address !== undefined) data.address = input.address;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.email !== undefined) data.email = input.email;
    if (input.primaryColor !== undefined) data.primaryColor = input.primaryColor;
    // Slice 8 — the subject-attendance opt-in rides this same PATCH (owner/admin,
    // school.update audit). Reaching this endpoint is itself the enable path, so
    // it carries no opt-in gate.
    if (input.subjectAttendanceEnabled !== undefined) {
      data.subjectAttendanceEnabled = input.subjectAttendanceEnabled;
    }

    return this.updateSchoolWithAudit(authCtx, data, "school.update", reqCtx, {
      changed: Object.keys(data),
    });
  }

  // POST /schools/me/onboarding/:step — owner-only. Three gates run in order:
  //   1. role check (owner)
  //   2. status check (must still be ONBOARDING)
  //   3. step gate (onboarding_step === step - 1)
  // Each step then writes its step-specific fields, advances onboarding_step,
  // and the final step also flips status to ACTIVE.
  async advanceOnboarding(
    authCtx: AuthContext,
    payload: OnboardingStepPayload,
    reqCtx: RequestContext,
  ): Promise<OnboardingStepResponse> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner"]);

    const school = await basePrisma.school.findUnique({
      where: { id: authCtx.schoolId },
      select: { id: true, status: true, onboardingStep: true },
    });
    if (!school) {
      // AuthGuard already proved a session exists for this schoolId, so this
      // path is structurally unreachable in practice — keep it as a safety
      // belt so a bizarre race doesn't 500 the user.
      throw new NotFoundError("School not found.");
    }
    if (school.status !== "ONBOARDING") {
      throw new ConflictError(
        "ONBOARDING_ALREADY_COMPLETE",
        "Onboarding has already been completed for this school.",
      );
    }
    if (school.onboardingStep !== payload.step - 1) {
      throw new ConflictError(
        "INVALID_ONBOARDING_STEP",
        `Cannot advance to step ${payload.step} from completed step ${school.onboardingStep}.`,
      );
    }

    switch (payload.step) {
      case 1:
        return this.applyStep1(authCtx, payload.data, reqCtx);
      case 2:
        return this.applyStep2(authCtx, payload.data, reqCtx);
      case 3:
        return this.applyStep3(authCtx, payload.data, reqCtx);
      case 4:
        return this.applyStep4(authCtx, payload.data, reqCtx);
      case 5:
        return this.applyStep5(authCtx, reqCtx);
    }
  }

  private async applyStep1(
    authCtx: AuthContext,
    data: OnboardingStep1Input,
    reqCtx: RequestContext,
  ): Promise<OnboardingStepResponse> {
    const school = await this.updateSchoolWithAudit(
      authCtx,
      {
        name: data.name,
        motto: data.motto ?? null,
        address: data.address ?? null,
        phone: data.phone,
        email: data.email,
        onboardingStep: 1,
      },
      "onboarding.step1_complete",
      reqCtx,
      {
        schoolName: data.name,
        email: redactEmail(data.email),
        // phone deliberately omitted from audit metadata to follow the
        // "no PII in logs" rule; we'll capture redacted phone in Phase 3
        // once redactPhone exists.
      },
    );
    return { school };
  }

  private async applyStep2(
    authCtx: AuthContext,
    data: OnboardingStep2Input,
    reqCtx: RequestContext,
  ): Promise<OnboardingStepResponse> {
    // primaryColor is optional. An empty payload {} is a valid advance — a
    // school with no chosen colour still moves on. Logo is no longer part of
    // this step's payload at all — it's uploaded via the separate
    // POST /schools/me/logo (see uploadLogo() below), which the form calls
    // independently the moment a file is picked, same as expense receipts.
    const school = await this.updateSchoolWithAudit(
      authCtx,
      {
        primaryColor: data.primaryColor ?? null,
        onboardingStep: 2,
      },
      "onboarding.step2_complete",
      reqCtx,
      {
        primaryColor: data.primaryColor ?? null,
      },
    );
    return { school };
  }

  private async applyStep3(
    authCtx: AuthContext,
    data: OnboardingStep3Input,
    reqCtx: RequestContext,
  ): Promise<OnboardingStepResponse> {
    // Slice 6 creates Invitation rows but does NOT send email (Slice 7 wires
    // SMTP). Names from the form aren't persisted yet — the Invitation table
    // has no first/last name columns. Captured in audit metadata so they're
    // recoverable, and Slice 7 will revisit (either extend the table or
    // adjust the input shape).
    const now = Date.now();
    const expiresAt = new Date(now + INVITATION_TTL_MS);

    const invitationInputs = data.invites.map((invite) => {
      const rawToken = crypto.randomBytes(32).toString("base64url");
      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      return { invite, tokenHash };
    });

    const result = await withTenant(authCtx.schoolId, async (db) => {
      const created = await Promise.all(
        invitationInputs.map(({ invite, tokenHash }) =>
          db.invitation.create({
            data: {
              schoolId: authCtx.schoolId,
              email: invite.email,
              roleKey: "admin",
              tokenHash,
              invitedBy: authCtx.userId,
              expiresAt,
            },
            select: { id: true },
          }),
        ),
      );

      const updated = await db.school.update({
        where: { id: authCtx.schoolId },
        data: { onboardingStep: 3 },
        select: SCHOOL_RESPONSE_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "onboarding.step3_complete",
          entityType: "school",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            invitedCount: created.length,
            invitationIds: created.map((c) => c.id),
            invites: data.invites.map((i) => ({
              email: redactEmail(i.email),
              firstName: i.firstName ?? null,
              lastName: i.lastName ?? null,
            })),
          },
        },
      });

      return updated;
    });

    return { school: toSchoolMeDto(result) };
  }

  private async applyStep4(
    authCtx: AuthContext,
    _data: OnboardingStep4Input,
    reqCtx: RequestContext,
  ): Promise<OnboardingStepResponse> {
    // _data only carries `ndprConsent: true`, which the Zod literal already
    // guaranteed. The audit interest is the new ndprConsentAt timestamp, so
    // we re-stamp it here (overwriting the one signup set) — that's the
    // value a future compliance audit would point at as "the moment the
    // user finished reading the policy in the wizard."
    const ndprConsentAt = new Date();
    const school = await this.updateSchoolWithAudit(
      authCtx,
      {
        ndprConsent: true,
        ndprConsentAt,
        onboardingStep: 4,
      },
      "onboarding.step4_complete",
      reqCtx,
      { ndprConsentAt: ndprConsentAt.toISOString() },
    );
    return { school };
  }

  private async applyStep5(
    authCtx: AuthContext,
    reqCtx: RequestContext,
  ): Promise<OnboardingStepResponse> {
    const school = await this.updateSchoolWithAudit(
      authCtx,
      { status: "ACTIVE", onboardingStep: 5 },
      "onboarding.complete",
      reqCtx,
      { completedAt: new Date().toISOString() },
    );
    return { school };
  }

  // POST /schools/me/logo — owner or admin. Multipart upload, separate from
  // patchMe/onboarding the same way expense.receiptUrl is separate from
  // expense create/update — mixing a multipart file with JSON fields in one
  // request is the complexity NestJS's file-upload story handles badly.
  async uploadLogo(
    authCtx: AuthContext,
    file: { buffer: Buffer; mimetype: string },
    reqCtx: RequestContext,
  ): Promise<SchoolMeDto> {
    await assertUserActiveAndHasOneOf(authCtx, ["owner", "admin"]);

    const ext = (LOGO_EXT_BY_MIME as Record<string, LogoExt | undefined>)[file.mimetype];
    if (!ext) {
      throw new ValidationError(
        "INVALID_LOGO_TYPE",
        `Logo must be one of: ${Object.keys(LOGO_EXT_BY_MIME).join(", ")}.`,
      );
    }

    return withTenant(authCtx.schoolId, async (db) => {
      const existing = await db.school.findUniqueOrThrow({
        where: { id: authCtx.schoolId },
        select: { logoUrl: true },
      });

      // school-logo is an extension-bearing key (storage.types.ts explains
      // why) — re-uploading with a DIFFERENT image format leaves the old
      // object behind unless we delete it explicitly first. Same extension
      // (or no previous logo) needs no cleanup: put() overwrites in place.
      const previousExt = parseLogoExt(existing.logoUrl);
      if (previousExt && previousExt !== ext) {
        await this.storage.delete(authCtx.schoolId, { kind: "school-logo", ext: previousExt });
      }

      const logoUrl = await this.storage.put(
        authCtx.schoolId,
        { kind: "school-logo", ext },
        file.buffer,
        file.mimetype,
      );

      const updated = await db.school.update({
        where: { id: authCtx.schoolId },
        data: { logoUrl },
        select: SCHOOL_RESPONSE_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: "school.logo_upload",
          entityType: "school",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata: { mimetype: file.mimetype, size: file.buffer.length },
        },
      });

      return toSchoolMeDto(updated);
    });
  }

  // GET /schools/me/logo-url — any authenticated user of the school. No
  // owner/admin gate: this is read-only branding display (the topbar, for
  // every role), not sensitive config like findMe/patchMe guard.
  async getLogoUrl(authCtx: AuthContext): Promise<SchoolLogoUrlDto> {
    const school = await basePrisma.school.findUnique({
      where: { id: authCtx.schoolId },
      select: { logoUrl: true },
    });
    const ext = parseLogoExt(school?.logoUrl ?? null);
    if (!ext) {
      throw new NotFoundError("No logo has been uploaded for this school.");
    }
    const url = await this.storage.signUrl(
      authCtx.schoolId,
      { kind: "school-logo", ext },
      LOGO_URL_TTL_SECONDS,
    );
    return { url };
  }

  // Shared write helper: schools table update + audit row in one withTenant
  // transaction. schools is NOT under RLS, so the update itself doesn't need
  // the tenant GUC, but audit_logs IS, so we run both inside withTenant so
  // the audit insert satisfies the policy's WITH CHECK.
  private async updateSchoolWithAudit(
    authCtx: AuthContext,
    data: Prisma.SchoolUpdateInput,
    action: string,
    reqCtx: RequestContext,
    metadata: Prisma.InputJsonValue,
  ): Promise<SchoolMeDto> {
    return withTenant(authCtx.schoolId, async (db) => {
      const updated = await db.school.update({
        where: { id: authCtx.schoolId },
        data,
        select: SCHOOL_RESPONSE_SELECT,
      });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action,
          entityType: "school",
          entityId: authCtx.schoolId,
          ipAddress: reqCtx.ipAddress,
          metadata,
        },
      });

      return toSchoolMeDto(updated);
    });
  }
}

// -------------------------------------------------------------------------
// helpers
// -------------------------------------------------------------------------

const SCHOOL_RESPONSE_SELECT = {
  id: true,
  name: true,
  slug: true,
  motto: true,
  logoUrl: true,
  address: true,
  phone: true,
  email: true,
  primaryColor: true,
  status: true,
  onboardingStep: true,
  ndprConsent: true,
  ndprConsentAt: true,
  subjectAttendanceEnabled: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SchoolSelect;

type SchoolRow = Prisma.SchoolGetPayload<{ select: typeof SCHOOL_RESPONSE_SELECT }>;

function toSchoolMeDto(school: SchoolRow): SchoolMeDto {
  return {
    id: school.id,
    name: school.name,
    slug: school.slug,
    motto: school.motto,
    logoUrl: school.logoUrl,
    address: school.address,
    phone: school.phone,
    email: school.email,
    primaryColor: school.primaryColor,
    status: school.status,
    onboardingStep: school.onboardingStep,
    ndprConsent: school.ndprConsent,
    ndprConsentAt: school.ndprConsentAt,
    subjectAttendanceEnabled: school.subjectAttendanceEnabled,
    createdAt: school.createdAt,
    updatedAt: school.updatedAt,
  };
}

// Recovers the school-logo StorageObjectKey's `ext` from the canonical path
// persisted on School.logoUrl (e.g. "schools/<id>/logo.png" -> "png").
// Defensive on any non-logo value: logoUrl should only ever be written by
// uploadLogo() above, but a stray/legacy value shouldn't 500 the caller.
function parseLogoExt(logoUrl: string | null | undefined): LogoExt | null {
  if (!logoUrl) return null;
  const ext = logoUrl.split(".").pop();
  return ext === "png" || ext === "jpg" || ext === "webp" ? ext : null;
}

async function loadSchoolOrThrow(schoolId: string): Promise<SchoolMeDto> {
  const school = await basePrisma.school.findUnique({
    where: { id: schoolId },
    select: SCHOOL_RESPONSE_SELECT,
  });
  if (!school) {
    throw new NotFoundError("School not found.");
  }
  return toSchoolMeDto(school);
}

// Exported so the controller can call it with `step` already coerced.
// Kept here (rather than in the controller) so test code can construct the
// payload union without depending on Nest internals.
export function buildOnboardingPayload(step: number, raw: unknown): OnboardingStepPayload {
  switch (step) {
    case 1:
    case 2:
    case 3:
    case 4:
    case 5:
      // The actual Zod parse happens in the controller (so VALIDATION_ERROR
      // is shaped the same way as everywhere else). This helper just narrows
      // the union once we've validated.
      return { step, data: raw } as OnboardingStepPayload;
    default:
      throw new ValidationError("step must be an integer between 1 and 5", {
        issues: [{ path: "step", code: "out_of_range", message: `got ${step}` }],
      });
  }
}
