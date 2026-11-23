import { z } from "zod";

// AI governance for the SchoolKit Assistant (2026-11-22,
// docs/modules/assistant-ai-governance.md).
//
// Three independent controls decide whether a school's staff text may reach a
// model provider. All must hold; each is enforced on the server on every turn:
//
//   1. RELEASE AUTHORISATION, platform-wide, per DATA SCOPE (FICTIONAL / LIVE).
//      A code-defined checklist (engineering checks with test evidence, plus
//      human attestations recorded by the platform admin), then an explicit
//      authorisation. Revoking it is the immediate kill switch.
//   2. THE SCHOOL'S CLASSIFICATION and SWITCH, set by the platform admin only.
//      A FICTIONAL school (a pilot tenant holding invented records) can only
//      use a FICTIONAL release; a LIVE school needs the LIVE release.
//   3. THE SCHOOL OWNER'S ACCEPTANCE of the current AI terms. Accepting never
//      switches anything on; withdrawing stops AI understanding at once.

export const AI_DATA_CLASSIFICATIONS = ["LIVE", "FICTIONAL"] as const;
export type AiDataClassification = (typeof AI_DATA_CLASSIFICATIONS)[number];
/** A release covers one data scope; a school's classification picks the scope it needs. */
export type AiReleaseScope = AiDataClassification;

export const aiReleaseScopeSchema = z.enum(AI_DATA_CLASSIFICATIONS);

export type AiReleaseRequirementKind = "engineering" | "attestation";

export interface AiReleaseRequirementDto {
  id: string;
  kind: AiReleaseRequirementKind;
  title: string;
  /** What has to be true. For an attestation, the exact statement the platform admin confirms. */
  statement: string;
  /**
   * engineering: "verified" only when the code records it with evidence (a
   * test that names the check), "open" otherwise. attestation: "attested"
   * once recorded for the current requirements version, else "open".
   */
  status: "verified" | "attested" | "open";
  /** Engineering: the evidence in the repository. Attestation: the reference the admin recorded. */
  evidence: string | null;
  attestedAt: string | null;
  attestedBy: string | null;
}

export interface AiReleaseScopeStatusDto {
  scope: AiReleaseScope;
  requirementsVersion: string;
  /** Every requirement is verified or attested. */
  complete: boolean;
  /** complete, AND the platform admin authorised it, AND it has not been revoked since. */
  authorised: boolean;
  /** Whether this deployment enforces the release (always in production). */
  enforced: boolean;
  lastDecision: { action: "AUTHORISE" | "REVOKE"; at: string; by: string | null; reference: string | null } | null;
  requirements: AiReleaseRequirementDto[];
}

export interface AiReleaseStatusDto {
  scopes: Record<AiReleaseScope, AiReleaseScopeStatusDto>;
}

/** A short free-text pointer to where the evidence lives (a document, a ticket, a dated note). Never a secret. */
const reference = z.string().trim().min(3).max(300);

export const aiReleaseAttestSchema = z
  .object({ requirementId: z.string().min(3).max(80), confirm: z.literal(true), reference })
  .strict();
export type AiReleaseAttestInput = z.infer<typeof aiReleaseAttestSchema>;

export const aiReleaseAuthoriseSchema = z.object({ confirm: z.literal(true), reference }).strict();
export type AiReleaseAuthoriseInput = z.infer<typeof aiReleaseAuthoriseSchema>;

export const aiReleaseRevokeSchema = z.object({ reason: reference }).strict();
export type AiReleaseRevokeInput = z.infer<typeof aiReleaseRevokeSchema>;

/** PATCH /platform-admin/schools/:schoolId/ai-data-classification */
export const platformAdminSetAiClassificationSchema = z
  .object({ classification: aiReleaseScopeSchema, existingRecordsReview: z.object({ confirmFictionalOnly: z.literal(true), evidenceReference: reference, reviewedSchoolName: z.string().trim().min(3).max(200) }).strict().optional() })
  .strict();
export type PlatformAdminSetAiClassificationInput = z.infer<typeof platformAdminSetAiClassificationSchema>;

export interface PlatformAdminSetAiClassificationResponse {
  schoolId: string;
  classification: AiDataClassification;
}

/** POST /platform-admin/schools/:schoolId/fictional-pilot/seed */
export interface PlatformAdminFictionalSeedResponse {
  schoolId: string;
  students: number;
  guardians: number;
  classArms: number;
  terms: number;
}

// ─── School owner: AI terms ──────────────────────────────────────────────────
//
// Versioned like the school's data-protection consent (CLAUDE.md, Consent):
// a change to what the school agrees to gets a new version, and the owner is
// asked again. The record keeps the version AND a hash of the exact wording.
//
// ENGINEERING DRAFT, accurate to the verified system and to the providers'
// published standard API terms (2026-11-22). Counsel's approval of this
// wording is a LIVE release requirement ("live.counsel-terms").

export const SCHOOL_AI_TERMS_VERSION = "2026-11-22";

export const SCHOOL_AI_TERMS_POINTS = [
  "When SchoolKit switches AI understanding on for our school, what staff type to the SchoolKit Assistant is sent to Anthropic, an AI model provider, to be understood. If SchoolKit also switches voice on, what staff say is sent to OpenAI to be transcribed, and the Assistant's replies are sent to OpenAI to be spoken.",
  "Before anything is sent, SchoolKit replaces the names of our students, parents and staff with placeholders, blocks contact details, ID numbers, full dates and pasted lists, and gives the provider only labels and counts from our records. These checks cannot catch everything a person types or says, so our staff must not type or say personal details about children or families.",
  "Under their standard API terms, the providers may keep requests for up to 30 days for safety monitoring and do not use them to train their models. SchoolKit has not arranged zero data retention with either provider. SchoolKit does not store the conversations, audio or transcripts.",
  "The Assistant can prepare previews only. Approving, issuing, sending or saving anything is always done by a member of staff on the card itself.",
  "Only SchoolKit can switch AI understanding on or off for our school. We can withdraw this acceptance at any time, and AI understanding then stops at once.",
  "I am authorised to accept this for the school, and the school will tell its staff, and parents where required, that it uses this feature.",
] as const;

export const schoolAiTermsAcceptSchema = z
  .object({ version: z.string().min(1).max(40), accept: z.literal(true, { errorMap: () => ({ message: "Tick the box to accept." }) }) })
  .strict();
export type SchoolAiTermsAcceptInput = z.infer<typeof schoolAiTermsAcceptSchema>;

export const schoolAiTermsWithdrawSchema = z.object({ withdraw: z.literal(true) }).strict();
export type SchoolAiTermsWithdrawInput = z.infer<typeof schoolAiTermsWithdrawSchema>;

/** GET /schools/me/ai-terms */
export interface SchoolAiTermsDto {
  currentVersion: string;
  points: readonly string[];
  /** True when the latest decision is an acceptance of the current version. */
  accepted: boolean;
  /** The latest decision, whatever its version. */
  latest: { action: "ACCEPT" | "WITHDRAW"; version: string; at: string; byName: string | null } | null;
  /** Only the school's owner can accept or withdraw. */
  canDecide: boolean;
}
