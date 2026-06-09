import { Injectable } from "@nestjs/common";

import {
  DEFAULT_CLASS_LEVELS,
  DEFAULT_GRADE_BOUNDARIES,
  DEFAULT_GRADING_COMPONENTS,
  DEFAULT_GRADING_SCHEME_NAME,
  Prisma,
  basePrisma,
  withTenant,
} from "@school-kit/db";
import {
  ConflictError,
  InternalError,
  UnauthorizedError,
  type AuthMeRoleDto,
  type LoginInput,
  type LoginResponse,
  type MeResponse,
  type SignupOwnerInput,
  type SignupOwnerResponse,
} from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
// Indirect through password.ts so tests can spy on hashPassword / verifyPassword.
// The argon2 package's CJS exports are non-configurable.
import * as password from "../../common/auth/password";
import { createSession } from "../../common/auth/sessions";
import { redactEmail } from "../../common/redact";

const SIGNUP_AUDIT_ACTION = "auth.signup_owner";
const LOGIN_AUDIT_ACTION = "auth.login";
const LOGOUT_AUDIT_ACTION = "auth.logout";

// Fixed argon2id hash used as a target when login is attempted against an
// unknown email or a user without a password_hash. Verifying against it
// keeps total response time on the same order as a real verification, so
// an attacker cannot enumerate accounts by latency.
//
// Lazily generated on first miss (cached for the process lifetime). The
// plaintext is arbitrary and never used for anything but priming the cache.
// Exposed via getDummyVerifyHash() rather than a top-level await because
// the API compiles to CommonJS where top-level await is unavailable.
let dummyVerifyHash: string | null = null;
async function getDummyVerifyHash(): Promise<string> {
  if (!dummyVerifyHash) {
    dummyVerifyHash = await password.hashPassword("dummy-login-target");
  }
  return dummyVerifyHash;
}

interface RequestContext {
  ipAddress: string | null;
  userAgent: string | null;
}

interface LookupUserForLoginRow {
  user_id: string;
  school_id: string;
  password_hash: string;
  is_active: boolean;
}

