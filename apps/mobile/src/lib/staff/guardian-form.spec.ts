import {
  createAndLinkGuardianSchema,
  createEnrollmentSchema,
  deriveGuardianPortalStatus,
  linkExistingGuardianSchema,
  type CreateStudentGuardianLinkResponse,
  type GuardianListResponse,
  type GuardianPortalStatusDto,
  type InviteGuardianResponse,
  type StudentDto,
} from "@school-kit/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setTokenProvider } from "../api/client";
import {
  staffCreateAndLinkGuardian,
  staffEnrollStudent,
  staffInviteGuardian,
  staffLinkGuardian,
  staffResendGuardianInvite,
  staffRevokeGuardianInvite,
  staffSearchGuardians,
} from "../api/staff-guardians";
import {
  buildCreateParentInput,
  emptyParentForm,
  needsPlacement,
  parentAbilities,
  portalActions,
  validateParentForm,
  type NewParentValues,
} from "./guardian-form";

const STUDENT = "0b8e5f7a-3c1d-4e2f-9a6b-1c2d3e4f5a6b";
const GUARDIAN = "9f1e2d3c-4b5a-4968-8776-655443322110";
const TERM = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ARM = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";

const PARENT: NewParentValues = {
  firstName: "Ngozi",
  lastName: "Okafor",
  relationship: "MOTHER",
  phone: "0803 123 4567",
  email: "",
  isPrimary: true,
};

describe("who may manage parents and placement", () => {
  it("is owners and admins with the permission — the two checks the services make", () => {
    expect(parentAbilities([{ key: "admin" }], ["guardian.create", "guardian.invite"])).toEqual({
      link: true,
      invite: true,
      update: false,
      place: false,
    });
    expect(parentAbilities([{ key: "owner" }], ["*"])).toEqual({ link: true, invite: true, update: true, place: true });
  });

  it("is never a teacher or a bursar, whatever they hold", () => {
    expect(parentAbilities([{ key: "teacher" }], ["*"]).link).toBe(false);
    expect(parentAbilities([{ key: "bursar" }], ["guardian.invite"]).invite).toBe(false);
  });
});

describe("portal actions — exactly what the server accepts", () => {
  it("maps each status to its actions", () => {
    expect(portalActions("NO_EMAIL")).toEqual(["add-email"]);
    expect(portalActions("NOT_INVITED")).toEqual(["invite"]);
    // An expired invitation is not live, so a fresh invite is accepted.
    expect(portalActions("EXPIRED")).toEqual(["invite"]);
    expect(portalActions("INVITED")).toEqual(["resend", "revoke"]);
    expect(portalActions("ACTIVE")).toEqual([]);
  });

  it("never offers Invite while an invitation is live (INVITATION_ALREADY_PENDING)", () => {
    const status: GuardianPortalStatusDto = deriveGuardianPortalStatus(
      {
        hasEmail: true,
        hasPassword: false,
        invitations: [{ acceptedAt: null, revokedAt: null, expiresAt: "2099-01-01T00:00:00.000Z" }],
      },
      new Date("2026-09-21T00:00:00.000Z"),
    ).status;
    expect(portalActions(status)).not.toContain("invite");
  });
});

describe("the new-parent form", () => {
  it("offers the first parent as main contact, and later ones not", () => {
    expect(emptyParentForm(0).isPrimary).toBe(true);
    expect(emptyParentForm(1).isPrimary).toBe(false);
    expect(emptyParentForm(0).relationship).toBeNull();
  });

  it("requires names, a relationship and a phone; email is optional", () => {
    expect(Object.keys(validateParentForm(emptyParentForm(0))).sort()).toEqual([
      "firstName",
      "lastName",
      "phone",
      "relationship",
    ]);
    expect(validateParentForm(PARENT)).toEqual({});
  });

  it("refuses a phone that isn't one, and a malformed email", () => {
    expect(validateParentForm({ ...PARENT, phone: "call me" }).phone).toBeDefined();
    expect(validateParentForm({ ...PARENT, phone: "12345" }).phone).toBeDefined();
    expect(validateParentForm({ ...PARENT, email: "ngozi@" }).email).toBeDefined();
    expect(validateParentForm({ ...PARENT, phone: "+234 803 123 4567", email: "n@x.ng" })).toEqual({});
  });

  it("builds a body the API's strict schema accepts, with a blank email as null", () => {
    const input = buildCreateParentInput({ ...PARENT, firstName: " Ngozi ", email: "" });
    expect(input.firstName).toBe("Ngozi");
    expect(input.email).toBeNull();
    expect(createAndLinkGuardianSchema.safeParse(input).success).toBe(true);
    expect(buildCreateParentInput({ ...PARENT, email: " N@X.NG " }).email).toBe("n@x.ng");
  });
});

