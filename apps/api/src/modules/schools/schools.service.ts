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
  type SchoolMeDto,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { assertUserActiveAndHasOneOf } from "../../common/auth/role-check";
import { redactEmail } from "../../common/redact";

const INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

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
  // GET /schools/me — returns the authed user's school. Any authed role may
  // read; the AuthGuard already enforced the bearer token, and schools is
  // not under RLS so we read directly via basePrisma. authCtx.schoolId came
  // from auth_resolve_session, so the tenant has already been authenticated.
  async findMe(authCtx: AuthContext): Promise<SchoolMeDto> {
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
    if (input.logoUrl !== undefined) data.logoUrl = input.logoUrl;
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
    // Both fields are optional. An empty payload {} is a valid advance —
    // a school with no logo and no chosen colour still moves on. We use
    // ?? null for the same reason as step 1: explicit-null overwrites the
    // existing value if the user is editing rather than creating.
    const school = await this.updateSchoolWithAudit(
      authCtx,
      {
        logoUrl: data.logoUrl ?? null,
        primaryColor: data.primaryColor ?? null,
        onboardingStep: 2,
      },
      "onboarding.step2_complete",
      reqCtx,
      {
        logoUrl: data.logoUrl ?? null,
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