@Injectable()
export class AuthService {
  // Creates: School → User → UserRole (owner) → AuditLog in a single
  // transaction. Then mints a session row outside the tx and returns the
  // raw bearer token to the client (the token hash is what we persist).
  //
  // Atomicity: every row that belongs to "this new tenant exists" either all
  // commits or all rolls back. The session is intentionally outside that
  // boundary — failing to mint a session is not failing to create the
  // account; the user can log in. (See ADR-001 in docs/DECISIONS.md.)
  async signupOwner(input: SignupOwnerInput, ctx: RequestContext): Promise<SignupOwnerResponse> {
    // Pre-check email + phone uniqueness via a SECURITY DEFINER function.
    // We do this BEFORE hashing the password so the cheap rejection path
    // stays cheap. `users` is under FORCE RLS, which means a P2002 from
    // INSERT comes back with `target: null` and "Unique constraint failed
    // on the (not available)" — Postgres deliberately hides which field
    // collided. Without this pre-check we cannot tell email-taken from
    // phone-taken. See migration 20260515000000_add_signup_uniqueness_function.
    await this.assertEmailAndPhoneAvailable(input.ownerEmail, input.ownerPhone);

    const passwordHash = await password.hashPassword(input.password);

    let created: {
      schoolId: string;
      userId: string;
      school: Prisma.SchoolGetPayload<{ select: typeof SCHOOL_RESPONSE_SELECT }>;
      user: Prisma.UserGetPayload<{ select: typeof USER_RESPONSE_SELECT }>;
    };

    try {
      created = await basePrisma.$transaction(async (tx) => {
        const school = await tx.school.create({
          data: {
            name: input.schoolName,
            slug: input.schoolSlug,
            ndprConsent: true,
            ndprConsentAt: new Date(),
            // status, onboardingStep default per schema.
          },
          select: SCHOOL_RESPONSE_SELECT,
        });

        // From here on, every tenant-scoped INSERT must satisfy the policy's
        // WITH CHECK. Set the GUC inside the same tx so RLS sees the new
        // school's id as the current tenant.
        await tx.$executeRaw`SELECT set_config('app.current_school_id', ${school.id}, true)`;

        const user = await tx.user.create({
          data: {
            schoolId: school.id,
            firstName: input.ownerFirstName,
            lastName: input.ownerLastName,
            email: input.ownerEmail,
            phone: input.ownerPhone,
            passwordHash,
            // is_active, verification flags default per schema.
          },
          select: USER_RESPONSE_SELECT,
        });

        const ownerRole = await tx.role.findFirst({
          where: { schoolId: null, key: "owner", isSystem: true },
          select: { id: true },
        });
        if (!ownerRole) {
          // Configuration error — should be caught in CI via the integration
          // suite. If it happens in prod, fail loudly and roll back; do NOT
          // silently create a school without an owner role.
          throw new InternalError(
            "System role 'owner' is not seeded. Run `pnpm db:seed` against this database.",
          );
        }

        await tx.userRole.create({
          data: { userId: user.id, roleId: ownerRole.id },
        });

        // Phase 1 / Slice 2 — seed the 14 standard Nigerian class levels
        // (KG 1, KG 2, Primary 1–6, JSS 1–3, SSS 1–3). Uses `tx` directly,
        // NOT withTenant: the GUC `app.current_school_id` was set on this
        // tx at line ~101, so RLS WITH CHECK is already satisfied; wrapping
        // in withTenant would open a second basePrisma.$transaction inside
        // this one and Prisma does not support nested transactions (the
        // call would hang). `skipDuplicates: true` makes the seed
        // structurally idempotent against the (school_id, code) unique
        // index — a hypothetical retry would no-op rather than throw.
        await tx.classLevel.createMany({
          data: DEFAULT_CLASS_LEVELS.map((level) => ({
            schoolId: school.id,
            code: level.code,
            name: level.name,
            stage: level.stage,
            orderIndex: level.orderIndex,
          })),
          skipDuplicates: true,
        });

        // Phase 2 / Slice 1 — seed the school's single grading scheme + its
        // three default components (CA1/CA2/Exam = 20/20/60, Σ=100) and the
        // nine WAEC grade boundaries (A1..F9). Same `tx` + GUC as the
        // class-level seed above — NOT withTenant (a nested
        // basePrisma.$transaction would hang; see the class-level note).
        //
        // The scheme is UPSERTED (not created) on the (school_id) unique so a
        // hypothetical signup-tx retry is idempotent — we need its id to attach
        // components anyway. Components + boundaries use `skipDuplicates`
        // against their unique indexes for the same belt-and-braces. No
        // separate audit row: this is part of the signup bootstrap, attributed
        // to the auth.signup_owner entry written below (mirrors the class-level
        // seed, which also writes no audit of its own).
        const gradingScheme = await tx.gradingScheme.upsert({
          where: { schoolId: school.id },
          update: {},
          create: { schoolId: school.id, name: DEFAULT_GRADING_SCHEME_NAME },
          select: { id: true },
        });
        await tx.gradingComponent.createMany({
          data: DEFAULT_GRADING_COMPONENTS.map((component) => ({
            schoolId: school.id,
            schemeId: gradingScheme.id,
            key: component.key,
            label: component.label,
            weight: component.weight,
            orderIndex: component.orderIndex,
          })),
          skipDuplicates: true,
        });
        await tx.gradeBoundary.createMany({
          data: DEFAULT_GRADE_BOUNDARIES.map((boundary) => ({
            schoolId: school.id,
            letter: boundary.letter,
            minScore: boundary.minScore,
            maxScore: boundary.maxScore,
            remark: boundary.remark,
            orderIndex: boundary.orderIndex,
          })),
          skipDuplicates: true,
        });

        // Audit entry written inline rather than queued through BullMQ. Two
        // reasons: (1) signup is the bootstrap event for the tenant — there
        // is no school_id yet when a queue worker would dequeue, so the
        // out-of-band write loses the atomicity we want here. (2) writing
        // inside the same tx as the school + user means we either record the
        // signup or we don't have a school at all — never an orphaned
        // user-without-audit-log. Once we have the audit interceptor for
        // post-auth mutations (Phase 0 Week 2), it queues via BullMQ; this
        // one signup write stays direct on purpose.
        await tx.auditLog.create({
          data: {
            schoolId: school.id,
            userId: user.id,
            action: SIGNUP_AUDIT_ACTION,
            entityType: "school",
            entityId: school.id,
            ipAddress: ctx.ipAddress,
            metadata: {
              schoolSlug: school.slug,
              ownerEmail: redactEmail(input.ownerEmail),
              // password / passwordHash / token are deliberately absent.
            },
          },
        });

        return {
          schoolId: school.id,
          userId: user.id,
          school,
          user,
        };
      });
    } catch (err) {
      throw translatePrismaError(err);
    }

    // Session creation outside the school+user transaction (see method
    // comment for why). Goes through withTenant so the RLS policy on
    // `sessions` is satisfied.
    const { rawToken } = await createSession(created.schoolId, created.userId, ctx);

    return {
      user: created.user,
      school: created.school,
      token: rawToken,
    };
  }

