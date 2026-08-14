import * as crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

import { applySchoolDefaults, basePrisma } from "@school-kit/db";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  type PlatformAdminCreateSchoolInput,
  type PlatformAdminCreateSchoolResponse,
  type PlatformAdminLoginInput,
  type PlatformAdminLoginResponse,
  type PlatformAdminSchoolDto,
  type PlatformAdminSetAiEnabledInput,
  type PlatformAdminSetAiEnabledResponse,
  type PlatformAdminSetEarlyAccessInput,
  type PlatformAdminSetEarlyAccessResponse,
  type PlatformAdminUserDto,
} from "@school-kit/types";

import type { PlatformAdminContext } from "../../common/auth/platform-admin-context";
import * as password from "../../common/auth/password";
import { createSession } from "../../common/auth/sessions";
import { EmailService } from "../../common/email/email.service";
import { redactEmail } from "../../common/redact";
import { generateUniqueSchoolSlug } from "../../common/slug/school-slug.js";

// Cross-tenant service. Reads go through the platform_admin_* SECURITY
// DEFINER functions (see CLAUDE.md's inventory) via basePrisma directly —
// this module deliberately stays outside the tenant-scoping helper every
// other service uses, and never references the Invoice/Payment/Student
// Prisma delegates. Both constraints are enforced mechanically by
// platform-admin-access.spec.ts's import-boundary test, not just this
// comment.
//
// createSchool() (2026-08-07) is the surface's first write. It does NOT
// need a SECURITY DEFINER function for the write itself — School/Invitation
// creation reuses AuthService.signupOwner's exact pattern (basePrisma.
// $transaction, create School, `SET LOCAL app.current_school_id` via raw
// SQL inside the same tx, then ordinary tenant-scoped inserts satisfy RLS's
// WITH CHECK). SECURITY DEFINER is only needed for the pre-tenant
// availability *read* (platform_admin_check_owner_email_available), same
// division of concerns as every other function in the inventory.

// Slug derivation moved to ../../common/slug/school-slug.ts (2026-08-12)
// when self-serve signup became a second generator caller — see that file's
// header for why sharing became a correctness requirement rather than a
// tidiness one.

// 14 days — longer than the 7-day staff/guardian invitation precedent.
// Standing up a whole school is a bigger commitment to act on than
// accepting a portal invite, and there's no self-serve resend on this
// surface yet if it lapses (see CLAUDE.md's "Platform super-admin" note).
const OWNER_INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

// Mirrors AuthService's SIGNUP_TRANSACTION_TIMEOUT_MS, and for the same
// reason. Until 2026-08-14 createSchool's transaction was three quick writes
// and ran fine on Prisma's 5000ms interactive-transaction default. Adding
// applySchoolDefaults() puts ~8 more sequential round-trips inside that
// boundary — which is exactly the shape that caused the 2026-08-02/03
// production incident, where signupOwner's equivalent transaction measured
// 5172ms against real Neon latency (172ms over the default) and failed every
// signup with a 500 for roughly two hours. Provisioning is far lower-volume
// than signup, but the failure mode is identical and the remedy is the same.
// Deliberately a local constant rather than an import from auth.service.ts:
// that one is module-private there, and this module's import-boundary spec
// keeps platform-admin from reaching into other services.
const CREATE_SCHOOL_TRANSACTION_TIMEOUT_MS = 20_000;

// Same WEB_BASE_URL convention as UsersService.invite() / GuardiansService
// (PORTAL_BASE_URL) — dev default matches the web dev port, production must
// set it explicitly. Duplicated rather than imported: it's three lines, and
// there's no shared module either sibling already reaches into.
function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? "http://localhost:3001";
}


interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface LookupUserForLoginRow {
  user_id: string;
  school_id: string;
  password_hash: string | null;
  is_active: boolean;
}

interface ListSchoolsRow {
  school_id: string;
  name: string;
  created_at: Date;
  is_active: boolean;
  student_count: bigint;
  staff_count: bigint;
  owner_invite_pending: boolean;
  owner_invite_expires_at: Date | null;
  early_access_granted_at: Date | null;
  ai_enabled: boolean;
}

