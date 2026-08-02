import { Injectable } from "@nestjs/common";

import { basePrisma } from "@school-kit/db";
import {
  UnauthorizedError,
  type PlatformAdminLoginInput,
  type PlatformAdminLoginResponse,
  type PlatformAdminSchoolDto,
  type PlatformAdminUserDto,
} from "@school-kit/types";

import type { PlatformAdminContext } from "../../common/auth/platform-admin-context";
import * as password from "../../common/auth/password";
import { createSession } from "../../common/auth/sessions";
import { redactEmail } from "../../common/redact";

// Read-only, cross-tenant service. Every read goes through the
// platform_admin_* SECURITY DEFINER functions (see CLAUDE.md's inventory)
// via basePrisma directly — this module deliberately stays outside the
// tenant-scoping helper every other service uses, and never references the
// Invoice/Payment/Student Prisma delegates. Both constraints are enforced
// mechanically by platform-admin-access.spec.ts's import-boundary test, not
// just this comment.

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

@Injectable()
export class PlatformAdminService {
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
    }));
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