  // Email + password authentication. Login is the most-attacked endpoint we
  // ship, so the implementation is paranoid by design:
  //   1. Email lookup via SECURITY DEFINER (RLS chicken-and-egg — see
  //      auth.guard.ts and migration 20260516000000).
  //   2. On a miss, argon2.verify against a fixed dummy hash anyway so total
  //      response time is on the same order as a real verification — no
  //      latency-based account enumeration.
  //   3. Wrong password, unknown email, and deactivated account all return
  //      the SAME generic INVALID_CREDENTIALS error.
  //   4. Rate limiting is deliberately deferred (see docs/deferred.md).
  async login(input: LoginInput, ctx: RequestContext): Promise<LoginResponse> {
    const rows = await basePrisma.$queryRaw<LookupUserForLoginRow[]>`
      SELECT * FROM auth_lookup_user_for_login(${input.email})
    `;
    const row = rows[0];

    if (!row) {
      // Don't short-circuit — keep timing comparable to the row-found path.
      const dummy = await getDummyVerifyHash();
      await password.verifyPassword(dummy, input.password).catch(() => false);
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const passwordOk = await password
      .verifyPassword(row.password_hash, input.password)
      .catch(() => false);
    if (!passwordOk) {
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    if (!row.is_active) {
      // Same code as wrong-password. We do NOT want a deactivated user to
      // know whether the password they typed was correct.
      throw new UnauthorizedError("INVALID_CREDENTIALS", "Invalid email or password.");
    }

    const { rawToken } = await createSession(row.school_id, row.user_id, ctx);

    const user = await withTenant(row.school_id, async (db) => {
      // Touch lastLoginAt + read back the public-shape user payload.
      const updatedUser = await db.user.update({
        where: { id: row.user_id },
        data: { lastLoginAt: new Date() },
        select: USER_RESPONSE_SELECT,
      });

      // Audit row — direct write, mirroring signup. Moves to the BullMQ
      // queue when the audit interceptor lands (see docs/deferred.md).
      await db.auditLog.create({
        data: {
          schoolId: row.school_id,
          userId: row.user_id,
          action: LOGIN_AUDIT_ACTION,
          entityType: "user",
          entityId: row.user_id,
          ipAddress: ctx.ipAddress,
          metadata: {
            ownerEmail: redactEmail(input.email),
            userAgent: ctx.userAgent,
          },
        },
      });

      return updatedUser;
    });

    // schools has no RLS — read via basePrisma. Matches the pattern used in
    // auth.service.spec.ts and the signup happy-path assertion.
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: row.school_id },
      select: SCHOOL_RESPONSE_SELECT,
    });