interface CheckOwnerEmailAvailableRow {
  is_available: boolean;
  reason: "USER_EXISTS" | "INVITE_PENDING" | null;
}

interface ListUsersRow {
  user_id: string;
  school_id: string;
  first_name: string;
  last_name: string;
  role_names: string[];
  created_at: Date;
  last_login_at: Date | null;
  is_active: boolean;
}

// Same account-enumeration defense as AuthService.login / PortalAuthService
// — argon2.verify against a fixed dummy hash on a miss, so total response
// time is on the same order as a real verification. Lazily generated,
// cached for the process lifetime; a local copy (not imported from
// auth.service.ts) since that constant is module-private there.
let dummyVerifyHash: string | undefined;
async function getDummyVerifyHash(): Promise<string> {
  if (!dummyVerifyHash) {
    dummyVerifyHash = await password.hashPassword("dummy-platform-admin-login-target");
  }
  return dummyVerifyHash;
}

const LOGIN_AUDIT_ACTION = "platform_admin.login";
const SCHOOLS_LIST_AUDIT_ACTION = "platform_admin.schools.list";
const USERS_LIST_AUDIT_ACTION = "platform_admin.users.list";
const SCHOOLS_CREATE_AUDIT_ACTION = "platform_admin.schools.create";
const SCHOOLS_SET_EARLY_ACCESS_AUDIT_ACTION = "platform_admin.schools.set-early-access";
const SCHOOLS_SET_AI_ENABLED_AUDIT_ACTION = "platform_admin.schools.set-ai-enabled";

@Injectable()
export class PlatformAdminService {
  private readonly logger = new Logger(PlatformAdminService.name);

  constructor(private readonly email: EmailService) {}

  // Reuses the exact same SECURITY DEFINER lookup, argon2 verification, and
  // session-minting helper as staff login (AuthService.login) — "no new
  // credential system", per the approved plan. This deliberately does NOT
  // also check the platform-admin flag here: that check belongs solely to
  // PlatformAdminGuard, re-read from the DB on every request, not trusted
  // from application code at login time (and not duplicated here, per this
  // module's own import-boundary constraint above). A staff member who
  // authenticates here but isn't a platform admin gets a session exactly
  // like any other successful login — their very next platform-admin
  // request is rejected by the guard with a real 403.
  async login(
    input: PlatformAdminLoginInput,
    ctx: RequestContext,
  ): Promise<PlatformAdminLoginResponse> {
    const rows = await basePrisma.$queryRaw<LookupUserForLoginRow[]>`
      SELECT * FROM auth_lookup_user_for_login(${input.email})
    `;
    const row = rows[0];

    if (!row) {
      const dummy = await getDummyVerifyHash();
      await password.verifyPassword(dummy, input.password).catch(() => false);
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const passwordOk = await password
      .verifyPassword(row.password_hash ?? (await getDummyVerifyHash()), input.password)
      .catch(() => false);
    if (!passwordOk || !row.is_active) {
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const { rawToken } = await createSession(row.school_id, row.user_id, ctx);

    // Direct write, not tenant-scoped — this action is cross-tenant by
    // nature (see CLAUDE.md's audit_logs RLS policy note: schoolId IS NULL
    // rows pass through unconditionally).
    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: row.user_id,
        action: LOGIN_AUDIT_ACTION,
        entityType: "user",
        entityId: row.user_id,
        ipAddress: ctx.ipAddress,
        metadata: { email: redactEmail(input.email) },
      },
    });