describe("needsPlacement", () => {
  const enrolled = (termId: string): Pick<StudentDto, "status" | "currentEnrollment"> => ({
    status: "ACTIVE",
    currentEnrollment: {
      id: "e-1",
      status: "ENROLLED",
      classArm: { id: ARM, name: "JSS1A", classLevel: { id: "l-1", name: "JSS1" } },
      term: { id: termId, name: "First term", sequence: 1 },
      academicYearId: "y-1",
    },
  });

  it("is true for an active child with no class this term", () => {
    expect(needsPlacement({ status: "ACTIVE", currentEnrollment: null }, TERM)).toBe(true);
    expect(needsPlacement(enrolled("another-term"), TERM)).toBe(true);
  });

  it("is false once placed, for a child who has left, or with no current term", () => {
    expect(needsPlacement(enrolled(TERM), TERM)).toBe(false);
    expect(needsPlacement({ status: "WITHDRAWN", currentEnrollment: null }, TERM)).toBe(false);
    expect(needsPlacement({ status: "ACTIVE", currentEnrollment: null }, null)).toBe(false);
  });
});

describe("parent and placement bindings", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setTokenProvider(() => "test-token");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTokenProvider(() => null);
  });

  function respond(body: unknown, status = 200): void {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status })));
  }

  function lastCall(): { url: URL; init: RequestInit; body: unknown } {
    const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    return { url: new URL(url), init, body: init.body ? JSON.parse(init.body as string) : undefined };
  }

  it("searches parents by name or phone", async () => {
    const list: GuardianListResponse = { data: [], meta: {} };
    respond(list);
    await staffSearchGuardians("Okafor");
    expect(lastCall().url.pathname).toMatch(/\/guardians$/);
    expect(lastCall().url.searchParams.get("search")).toBe("Okafor");
  });

  it("links an existing parent, or creates and links a new one, with valid bodies", async () => {
    const linked = { link: { id: "l" }, guardian: { id: GUARDIAN }, createdGuardian: false } as unknown as CreateStudentGuardianLinkResponse;
    respond(linked, 201);
    await staffLinkGuardian(STUDENT, { guardianId: GUARDIAN, isPrimary: false });
    expect(lastCall().url.pathname).toMatch(new RegExp(`/students/${STUDENT}/guardians$`));
    expect(linkExistingGuardianSchema.safeParse(lastCall().body).success).toBe(true);

    await staffCreateAndLinkGuardian(STUDENT, buildCreateParentInput(PARENT));
    expect(lastCall().url.pathname).toMatch(/\/guardians\/new$/);
    expect(createAndLinkGuardianSchema.safeParse(lastCall().body).success).toBe(true);
  });

  it("invites, resends and revokes on their own routes, with no body", async () => {
    const invite: InviteGuardianResponse = {
      guardianId: GUARDIAN,
      portalInvitedAt: "2026-09-21T10:00:00.000Z",
      acceptUrl: "https://portal.schoolkit.ng/accept-invite/tok",
    };
    respond(invite, 201);
    const result = await staffInviteGuardian(GUARDIAN);
    expect(result.acceptUrl).toMatch(/^https:/);
    expect(lastCall().url.pathname).toMatch(/\/invite$/);
    expect(lastCall().init.body).toBeUndefined();

    respond({ ...invite, replaced: true });
    await staffResendGuardianInvite(GUARDIAN);
    expect(lastCall().url.pathname).toMatch(/\/invite\/resend$/);

    respond({ guardianId: GUARDIAN, revokedAt: "2026-09-21T10:00:00.000Z" });
    await staffRevokeGuardianInvite(GUARDIAN);
    expect(lastCall().url.pathname).toMatch(/\/invite\/revoke$/);
  });

  it("places a child with the body POST /enrollments validates", async () => {
    respond({ id: "e-1" }, 201);
    await staffEnrollStudent({ studentId: STUDENT, termId: TERM, classArmId: ARM });
    expect(lastCall().init.method).toBe("POST");
    expect(createEnrollmentSchema.safeParse(lastCall().body).success).toBe(true);
  });
});