    return { user, school, token: rawToken };
  }

  // Deletes the session row matching the current bearer token and writes an
  // audit entry. Idempotent on the row delete (deleteMany returns count
  // rather than throwing on missing rows), so a double-logout from two tabs
  // does not 500 the second one — though the second request's AuthGuard
  // will have already rejected with INVALID_SESSION before reaching here.
  async logout(authCtx: AuthContext, reqCtx: RequestContext): Promise<void> {
    await withTenant(authCtx.schoolId, async (db) => {
      await db.session.deleteMany({ where: { id: authCtx.sessionId } });

      await db.auditLog.create({
        data: {
          schoolId: authCtx.schoolId,
          userId: authCtx.userId,
          action: LOGOUT_AUDIT_ACTION,
          entityType: "session",
          entityId: authCtx.sessionId,
          ipAddress: reqCtx.ipAddress,
          metadata: {
            userAgent: reqCtx.userAgent,
          },
        },
      });
    });
  }

  // Returns the authenticated user, their school, and their roles +
  // flattened permission set.
  //
  // The user re-fetch + role grants both go through withTenant because
  // `users` and `user_roles` are under FORCE ROW LEVEL SECURITY — even a
  // direct basePrisma findUnique returns no rows without the GUC set.
  //
  // The original "use basePrisma like the school re-fetch" plan turned out
  // to assume basePrisma could bypass RLS; it can't. The risk that plan was
  // hedging against (silent USER_INACTIVE from a tenant mismatch) is
  // structurally impossible here anyway: AuthContext.schoolId comes from
  // auth_resolve_session, which joins users→sessions, so the tenant we
  // scope to is always the one that owns this user.
  //
  // is_active is re-checked below as belt-and-braces against AuthContext
  // staleness, even though AuthGuard already rejected !is_active.
  async getMe(authCtx: AuthContext): Promise<MeResponse> {
    type Grant = Prisma.UserRoleGetPayload<{ select: typeof ROLE_GRANT_SELECT }>;
    const { user, grants } = await withTenant(authCtx.schoolId, async (db) => {
      const u = await db.user.findUnique({
        where: { id: authCtx.userId },
        select: USER_RESPONSE_SELECT,
      });
      if (!u) return { user: null, grants: [] as Grant[] };
      const g = await db.userRole.findMany({
        where: { userId: authCtx.userId },
        select: ROLE_GRANT_SELECT,
      });
      return { user: u, grants: g };
    });

    if (!user || !user.isActive) {
      throw new UnauthorizedError("USER_INACTIVE", "Your account has been deactivated.");
    }

    // schools has no RLS — basePrisma read is fine.
    const school = await basePrisma.school.findUniqueOrThrow({
      where: { id: authCtx.schoolId },
      select: SCHOOL_RESPONSE_SELECT,
    });

    const roles: AuthMeRoleDto[] = grants.map((g) => ({
      key: g.role.key,
      name: g.role.name,
      permissions: coercePermissions(g.role.permissions),
    }));

    // Flatten + dedupe. `*` short-circuits — once present, that's the whole
    // effective permission set.
    const flat = new Set<string>();
    for (const r of roles) {
      for (const p of r.permissions) flat.add(p);
    }
    const permissions = flat.has("*") ? ["*"] : Array.from(flat).sort();

    return { user, school, roles, permissions };
  }

  // Calls the SECURITY DEFINER function added in
  // 20260515000000_add_signup_uniqueness_function — returns two booleans
  // and never row data, so it leaks no cross-tenant information beyond
  // what the response itself would surface (a separate code per field).
  private async assertEmailAndPhoneAvailable(email: string, phone: string): Promise<void> {
    const rows = await basePrisma.$queryRaw<
      Array<{ email_taken: boolean; phone_taken: boolean }>
    >`SELECT * FROM auth_check_signup_uniqueness(${email}, ${phone})`;
    const check = rows[0];
    if (!check) {
      // Shouldn't happen — the SQL function always returns one row.
      throw new InternalError("Uniqueness pre-check returned no rows.");
    }
    if (check.email_taken) {
      throw new ConflictError("EMAIL_TAKEN", "An account with that email already exists.");
    }
    if (check.phone_taken) {
      throw new ConflictError("PHONE_TAKEN", "An account with that phone number already exists.");
    }
  }

}

// Selects — explicit so we never accidentally leak passwordHash, internal
// flags, or anything else added to the model in a future migration.

const USER_RESPONSE_SELECT = {
  id: true,
  schoolId: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  isActive: true,
  emailVerified: true,
  phoneVerified: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

const ROLE_GRANT_SELECT = {
  role: { select: { key: true, name: true, permissions: true } },
} satisfies Prisma.UserRoleSelect;

// Wider than the original signup-only shape — matches SchoolMeDto so the
// /auth/me response can hydrate the onboarding wizard's forms without
// requiring a second round-trip to GET /schools/me on every page mount.
// Signup + login still return the same shape (defaults / nulls) which is
// fine: the SchoolMeDto interface accepts nullable fields throughout.
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

// Role.permissions is a Json column — Prisma types it as JsonValue. We
// store either `["*"]` or `string[]`. Anything else is a seed bug.
function coercePermissions(raw: Prisma.JsonValue): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string");
}

// Map Prisma unique-constraint errors into typed ConflictErrors with stable
// sub-codes the client can branch on. Everything else passes through.
//
// Prisma's `meta.target` shape varies — sometimes it's the field name array
// (['email']), sometimes the index name as a string ('users_email_key'),
// occasionally undefined. We build a single search haystack from target +
// error message so substring matches against the field name catch every
// observed shape, with the message as a final fallback.
function translatePrismaError(err: unknown): unknown {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    const target = (err.meta as { target?: unknown } | undefined)?.target;
    const fields: string[] = Array.isArray(target)
      ? target.map((t) => String(t))
      : typeof target === "string"
        ? [target]
        : [];
    const haystack = (fields.join(",") + " " + (err.message ?? "")).toLowerCase();

    if (haystack.includes("slug")) {
      return new ConflictError("SCHOOL_SLUG_TAKEN", "That school slug is already taken.");
    }
    if (haystack.includes("email")) {
      return new ConflictError("EMAIL_TAKEN", "An account with that email already exists.");
    }
    if (haystack.includes("phone")) {
      return new ConflictError("PHONE_TAKEN", "An account with that phone number already exists.");
    }
    return new ConflictError("UNIQUE_VIOLATION", "That value is already taken.");
  }
  return err;
}
