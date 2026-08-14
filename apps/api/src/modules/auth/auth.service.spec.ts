import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as argon2 from "argon2";
import { generateSync } from "otplib";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, UnauthorizedError, ValidationError, signupOwnerSchema } from "@school-kit/types";

import { AuthService } from "./auth.service";

// Integration spec — talks to the real dev Postgres on purpose. The bug
// class we care about (RLS misconfiguration, transaction atomicity,
// password leakage) only manifests against real rows. Mocks would defeat
// the point. Mirrors the style of apps/api/src/__tests__/rls.spec.ts.

describe("AuthService.signupOwner (Phase 0 Prompt 3)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  // Phones must be all-digits per the Zod regex, so we keep a numeric suffix
  // separate from the slug/email runId.
  const phoneSuffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  const service = new AuthService();
  const ctx = { ipAddress: "127.0.0.1", userAgent: "vitest" };

  // Track ids we create so we can tear down without relying on RLS at
  // cleanup time (cascade from school deletes everything tenant-scoped).
  const schoolIdsToCleanup = new Set<string>();
  // Pre-seeded rows used by conflict tests live under their own ids so we
  // can clean them too.
  let preSeededSchoolId: string;

  // System-wide ensure the 'owner' role exists. If the seed has not been
  // run, fail loudly here rather than letting every test report a confusing
  // InternalError.
  beforeAll(async () => {
    const owner = await basePrisma.role.findFirst({
      where: { schoolId: null, key: "owner", isSystem: true },
      select: { id: true },
    });
    if (!owner) {
      throw new Error(
        "System role 'owner' is not seeded. Run `pnpm db:seed` before this suite.",
      );
    }

    // Pre-seed one school + user so the slug/email/phone collision tests
    // have something to collide with.
    preSeededSchoolId = (
      await basePrisma.school.create({
        data: {
          name: "Pre-seeded school",
          slug: `taken-${runId}`,
        },
        select: { id: true },
      })
    ).id;
    schoolIdsToCleanup.add(preSeededSchoolId);

    // Insert user directly via raw SQL with the GUC set, so we don't have
    // to import withTenant just for setup.
    await basePrisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_school_id', ${preSeededSchoolId}, true)`;
      await tx.user.create({
        data: {
          schoolId: preSeededSchoolId,
          firstName: "Existing",
          lastName: "Owner",
          email: `dup-${runId}@example.test`,
          phone: `+234901${phoneSuffix}`,
          passwordHash: await argon2.hash("Placeholder123", { type: argon2.argon2id }),
        },
      });
    });
  });

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  const validInput = (overrides: Partial<Record<string, unknown>> = {}) => ({
    schoolName: "Test Academy",
    schoolSlug: `test-school-${runId}`,
    ownerFirstName: "Ada",
    ownerLastName: "Owner",
    ownerEmail: `ada-${runId}@example.test`,
    ownerPhone: `+234802${phoneSuffix}`,
    password: "Correct-Horse-9",
    ndprConsent: true as const,
    ...overrides,
  });

  it("happy path — creates school, owner user, owner role grant, audit log, and returns a session token", async () => {
    const input = signupOwnerSchema.parse(validInput());
    const result = await service.signupOwner(input, ctx);

    schoolIdsToCleanup.add(result.school.id);

    expect(result.school.slug).toBe(input.schoolSlug);
    expect(result.user.email).toBe(input.ownerEmail);
    expect(result.user.firstName).toBe(input.ownerFirstName);
    expect(result.user.schoolId).toBe(result.school.id);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    // Public response must NOT carry the hash.
    expect((result.user as unknown as Record<string, unknown>).passwordHash).toBeUndefined();

    // The verification reads below need the tenant GUC set, otherwise FORCE
    // RLS returns null for every tenant-scoped table. `schools` is the only
    // one without RLS — it can be queried via basePrisma directly.
    const school = await basePrisma.school.findUnique({ where: { id: result.school.id } });
    expect(school?.ndprConsent).toBe(true);
    expect(school?.ndprConsentAt).toBeInstanceOf(Date);
    // A self-serve school starts with AI OFF (2026-08-14) — AI is rolled out
    // one school at a time from platform-admin. signupOwner states this
    // explicitly rather than leaning on the schema default, so this assertion
    // is what fails if that line is removed as "redundant" and the default
    // later changes. Enable via PATCH /platform-admin/schools/:id/ai.
    expect(school?.aiEnabled).toBe(false);

    await withTenant(result.school.id, async (db) => {
      // User row has a real argon2 hash, not the plaintext.
      const user = await db.user.findUnique({ where: { id: result.user.id } });
      expect(user?.passwordHash).toBeTruthy();
      expect(user?.passwordHash).not.toContain(input.password);
      expect(user?.passwordHash?.startsWith("$argon2")).toBe(true);
      expect(await argon2.verify(user!.passwordHash!, input.password)).toBe(true);

      // UserRole points at the 'owner' system role.
      const userRoles = await db.userRole.findMany({
        where: { userId: result.user.id },
        include: { role: { select: { key: true, isSystem: true } } },
      });
      expect(userRoles).toHaveLength(1);
      expect(userRoles[0]!.role.key).toBe("owner");
      expect(userRoles[0]!.role.isSystem).toBe(true);

      // Audit log row exists and email is redacted.
      const audit = await db.auditLog.findFirst({
        where: { schoolId: result.school.id, action: "auth.signup_owner" },
      });
      expect(audit).toBeTruthy();
      const meta = audit!.metadata as Record<string, unknown>;
      expect(meta.schoolSlug).toBe(input.schoolSlug);
      expect(meta.ownerEmail).not.toBe(input.ownerEmail);
      expect(String(meta.ownerEmail)).toContain("***");

      // Session row exists with a token HASH, not the raw token.
      const sessions = await db.session.findMany({ where: { userId: result.user.id } });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]!.tokenHash).not.toBe(result.token);
      expect(sessions[0]!.tokenHash).toHaveLength(64); // sha256 hex
    });
  });

  it("slug already taken — throws ConflictError SCHOOL_SLUG_TAKEN and persists nothing", async () => {
    const collidingSlug = `taken-${runId}`;
    const input = signupOwnerSchema.parse(
      validInput({
        schoolSlug: collidingSlug,
        ownerEmail: `slug-collider-${runId}@example.test`,
        ownerPhone: `+234803${phoneSuffix}`,
      }),
    );

    await expect(service.signupOwner(input, ctx)).rejects.toMatchObject({
      code: "SCHOOL_SLUG_TAKEN",
    });
    await expect(service.signupOwner(input, ctx)).rejects.toBeInstanceOf(ConflictError);

    // Nothing for this attempt persists. The pre-seeded school is still the
    // only thing under this slug; we never see a NEW school, user, or audit
    // row for this signup attempt.
    const schoolsWithSlug = await basePrisma.school.findMany({
      where: { slug: collidingSlug },
      select: { id: true },
    });
    expect(schoolsWithSlug).toHaveLength(1);
    expect(schoolsWithSlug[0]!.id).toBe(preSeededSchoolId);

    // The user + audit_log lookups are RLS-scoped — we scope to the
    // pre-seeded tenant because that is where any rolled-back rows would
    // have ended up if the WITH CHECK on the policies allowed leakage
    // (it does not, but we assert the negative anyway).
    await withTenant(preSeededSchoolId, async (db) => {
      // The pre-seeded user owns dup-${runId}@example.test; the colliding
      // signup tried a DIFFERENT email so it should NOT appear here.
      const newUser = await db.user.findFirst({ where: { email: input.ownerEmail } });
      expect(newUser).toBeNull();

      // The pre-seeded school had its user inserted directly (no signup
      // path), so an auth.signup_owner audit row would mean a rollback
      // leaked.
      const auditRowsForPreSeed = await db.auditLog.findMany({
        where: { schoolId: preSeededSchoolId, action: "auth.signup_owner" },
      });
      expect(auditRowsForPreSeed).toHaveLength(0);
    });
  });

  it("email already used — throws ConflictError EMAIL_TAKEN and persists nothing", async () => {
    const dupEmail = `dup-${runId}@example.test`;
    const newSlug = `email-collider-${runId}`;
    const input = signupOwnerSchema.parse(
      validInput({
        schoolSlug: newSlug,
        ownerEmail: dupEmail,
        ownerPhone: `+234804${phoneSuffix}`,
      }),
    );

    await expect(service.signupOwner(input, ctx)).rejects.toMatchObject({
      code: "EMAIL_TAKEN",
    });

    // Full rollback — the school we *would* have created does not exist.
    // `schools` has no RLS so this read works through basePrisma directly.
    const school = await basePrisma.school.findUnique({ where: { slug: newSlug } });
    expect(school).toBeNull();
    // The dup email row is still the pre-seeded one, scoped to the
    // pre-seeded tenant. Inside withTenant(preSeeded) we see exactly one.
    await withTenant(preSeededSchoolId, async (db) => {
      const usersWithEmail = await db.user.findMany({ where: { email: dupEmail } });
      expect(usersWithEmail).toHaveLength(1);
      expect(usersWithEmail[0]!.schoolId).toBe(preSeededSchoolId);
    });
  });

  it("phone already used — throws ConflictError PHONE_TAKEN", async () => {
    const dupPhone = `+234901${phoneSuffix}`;
    const newSlug = `phone-collider-${runId}`;
    const input = signupOwnerSchema.parse(
      validInput({
        schoolSlug: newSlug,
        ownerEmail: `phone-collider-${runId}@example.test`,
        ownerPhone: dupPhone,
      }),
    );

    await expect(service.signupOwner(input, ctx)).rejects.toMatchObject({
      code: "PHONE_TAKEN",
    });

    const school = await basePrisma.school.findUnique({ where: { slug: newSlug } });
    expect(school).toBeNull();
  });

  it("weak password — ZodSchema rejects before service runs", () => {
    const parsed = signupOwnerSchema.safeParse(validInput({ password: "abcdefg" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === "password")).toBe(true);
    }
  });

  it("password missing digits — ZodSchema rejects", () => {
    const parsed = signupOwnerSchema.safeParse(validInput({ password: "abcdefgh" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === "password")).toBe(true);
    }
  });

  it("NDPR consent not given — ZodSchema rejects", () => {
    const parsed = signupOwnerSchema.safeParse(validInput({ ndprConsent: false }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === "ndprConsent")).toBe(true);
    }
  });

  it("reserved slug — ZodSchema rejects 'admin'", () => {
    const parsed = signupOwnerSchema.safeParse(validInput({ schoolSlug: "admin" }));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path[0] === "schoolSlug")).toBe(true);
    }
  });

  it("invalid slug format — leading hyphen, uppercase, too short", () => {
    for (const bad of ["-leading-hyphen", "UPPER", "x", "trailing-"]) {
      const parsed = signupOwnerSchema.safeParse(validInput({ schoolSlug: bad }));
      expect(parsed.success, `expected '${bad}' to fail`).toBe(false);
    }
  });

  // ------------------------------------------------------------------
  // Slug is optional on the wire (2026-08-12) — the signup form stopped
  // collecting it and the service derives one from schoolName instead.
  // See signup-owner.dto.ts + common/slug/school-slug.ts.
  // ------------------------------------------------------------------

  it("omitted slug — ZodSchema accepts the payload with no schoolSlug at all", () => {
    const { schoolSlug: _omitted, ...withoutSlug } = validInput();
    const parsed = signupOwnerSchema.safeParse(withoutSlug);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.schoolSlug).toBeUndefined();
    }
  });

  it("omitted slug — derives a slug from the school name, and suffixes it on collision", async () => {
    // Two signups whose school names slugify identically. The first takes
    // the bare derived slug; the second must NOT fail with
    // SCHOOL_SLUG_TAKEN — it gets a "-2" suffix, invisibly to the user,
    // which is the whole point of removing the field from the form.
    const sharedName = `Bright Star Academy ${runId}`;
    const expectedBase = `bright-star-academy-${runId}`;

    const { schoolSlug: _a, ...firstInput } = validInput({
      schoolName: sharedName,
      ownerEmail: `derive-1-${runId}@example.test`,
      ownerPhone: `+234806${phoneSuffix}`,
    });
    const first = await service.signupOwner(signupOwnerSchema.parse(firstInput), ctx);
    schoolIdsToCleanup.add(first.school.id);
    expect(first.school.slug).toBe(expectedBase);

    const { schoolSlug: _b, ...secondInput } = validInput({
      schoolName: sharedName,
      ownerEmail: `derive-2-${runId}@example.test`,
      ownerPhone: `+234807${phoneSuffix}`,
    });
    const second = await service.signupOwner(signupOwnerSchema.parse(secondInput), ctx);
    schoolIdsToCleanup.add(second.school.id);
    expect(second.school.slug).toBe(`${expectedBase}-2`);
  });

  it("omitted slug — a school named after a RESERVED slug does not get that slug", async () => {
    // "Admin" slugifies to "admin", which is reserved (it's one of our own
    // subdomains). generateUniqueSchoolSlug must skip it rather than hand
    // the tenant a slug that collides with our routing.
    const { schoolSlug: _omitted, ...input } = validInput({
      schoolName: "Admin",
      ownerEmail: `reserved-${runId}@example.test`,
      ownerPhone: `+234808${phoneSuffix}`,
    });
    const result = await service.signupOwner(signupOwnerSchema.parse(input), ctx);
    schoolIdsToCleanup.add(result.school.id);

    expect(result.school.slug).not.toBe("admin");
    expect(result.school.slug).toMatch(/^admin-\d+$/);
  });

  it("ValidationError shape carries Zod issues in details", () => {
    // The pipe is what produces a ValidationError from the ZodError, but we
    // can sanity-check the constructor surface here.
    const err = new ValidationError("nope", { issues: [{ path: "password", code: "x", message: "y" }] });
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.httpStatus).toBe(400);
    expect(err.toBody().details).toEqual({ issues: [{ path: "password", code: "x", message: "y" }] });
  });
});