    return { token: rawToken };
  }

  async listSchools(
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminSchoolDto[]> {
    const rows = await basePrisma.$queryRaw<ListSchoolsRow[]>`
      SELECT * FROM platform_admin_list_schools()
    `;

    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: adminCtx.userId,
        action: SCHOOLS_LIST_AUDIT_ACTION,
        entityType: "school",
        ipAddress: reqCtx.ipAddress,
        metadata: { resultCount: rows.length },
      },
    });

    return rows.map((r) => ({
      schoolId: r.school_id,
      name: r.name,
      createdAt: r.created_at.toISOString(),
      isActive: r.is_active,
      studentCount: Number(r.student_count),
      staffCount: Number(r.staff_count),
      ownerInvitePending: r.owner_invite_pending,
      ownerInviteExpiresAt: r.owner_invite_expires_at ? r.owner_invite_expires_at.toISOString() : null,
      earlyAccessGrantedAt: r.early_access_granted_at
        ? r.early_access_granted_at.toISOString()
        : null,
      aiEnabled: r.ai_enabled,
    }));
  }

  // PATCH /platform-admin/schools/:schoolId/early-access — sets or clears the
  // early-access marker. The surface's second write, and a much smaller one
  // than createSchool: a single-column UPDATE plus an audit row.
  //
  // No SECURITY DEFINER function needed, and no GUC dance either: `schools`
  // is the one table with no RLS policy at all (it IS the tenant table —
  // every other table's policy keys off it), which is why
  // generateUniqueSlug() above can already do plain basePrisma reads against
  // it. So an ordinary basePrisma.school.update is both sufficient and
  // consistent with what this module already does.
  //
  // Deliberately idempotent-ish rather than strictly idempotent: setting
  // `true` on an already-early-access school RE-STAMPS the timestamp to now.
  // That's a real (if minor) behaviour choice — the alternative (preserve the
  // original stamp) hides operator mistakes, and the audit log records every
  // transition either way. Flagged here rather than left implicit.
  async setEarlyAccess(
    schoolId: string,
    input: PlatformAdminSetEarlyAccessInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminSetEarlyAccessResponse> {
    const existing = await basePrisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, earlyAccessGrantedAt: true },
    });
    if (!existing) {
      throw new NotFoundError("School not found.");
    }

    const nextValue = input.earlyAccess ? new Date() : null;

    const updated = await basePrisma.school.update({
      where: { id: schoolId },
      data: { earlyAccessGrantedAt: nextValue },
      select: { id: true, earlyAccessGrantedAt: true },
    });

    await basePrisma.auditLog.create({
      data: {
        // schoolId: null for the same reason as every other action on this
        // surface — audit_logs' RLS policy only lets null-schoolId rows
        // through a GUC-less read, and platform-admin reads are always
        // GUC-less. The school is identified by entityId.
        schoolId: null,
        userId: adminCtx.userId,
        action: SCHOOLS_SET_EARLY_ACCESS_AUDIT_ACTION,
        entityType: "school",
        entityId: schoolId,
        ipAddress: reqCtx.ipAddress,
        metadata: {
          from: existing.earlyAccessGrantedAt
            ? existing.earlyAccessGrantedAt.toISOString()
            : null,
          to: updated.earlyAccessGrantedAt
            ? updated.earlyAccessGrantedAt.toISOString()
            : null,
        },
      },
    });

    return {
      schoolId: updated.id,
      earlyAccessGrantedAt: updated.earlyAccessGrantedAt
        ? updated.earlyAccessGrantedAt.toISOString()
        : null,
    };
  }

  // PATCH /platform-admin/schools/:schoolId/ai — turns the per-school AI kill
  // switch on or off. Structurally identical to setEarlyAccess above (single
  // -column UPDATE on the RLS-free `schools` table + one audit row, no
  // SECURITY DEFINER function and no GUC needed), but the two differ in one
  // way worth stating plainly: early access is an inert marker, and this is
  // not. School.aiEnabled is read on the hot path by
  // AiGenerationService.reserve() and by ParentSummariesService, so setting
  // it false stops every AI feature for that school within one request and
  // no deploy — which is the entire point of it being a kill switch.
  //
  // Setting it TRUE does not by itself start anything: the platform-wide
  // AI_ENABLED env var is a separate gate, and this endpoint deliberately
  // does not read, report, or touch it. Conflating the two here would make a
  // per-school action silently depend on process state the caller can't see.
  //
  // Genuinely idempotent, unlike setEarlyAccess (which re-stamps a timestamp
  // on a repeat `true`): a boolean set to the value it already holds is a
  // no-op. The audit row is still written on a no-change call — "an operator
  // asserted this state at this time" is worth recording even when the value
  // didn't move, and metadata carries both from and to so a reader can tell
  // a real transition from a re-assertion.
  async setAiEnabled(
    schoolId: string,
    input: PlatformAdminSetAiEnabledInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminSetAiEnabledResponse> {
    const existing = await basePrisma.school.findUnique({
      where: { id: schoolId },
      select: { id: true, aiEnabled: true },
    });
    if (!existing) {
      throw new NotFoundError("School not found.");
    }

    const updated = await basePrisma.school.update({
      where: { id: schoolId },
      data: { aiEnabled: input.aiEnabled },
      select: { id: true, aiEnabled: true },
    });

    await basePrisma.auditLog.create({
      data: {
        // schoolId: null for the same reason as every other action on this
        // surface — audit_logs' RLS policy only lets null-schoolId rows
        // through a GUC-less read, and platform-admin reads are always
        // GUC-less. The school is identified by entityId.
        schoolId: null,
        userId: adminCtx.userId,
        action: SCHOOLS_SET_AI_ENABLED_AUDIT_ACTION,
        entityType: "school",
        entityId: schoolId,
        ipAddress: reqCtx.ipAddress,
        metadata: {
          field: "aiEnabled",
          from: existing.aiEnabled,
          to: updated.aiEnabled,
        },
      },
    });

    return {
      schoolId: updated.id,
      aiEnabled: updated.aiEnabled,
    };
  }

  // POST /platform-admin/schools — the surface's first write. Creates the
  // School row and an `owner`-role Invitation, then emails the invitee a
  // real accept link via Resend. Reuses the existing Invitation/accept/
  // session machinery completely unchanged: POST /invitations/:token/accept
  // already handles an arbitrary roleKey generically (it looks up the
  // system Role by key), so no invitations-module changes were needed.
  //
  // Two gates before any write, mirroring signupOwner's "cheap rejection
  // stays cheap" ordering:
  //   1. platform_admin_check_owner_email_available — pre-tenant read via
  //      SECURITY DEFINER (see migration 20260807000000 for why this can't
  //      be an ordinary basePrisma query against FORCE-RLS tables).
  //   2. slug derivation + collision retry against the (RLS-free) School
  //      table.
  //
  // Atomicity: School + Invitation + audit row commit or roll back together,
  // same basePrisma.$transaction + raw GUC pattern as AuthService.
  // signupOwner (no nested tenant-scoped transaction — Prisma doesn't
  // support nested transactions). Email delivery happens AFTER commit and
  // is best-effort:
  // a send failure is logged, never thrown, and never removes acceptUrl
  // from the response — same posture as GuardiansService.deliverInvitation.
  async createSchool(
    input: PlatformAdminCreateSchoolInput,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminCreateSchoolResponse> {
    const availabilityRows = await basePrisma.$queryRaw<CheckOwnerEmailAvailableRow[]>`
      SELECT * FROM platform_admin_check_owner_email_available(${input.ownerEmail})
    `;
    const availability = availabilityRows[0];
    if (!availability || !availability.is_available) {
      if (availability?.reason === "INVITE_PENDING") {
        throw new ConflictError(
          "INVITE_PENDING",
          "This email already has a pending owner invitation at another school.",
        );
      }
      throw new ConflictError(
        "EMAIL_TAKEN",
        "A user with that email already exists on the platform.",
      );
    }

    const slug = await generateUniqueSchoolSlug(input.schoolName);

    const rawToken = crypto.randomBytes(32).toString("base64url");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + OWNER_INVITATION_TTL_MS);

    const created = await basePrisma.$transaction(async (tx) => {
      const school = await tx.school.create({
        data: {
          name: input.schoolName,
          slug,
          // status, onboardingStep default per schema (ONBOARDING, 0).
          // ndprConsent stays false here — it's stamped by onboarding step
          // 4 once the owner reaches it, same as a self-serve signup.
        },
        select: { id: true, name: true, slug: true },
      });

      // From here on, every tenant-scoped INSERT must satisfy the policy's
      // WITH CHECK — set the GUC inside the same tx so RLS sees the new
      // school's id as the current tenant (mirrors signupOwner exactly).
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${school.id}, true)`;

      // Seed the same class levels, default arms, subject catalogue and
      // grading scheme/components/boundaries a self-serve signup gets.
      //
      // MISSING FROM 2026-08-07 (this method's first ship) TO 2026-08-14.
      // createSchool reused signupOwner's transaction *pattern* but not its
      // seeding, because the seeding wasn't a callable unit — it was inline
      // in signupOwner. Four schools provisioned on 2026-08-08 landed with no
      // academic structure at all, and their owners could log in and do
      // nothing; one re-registered through self-serve signup instead, leaving
      // two school rows for one real school. Now shared: packages/db's
      // applySchoolDefaults() is the single definition both paths call, so
      // they cannot drift apart again. Requires the GUC set above and the
      // raised transaction timeout below — see that function's header.
      await applySchoolDefaults(tx, school.id);

      const invitation = await tx.invitation.create({
        data: {
          schoolId: school.id,
          email: input.ownerEmail,
          roleKey: "owner",
          tokenHash,
          // Bare FK, no relation (see Invitation.invitedBy's own comment) —
          // deliberately tolerates invitedBy referencing a User who belongs
          // to a DIFFERENT school (the platform admin's own). The accept
          // page's inviter-name lookup is already null-safe for exactly
          // this case (invitations.service.ts's getByToken falls back to
          // "An administrator" when the tenant-scoped lookup finds nothing).
          invitedBy: adminCtx.userId,
          expiresAt,
        },
        select: { id: true },
      });

      // schoolId: null, not school.id — matches the other three platform-
      // admin audit actions, deliberately: audit_logs' RLS policy lets
      // schoolId IS NULL rows pass through unconditionally, which is what
      // makes them readable by a later GUC-less basePrisma query (the same
      // way this action's own row needs to be readable). A non-null
      // schoolId here would only be visible to a query running with that
      // exact school's GUC set — which platform-admin reads, by design,
      // never do. The school is still identified via entityId below.
      await tx.auditLog.create({
        data: {
          schoolId: null,
          userId: adminCtx.userId,
          action: SCHOOLS_CREATE_AUDIT_ACTION,
          entityType: "school",
          entityId: school.id,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            ownerEmail: redactEmail(input.ownerEmail),
            schoolSlug: school.slug,
            invitationId: invitation.id,
          },
        },
      });

      return { school };
    }, { timeout: CREATE_SCHOOL_TRANSACTION_TIMEOUT_MS });

    const acceptUrl = `${webBaseUrl()}/invitations/${rawToken}`;

    // Unconditional send — unlike GuardiansService, there's no
    // NotificationPreference row to gate on yet (the school was just
    // created in this call). Best-effort: never blocks or rolls back the
    // already-committed invitation.
    try {
      await this.email.send({
        to: input.ownerEmail,
        subject: `You've been invited to set up ${created.school.name} on School Kit`,
        html: `<p>Hi,</p><p>You've been invited to create and manage <strong>${created.school.name}</strong> on School Kit. Use the link below to set your password and get started — it expires in 14 days.</p><p><a href="${acceptUrl}">${acceptUrl}</a></p>`,
      });
    } catch (err) {
      this.logger.warn(
        `Owner invite email failed for ${redactEmail(input.ownerEmail)}: ${String(err)}`,
      );
    }

    return {
      schoolId: created.school.id,
      schoolName: created.school.name,
      schoolSlug: created.school.slug,
      ownerEmail: input.ownerEmail,
      invitationExpiresAt: expiresAt.toISOString(),
      acceptUrl,
    };
  }

  async listUsers(
    schoolId: string | undefined,
    adminCtx: PlatformAdminContext,
    reqCtx: RequestContext,
  ): Promise<PlatformAdminUserDto[]> {
    const rows = await basePrisma.$queryRaw<ListUsersRow[]>`
      SELECT * FROM platform_admin_list_users(${schoolId ?? null})
    `;

    await basePrisma.auditLog.create({
      data: {
        schoolId: null,
        userId: adminCtx.userId,
        action: USERS_LIST_AUDIT_ACTION,
        entityType: "user",
        ipAddress: reqCtx.ipAddress,
        metadata: { schoolIdFilter: schoolId ?? null, resultCount: rows.length },
      },
    });

    return rows.map((r) => ({
      userId: r.user_id,
      schoolId: r.school_id,
      firstName: r.first_name,
      lastName: r.last_name,
      roleNames: r.role_names,
      createdAt: r.created_at.toISOString(),
      lastLoginAt: r.last_login_at ? r.last_login_at.toISOString() : null,
      isActive: r.is_active,
    }));
  }
}
