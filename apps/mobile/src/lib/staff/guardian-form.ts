import {
  RELATIONSHIP_VALUES,
  type AuthMeRoleDto,
  type CreateAndLinkGuardianInput,
  type GuardianPortalStatusDto,
  type RelationshipDto,
  type StudentDto,
} from "@school-kit/types";

import { hasPermission } from "../auth/permissions";
import { isSchoolAdmin } from "../auth/roles";

// CP9a — the rules behind linking a parent, inviting them to the portal, and
// placing a child in a class, from the phone.
//
// Pure and separately tested because each mirrors a server rule exactly, and
// a disagreement costs a parent their access or a child their place:
//
// 1. WHO MAY. GuardiansService and EnrollmentsService check the owner/admin
//    ROLE on every write, on top of the permission.
// 2. WHICH PORTAL ACTION. Offered from the parent's portal status, which the
//    server derives in one place (deriveGuardianPortalStatus). Invite is
//    refused while an invitation is live (INVITATION_ALREADY_PENDING) and for
//    an active parent (GUARDIAN_ALREADY_ACTIVE); resend and cancel need a live
//    one (NO_PENDING_INVITATION). The phone offers exactly what is accepted.
// 3. MAIN CONTACT IS A VISIBLE ANSWER. The first parent linked to a child is
//    offered as the main contact; any later one is not. It is shown on the
//    form and can be changed — never applied behind the admin's back.

export interface ParentAbilities {
  link: boolean;
  invite: boolean;
  update: boolean;
  place: boolean;
  /** D39 — move a placed child to another class, same term. */
  move: boolean;
}

export function parentAbilities(
  roles: readonly Pick<AuthMeRoleDto, "key">[] | undefined,
  permissions: readonly string[],
): ParentAbilities {
  const admin = isSchoolAdmin(roles);
  return {
    link: admin && hasPermission(permissions, "guardian.create"),
    invite: admin && hasPermission(permissions, "guardian.invite"),
    update: admin && hasPermission(permissions, "guardian.update"),
    place: admin && hasPermission(permissions, "enrollment.create"),
    move: admin && hasPermission(permissions, "enrollment.update"),
  };
}

export type PortalAction = "add-email" | "invite" | "resend" | "revoke";

/** The portal actions the server will accept for a parent in this state. */
export function portalActions(status: GuardianPortalStatusDto): PortalAction[] {
  switch (status) {
    case "NO_EMAIL":
      return ["add-email"];
    case "NOT_INVITED":
    case "EXPIRED":
      return ["invite"];
    case "INVITED":
      return ["resend", "revoke"];
    case "ACTIVE":
      return [];
  }
}

export function describePortalStatus(status: GuardianPortalStatusDto): string {
  switch (status) {
    case "NO_EMAIL":
      return "No email address — add one to invite them to the parent app";
    case "NOT_INVITED":
      return "Not invited to the parent app yet";
    case "INVITED":
      return "Invited — waiting for them to set a password";
    case "EXPIRED":
      return "Their invitation ran out before they used it";
    case "ACTIVE":
      return "Using the parent app";
  }
}

export const RELATIONSHIP_LABELS: Record<RelationshipDto, string> = {
  FATHER: "Father",
  MOTHER: "Mother",
  GUARDIAN: "Guardian",
  UNCLE: "Uncle",
  AUNT: "Aunt",
  GRANDPARENT: "Grandparent",
  SIBLING: "Sibling",
  OTHER: "Other",
};

export const RELATIONSHIP_OPTIONS = RELATIONSHIP_VALUES.map((value) => ({
  value,
  label: RELATIONSHIP_LABELS[value],
}));

export interface NewParentValues {
  firstName: string;
  lastName: string;
  relationship: RelationshipDto | null;
  phone: string;
  email: string;
  isPrimary: boolean;
}

/** A blank parent form. The first parent for a child is offered as the main contact. */
export function emptyParentForm(existingParents: number): NewParentValues {
  return {
    firstName: "",
    lastName: "",
    relationship: null,
    phone: "",
    email: "",
    isPrimary: existingParents === 0,
  };
}

export type NewParentErrors = Partial<Record<"firstName" | "lastName" | "relationship" | "phone" | "email", string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPlausibleEmail(text: string): boolean {
  return EMAIL.test(text.trim()) && text.trim().length <= 254;
}

export function validateParentForm(v: NewParentValues): NewParentErrors {
  const errors: NewParentErrors = {};
  if (v.firstName.trim() === "") errors.firstName = "Enter their first name.";
  else if (v.firstName.trim().length > 60) errors.firstName = "Keep it under 60 characters.";
  if (v.lastName.trim() === "") errors.lastName = "Enter their surname.";
  else if (v.lastName.trim().length > 60) errors.lastName = "Keep it under 60 characters.";
  if (v.relationship === null) errors.relationship = "Choose how they are related to the child.";
  const digits = v.phone.replace(/\D/g, "");
  if (v.phone.trim() === "") errors.phone = "Enter a phone number — it is how the school reaches them.";
  else if (digits.length < 7 || !/^[+\d\s()-]+$/.test(v.phone.trim()) || v.phone.trim().length > 30) {
    errors.phone = "That doesn't look like a phone number.";
  }
  if (v.email.trim() !== "" && !isPlausibleEmail(v.email)) {
    errors.email = "That doesn't look like an email address. Leave it blank if they have none.";
  }
  return errors;
}

/** Call only after validateParentForm returned no errors. */
export function buildCreateParentInput(v: NewParentValues): CreateAndLinkGuardianInput {
  const email = v.email.trim();
  return {
    firstName: v.firstName.trim(),
    lastName: v.lastName.trim(),
    relationship: v.relationship as RelationshipDto,
    phone: v.phone.trim(),
    email: email === "" ? null : email.toLowerCase(),
    isPrimary: v.isPrimary,
  };
}

/**
 * Whether a child still needs a class for the current term: active, and with
 * no enrolment in THAT term. An enrolment from last term does not count — a
 * child left there after the new term opens is exactly the case to catch.
 */
export function needsPlacement(
  student: Pick<StudentDto, "status" | "currentEnrollment">,
  currentTermId: string | null,
): boolean {
  if (student.status !== "ACTIVE" || currentTermId === null) return false;
  return student.currentEnrollment?.term.id !== currentTermId;
}

/**
 * Whether a child can be moved to another class this term: active, and
 * ENROLLED in the current term — the state EnrollmentsService.move requires.
 */
export function canMoveClass(
  student: Pick<StudentDto, "status" | "currentEnrollment">,
  currentTermId: string | null,
): boolean {
  if (student.status !== "ACTIVE" || currentTermId === null) return false;
  const e = student.currentEnrollment;
  return !!e && e.term.id === currentTermId && e.status === "ENROLLED";
}

/** What the password prompt tells the admin will change (from MOVE_NEEDS_PASSWORD's details). */
export function describeMoveRecords(details: unknown): string {
  const d = (details ?? {}) as { markCount?: unknown; hasReportCard?: unknown };
  const marks = typeof d.markCount === "number" ? d.markCount : 0;
  const parts: string[] = [];
  if (marks > 0) parts.push(`${marks} mark${marks === 1 ? "" : "s"} already entered will move with them`);
  if (d.hasReportCard === true) parts.push("their draft report card will be rebuilt in the new class");
  return parts.length > 0 ? `${parts.join(", and ")}.` : "their records this term will move with them.";
}
