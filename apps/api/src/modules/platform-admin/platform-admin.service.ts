import * as crypto from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";

import { basePrisma } from "@school-kit/db";
import {
  ConflictError,
  InternalError,
  NotFoundError,
  RESERVED_SLUGS,
  UnauthorizedError,
  type PlatformAdminCreateSchoolInput,
  type PlatformAdminCreateSchoolResponse,
  type PlatformAdminLoginInput,
  type PlatformAdminLoginResponse,
  type PlatformAdminSchoolDto,
  type PlatformAdminSetEarlyAccessInput,
  type PlatformAdminSetEarlyAccessResponse,
  type PlatformAdminUserDto,
} from "@school-kit/types";

import type { PlatformAdminContext } from "../../common/auth/platform-admin-context";
import * as password from "../../common/auth/password";
import { createSession } from "../../common/auth/sessions";
import { EmailService } from "../../common/email/email.service";
import { redactEmail } from "../../common/redact";

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

// Slug rules mirror signupOwnerSchema's SLUG_RE exactly (packages/types/src/
// auth/signup-owner.dto.ts) — lowercase letters, digits, hyphens; cannot
// start or end with a hyphen. Duplicated here (not exported/shared) because
// signup's version is a Zod .regex() validating client input, while this is
// a generator producing it — different shape, same rule, and the codebase's
// low-abstraction posture doesn't ask for a shared home until a third
// caller needs one.
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const MAX_SLUG_BASE_LENGTH = 30; // leaves room for a "-NN" collision suffix within the 40-char cap.
const MAX_SLUG_COLLISION_ATTEMPTS = 50;

// 14 days — longer than the 7-day staff/guardian invitation precedent.
// Standing up a whole school is a bigger commitment to act on than
// accepting a portal invite, and there's no self-serve resend on this
// surface yet if it lapses (see CLAUDE.md's "Platform super-admin" note).
const OWNER_INVITATION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

// Same WEB_BASE_URL convention as UsersService.invite() / GuardiansService
// (PORTAL_BASE_URL) — dev default matches the web dev port, production must
// set it explicitly. Duplicated rather than imported: it's three lines, and
// there's no shared module either sibling already reaches into.
function webBaseUrl(): string {
  return process.env.WEB_BASE_URL ?? "http://localhost:3001";
}

function slugify(schoolName: string): string {
  const base = schoolName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics (combining marks left by NFKD)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_BASE_LENGTH)
    .replace(/-+$/g, "");
  return base.length >= 3 ? base : `${base || "school"}-school`;
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

    const slug = await this.generateUniqueSlug(input.schoolName);

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
    });

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

  // Derives a slug from the school name (same rules as signupOwnerSchema's
  // SLUG_RE) and retries with a numeric suffix on collision. School has no
  // RLS, so these are plain basePrisma reads — no tenant context needed.
  private async generateUniqueSlug(schoolName: string): Promise<string> {
    const base = slugify(schoolName);
    for (let attempt = 0; attempt < MAX_SLUG_COLLISION_ATTEMPTS; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      if (!SLUG_RE.test(candidate) || RESERVED_SLUGS.has(candidate)) continue;
      const existing = await basePrisma.school.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!existing) return candidate;
    }
    // Should never happen in practice — MAX_SLUG_COLLISION_ATTEMPTS collisions
    // in a row on the same base slug. Fail loudly rather than create a school
    // with a slug that silently doesn't match its name.
    throw new InternalError(
      `Could not generate a unique slug for "${schoolName}" after ${MAX_SLUG_COLLISION_ATTEMPTS} attempts.`,
    );
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
