import * as crypto from "node:crypto";

import { type APIRequestContext, type APIResponse } from "@playwright/test";

// Guardian portal fixtures — creates a guardian, invites them, and accepts
// the invitation so the account is portal-enabled and can be signed in with.
//
// Same principle as the rest of e2e/fixtures: API-FIRST SETUP, UI-ONLY
// ASSERTIONS. The browser is reserved for the auth screens under test.
//
// Every guardian created here belongs to a throwaway school provisioned by
// loginAsAdmin, on the LOCAL docker Postgres that DATABASE_URL points at.
// No real guardian account is ever touched.

export const PORTAL_BASE_URL = process.env.E2E_PORTAL_URL ?? "http://localhost:3002";

async function unwrap<T>(res: APIResponse, label: string): Promise<T> {
  if (!res.ok()) {
    throw new Error(
      `${label} failed: ${res.status()} ${res.statusText()} — ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

export interface PortalGuardian {
  guardianId: string;
  schoolId: string;
  studentId: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  studentFirstName: string;
}

/**
 * Create a student, a guardian linked to them, invite the guardian, and
 * accept the invitation — leaving an account that can sign in to the portal.
 *
 * The accept step is what sets Guardian.passwordHash, which is the schema's
 * definition of "portal-enabled" and exactly what forgot-password filters on.
 */
export async function createPortalGuardian(
  api: APIRequestContext,
  input: { suffix: string; schoolId: string; password?: string },
): Promise<PortalGuardian> {
  const password = input.password ?? "Correct-Horse-9";
  const email = `guardian-${input.suffix}@school-kit.test`;
  const firstName = "Ngozi";
  const lastName = "Adeleke";
  const studentFirstName = "Chidinma";

  const student = await unwrap<{ id: string }>(
    await api.post("students", {
      data: {
        admissionNumber: `SKA/G/${input.suffix}`,
        firstName: studentFirstName,
        lastName: "Adeleke",
        dateOfBirth: "2013-04-02T00:00:00.000Z",
        gender: "FEMALE",
      },
    }),
    "createStudent",
  );

  // NOTE the response shape: this endpoint returns
  // { link, guardian, createdGuardian }, NOT a bare guardian. Reading
  // `body.id` here yields undefined and the invite below then 404s on
  // /guardians/undefined/invite — which is exactly how this fixture failed
  // the first time.
  const created = await unwrap<{ guardian: { id: string } }>(
    await api.post(`students/${student.id}/guardians/new`, {
      data: {
        firstName,
        lastName,
        relationship: "MOTHER",
        phone: `+23480${String(Math.floor(Math.random() * 100_000_000)).padStart(8, "0")}`,
        email,
        isPrimary: true,
      },
    }),
    "createGuardianForStudent",
  );
  const guardianId = created.guardian.id;

  const invited = await unwrap<{ acceptUrl: string }>(
    await api.post(`guardians/${guardianId}/invite`, { data: {} }),
    "inviteGuardian",
  );

  const token = invited.acceptUrl.split("/invitations/")[1];
  if (!token) throw new Error(`no token in acceptUrl: ${invited.acceptUrl}`);

  await unwrap(
    // ndprConsent is a required literal true on this schema — a guardian
    // genuinely has to tick it in the real accept form, so the fixture must
    // send it too rather than pretending the field is optional.
    await api.post(`portal/invitations/${token}/accept`, {
      data: { password, ndprConsent: true },
    }),
    "acceptGuardianInvitation",
  );

  // Accepting an invitation IS a login — the endpoint mints a session and
  // returns a token (AcceptGuardianInvitationResponse is GuardianLoginResponse).
  // The fixture throws that token away, which would otherwise leave an orphan
  // session and make every "this guardian has N sessions" assertion off by
  // one. Clear it so specs start from a known zero.
  const { withTenant } = await import("@school-kit/db");
  await withTenant(input.schoolId, (db) =>
    db.guardianSession.deleteMany({ where: { guardianId } }),
  );

  return {
    guardianId,
    schoolId: input.schoolId,
    studentId: student.id,
    email,
    password,
    firstName,
    lastName,
    studentFirstName,
  };
}

/** How many live (unused) reset tokens this guardian currently has. */
export async function liveResetTokenCount(
  schoolId: string,
  guardianId: string,
): Promise<number> {
  const { withTenant } = await import("@school-kit/db");
  return withTenant(schoolId, (db) =>
    db.guardianPasswordResetToken.count({ where: { guardianId, usedAt: null } }),
  );
}

/** How many live portal sessions this guardian currently has. */
export async function sessionCount(schoolId: string, guardianId: string): Promise<number> {
  const { withTenant } = await import("@school-kit/db");
  return withTenant(schoolId, (db) =>
    db.guardianSession.count({ where: { guardianId } }),
  );
}

/**
 * Mint a reset token directly and hand back the RAW value.
 *
 * WHY THE TEST MINTS IT RATHER THAN READING ONE. The raw token is,
 * by design, never persisted — only its sha256 hash is — and there is no
 * Resend inbox in a test environment to read the emailed copy from. So the
 * browser journey from a valid link onwards is driven with a token seeded
 * here, whose hash is written exactly the way the service writes it.
 *
 * The half this cannot cover — that requesting a reset through the UI really
 * does issue a token, and that the response is enumeration-safe — is covered
 * separately and directly: the forgot-password e2e asserts a live token row
 * appears for the guardian afterwards, and
 * apps/api/.../portal-auth.recovery.spec.ts captures the actual outgoing
 * emails and asserts one per school, none for unknown or never-invited
 * addresses.
 *
 * @param expiresInMs negative to mint an already-expired token.
 */
export async function mintResetToken(
  schoolId: string,
  guardianId: string,
  expiresInMs = 60 * 60 * 1000,
): Promise<string> {
  const { withTenant } = await import("@school-kit/db");
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

  await withTenant(schoolId, (db) =>
    db.guardianPasswordResetToken.create({
      data: {
        schoolId,
        guardianId,
        tokenHash,
        expiresAt: new Date(Date.now() + expiresInMs),
      },
    }),
  );

  return rawToken;
}