// ---------------------------------------------------------------------------
// 2FA management — setup / confirm / disable (integration against real DB)
// ---------------------------------------------------------------------------
describe("AuthService — 2FA management (Phase 3 Slice 2 CP2)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const phoneSuffix = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0");
  const service = new AuthService();
  const ctx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const schoolIdsToCleanup = new Set<string>();

  let schoolId: string;
  let userId: string;

  beforeAll(async () => {
    const owner = await basePrisma.role.findFirst({
      where: { schoolId: null, key: "owner", isSystem: true },
      select: { id: true },
    });
    if (!owner) throw new Error("System role 'owner' not seeded. Run pnpm db:seed.");

    // Create a fresh school + owner for 2FA tests.
    const result = await service.signupOwner(
      signupOwnerSchema.parse({
        schoolName: "2FA Test Academy",
        schoolSlug: `2fa-test-${runId}`,
        ownerFirstName: "Totp",
        ownerLastName: "Owner",
        ownerEmail: `totp-${runId}@example.test`,
        ownerPhone: `+234901${phoneSuffix}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      }),
      ctx,
    );
    schoolId = result.school.id;
    userId = result.user.id;
    schoolIdsToCleanup.add(schoolId);
  });

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
  });

  describe("getTwoFactorStatus", () => {
    it("returns enabled: false before any setup", async () => {
      const status = await service.getTwoFactorStatus(userId, schoolId);
      expect(status.enabled).toBe(false);
    });
  });

  describe("setupTwoFactor", () => {
    it("stores a pending secret and returns otpAuthUrl + secret", async () => {
      const result = await service.setupTwoFactor(userId, schoolId);

      expect(result.otpAuthUrl).toMatch(/^otpauth:\/\/totp\//);
      expect(result.secret).toMatch(/^[A-Z2-7]+$/);

      // Pending secret is written; active secret and enabled flag are still unset.
      const user = await withTenant(schoolId, (db) =>
        db.user.findUniqueOrThrow({
          where: { id: userId },
          select: { totpPendingSecret: true, totpSecret: true, totpEnabled: true },
        }),
      );
      expect(user.totpPendingSecret).toBe(result.secret);
      expect(user.totpSecret).toBeNull();
      expect(user.totpEnabled).toBe(false);
    });

    it("overwriting setup replaces the pending secret", async () => {
      const first = await service.setupTwoFactor(userId, schoolId);
      const second = await service.setupTwoFactor(userId, schoolId);
      expect(second.secret).not.toBe(first.secret);

      const user = await withTenant(schoolId, (db) =>
        db.user.findUniqueOrThrow({
          where: { id: userId },
          select: { totpPendingSecret: true },
        }),
      );
      expect(user.totpPendingSecret).toBe(second.secret);
    });
  });

  describe("confirmTwoFactor", () => {
    it("wrong code — throws INVALID_2FA_CODE", async () => {
      await service.setupTwoFactor(userId, schoolId);
      await expect(
        service.confirmTwoFactor(userId, schoolId, { code: "000000" }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it("correct code — activates 2FA and writes audit log", async () => {
      const { secret } = await service.setupTwoFactor(userId, schoolId);
      const code = generateSync({ secret });

      await service.confirmTwoFactor(userId, schoolId, { code });

      const user = await withTenant(schoolId, (db) =>
        db.user.findUniqueOrThrow({
          where: { id: userId },
          select: { totpSecret: true, totpPendingSecret: true, totpEnabled: true },
        }),
      );
      expect(user.totpEnabled).toBe(true);
      expect(user.totpSecret).toBe(secret);
      expect(user.totpPendingSecret).toBeNull();

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({ where: { schoolId, action: "auth.2fa.enable" } }),
      );
      expect(audit).toBeTruthy();
    });

    it("getTwoFactorStatus returns enabled: true after confirm", async () => {
      const status = await service.getTwoFactorStatus(userId, schoolId);
      expect(status.enabled).toBe(true);
    });
  });

  describe("disableTwoFactor", () => {
    it("wrong password — throws INVALID_CREDENTIALS", async () => {
      await expect(
        service.disableTwoFactor(userId, schoolId, { currentPassword: "wrong-password" }),
      ).rejects.toThrow(UnauthorizedError);
    });

    it("correct password — clears 2FA columns and writes audit log", async () => {
      await service.disableTwoFactor(userId, schoolId, { currentPassword: "Correct-Horse-9" });

      const user = await withTenant(schoolId, (db) =>
        db.user.findUniqueOrThrow({
          where: { id: userId },
          select: { totpSecret: true, totpPendingSecret: true, totpEnabled: true },
        }),
      );
      expect(user.totpEnabled).toBe(false);
      expect(user.totpSecret).toBeNull();
      expect(user.totpPendingSecret).toBeNull();

      const audit = await withTenant(schoolId, (db) =>
        db.auditLog.findFirst({ where: { schoolId, action: "auth.2fa.disable" } }),
      );
      expect(audit).toBeTruthy();
    });

    it("attempting to disable when already disabled — throws ValidationError", async () => {
      await expect(
        service.disableTwoFactor(userId, schoolId, { currentPassword: "Correct-Horse-9" }),
      ).rejects.toThrow(ValidationError);
    });
  });
});
