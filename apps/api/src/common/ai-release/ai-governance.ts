import { createHash } from "node:crypto";

import {
  AI_RELEASE_REQUIREMENTS_VERSION,
  aiReleaseRequirementsFor,
  type AiReleaseRequirement,
} from "@school-kit/ai";
import { withTenant } from "@school-kit/db";
import {
  SCHOOL_AI_TERMS_POINTS,
  SCHOOL_AI_TERMS_VERSION,
  type AiDataClassification,
  type AiReleaseRequirementDto,
  type AiReleaseScope,
  type AiReleaseScopeStatusDto,
} from "@school-kit/types";

// SchoolKit Assistant AI governance (docs/modules/assistant-ai-governance.md).
//
// The pure rules that decide whether a release is authorised, and the one
// per-school read the model-routing gate makes on EVERY turn. No cache: a
// revocation, a switch-off or a withdrawn acceptance stops the next request.

/** Production always enforces; elsewhere only when AI_RELEASE_ENFORCEMENT=on (tests of the gate itself). */
export function aiReleaseEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "production" || env.AI_RELEASE_ENFORCEMENT === "on";
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** What an attestation commits to: the requirements version, the requirement and its exact words. */
export function attestationHash(req: AiReleaseRequirement): string {
  return sha256(`${AI_RELEASE_REQUIREMENTS_VERSION}\n${req.id}\n${req.statement}`);
}

/** The exact AI terms wording an acceptance commits to. */
export function aiTermsWordingHash(version: string = SCHOOL_AI_TERMS_VERSION, points: readonly string[] = SCHOOL_AI_TERMS_POINTS): string {
  return sha256(`${version}\n${points.join("\n")}`);
}

export interface ReleaseEventRow {
  scope: string;
  action: string;
  requirementId: string | null;
  requirementsVersion: string;
  statementSha256: string | null;
  reference: string;
  recordedBy: string;
  recordedAt: Date;
}

/**
 * A scope's status from its events (any order). An attestation counts only
 * for the CURRENT requirements version and the CURRENT wording. An
 * authorisation counts only if it was made for the current version, after the
 * latest revocation, and the checklist is complete now (a later code change
 * that re-opens a check withdraws it).
 */
export function computeScopeStatus(
  scope: AiReleaseScope,
  events: readonly ReleaseEventRow[],
  enforced: boolean,
  nameOf: (userId: string) => string | null = () => null,
): AiReleaseScopeStatusDto {
  const mine = events.filter((e) => e.scope === scope).sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const requirements: AiReleaseRequirementDto[] = aiReleaseRequirementsFor(scope).map((r) => {
    if (r.kind === "engineering") {
      return {
        id: r.id, kind: r.kind, title: r.title, statement: r.statement,
        status: r.status === "verified" && r.evidence.length > 0 ? "verified" : "open",
        evidence: r.evidence.length > 0 ? r.evidence.join(", ") : null,
        attestedAt: null, attestedBy: null,
      };
    }
    const hash = attestationHash(r);
    const attest = [...mine].reverse().find(
      (e) => e.action === "ATTEST" && e.requirementId === r.id && e.requirementsVersion === AI_RELEASE_REQUIREMENTS_VERSION && e.statementSha256 === hash,
    );
    return {
      id: r.id, kind: r.kind, title: r.title, statement: r.statement,
      status: attest ? "attested" : "open",
      evidence: attest?.reference ?? null,
      attestedAt: attest?.recordedAt.toISOString() ?? null,
      attestedBy: attest ? nameOf(attest.recordedBy) : null,
    };
  });
  const complete = requirements.every((r) => r.status !== "open");
  const decision = [...mine].reverse().find((e) => e.action === "AUTHORISE" || e.action === "REVOKE") ?? null;
  const authorised = complete && decision?.action === "AUTHORISE" && decision.requirementsVersion === AI_RELEASE_REQUIREMENTS_VERSION;
  return {
    scope,
    requirementsVersion: AI_RELEASE_REQUIREMENTS_VERSION,
    complete,
    authorised,
    enforced,
    lastDecision: decision
      ? { action: decision.action as "AUTHORISE" | "REVOKE", at: decision.recordedAt.toISOString(), by: nameOf(decision.recordedBy), reference: decision.reference }
      : null,
    requirements,
  };
}

export interface SchoolAiGovernance {
  classification: AiDataClassification;
  releaseAuthorised: boolean;
  termsAccepted: boolean;
  enforced: boolean;
}

/** Whether the latest terms decision accepts the current wording. */
export function termsAcceptedNow(latest: { action: string; version: string; wordingSha256: string } | null): boolean {
  return latest?.action === "ACCEPT" && latest.version === SCHOOL_AI_TERMS_VERSION && latest.wordingSha256 === aiTermsWordingHash();
}

/** The per-school read the gate makes on every turn: classification, its scope's release, the owner's terms. */
export async function readSchoolAiGovernance(schoolId: string, env: NodeJS.ProcessEnv = process.env): Promise<SchoolAiGovernance> {
  return withTenant(schoolId, async (db) => {
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { aiDataClassification: true } });
    const classification: AiDataClassification = school?.aiDataClassification === "FICTIONAL" ? "FICTIONAL" : "LIVE";
    const [events, latestTerms] = await Promise.all([
      db.aiReleaseEvent.findMany({ where: { scope: classification } }),
      db.schoolAiTermsEvent.findFirst({ where: { schoolId }, orderBy: { recordedAt: "desc" }, select: { action: true, version: true, wordingSha256: true } }),
    ]);
    const enforced = aiReleaseEnforced(env);
    return {
      classification,
      releaseAuthorised: computeScopeStatus(classification, events, enforced).authorised,
      termsAccepted: termsAcceptedNow(latestTerms),
      enforced,
    };
  }, { label: "ai-governance" });
}
