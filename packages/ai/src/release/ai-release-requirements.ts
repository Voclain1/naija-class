import { ASSISTANT_ORCHESTRATOR_APPROVAL } from "../prompts/assistant-orchestrator.js";

// The SchoolKit Assistant's release requirements (2026-11-22,
// docs/modules/assistant-ai-governance.md). This replaces the single
// ASSISTANT_ORCHESTRATOR_APPROVAL constant as the RUNTIME gate with a
// checklist per DATA SCOPE:
//
//   FICTIONAL  a pilot school holding invented records only (the Virgo Fidelis
//              pilot). Needs every engineering check and three human
//              attestations.
//   LIVE       a school with real children's records. Needs everything
//              FICTIONAL needs except the fictional-only attestations, plus
//              CLAUDE.md's allowlist row (AO-1, still the code-level owner
//              decision: ASSISTANT_ORCHESTRATOR_APPROVAL) and the legal,
//              provider and policy attestations in the sign-off register.
//
// TWO KINDS OF REQUIREMENT, kept apart on purpose:
//   engineering  status set HERE, in a reviewed change, and "verified" only
//                with evidence: a spec file that names the check
//                ("release-check:<id>"). apps/api/src/__tests__/
//                ai-release-requirements.spec.ts fails CI if a verified
//                check's evidence does not exist or does not name it.
//   attestation  a fact only a person can confirm (counsel's conclusion, the
//                provider console, what data a pilot school holds). Recorded
//                by the platform admin through the audited API, with a
//                reference, against the CURRENT requirements version. Never
//                set in code.
//
// Changing what a scope requires means bumping AI_RELEASE_REQUIREMENTS_VERSION:
// every attestation for the old version stops counting, so nobody's earlier
// confirmation is stretched over words they did not see.

export const AI_RELEASE_REQUIREMENTS_VERSION = "2026-11-22.1";

export type AiReleaseScopeName = "FICTIONAL" | "LIVE";

export interface EngineeringRequirement {
  readonly id: string;
  readonly kind: "engineering";
  readonly title: string;
  readonly statement: string;
  readonly status: "verified" | "open";
  /** Repository paths of specs that name this check. Required when verified. */
  readonly evidence: readonly string[];
  readonly scopes: readonly AiReleaseScopeName[];
}

export interface AttestationRequirement {
  readonly id: string;
  readonly kind: "attestation";
  readonly title: string;
  /** The exact words the platform admin confirms. */
  readonly statement: string;
  readonly scopes: readonly AiReleaseScopeName[];
}

export type AiReleaseRequirement = EngineeringRequirement | AttestationRequirement;

const BOTH: readonly AiReleaseScopeName[] = ["FICTIONAL", "LIVE"];
const SEC = "apps/api/src/__tests__/assistant-security.spec.ts";
const GOV = "apps/api/src/__tests__/assistant-governance.spec.ts";

export const AI_RELEASE_REQUIREMENTS: readonly AiReleaseRequirement[] = [
  // ---- Engineering (verified only with named test evidence) -------------------
  {
    id: "eng.tenant-isolation",
    kind: "engineering",
    title: "Tenant isolation",
    statement: "Assistant turns, tools, named lookup, voice sessions and governance records are bounded to the signed-in school; another school's ids resolve to nothing and its records are never read.",
    status: "verified",
    evidence: [SEC, GOV],
    scopes: BOTH,
  },
  {
    id: "eng.tool-authorisation",
    kind: "engineering",
    title: "Tool calls re-check the person",
    statement: "Every model-requested tool call re-reads the person's active status and current permissions, and the workflow services keep their own role and teacher-scope checks.",
    status: "verified",
    evidence: [SEC, "apps/api/src/common/ai/tools/tool-registry.spec.ts"],
    scopes: BOTH,
  },
  {
    id: "eng.no-approval-path",
    kind: "engineering",
    title: "No model or voice approval path",
    statement: "No tool can approve, issue, send, save or delete; a spoken approval runs nothing; approval is only the person's control on the server's preview.",
    status: "verified",
    evidence: [SEC, "apps/api/src/modules/assistant-voice/assistant-voice.service.spec.ts"],
    scopes: BOTH,
  },
  {
    id: "eng.pseudonymisation",
    kind: "engineering",
    title: "Local name resolution and egress minimisation",
    statement: "Names on the school's roster become opaque markers resolved on the server; the school's actual names, admission numbers, emails and phone numbers are withheld from tool results and checked in every outgoing message, not only by pattern.",
    status: "verified",
    evidence: [SEC, "apps/api/src/common/ai/pii/provider-egress-guard.spec.ts"],
    scopes: BOTH,
  },
  {
    id: "eng.prompt-injection",
    kind: "engineering",
    title: "Prompt-injection containment",
    statement: "Instructions injected through typed text, earlier history or tool results cannot reach an unregistered tool, another school's records, or a record outside the person's permissions.",
    status: "verified",
    evidence: [SEC],
    scopes: BOTH,
  },
  {
    id: "eng.no-content-retention",
    kind: "engineering",
    title: "No conversation content kept by SchoolKit",
    statement: "No question, reply, transcript, audio or provider credential is stored, logged or queued; error reports drop the bodies of every Assistant route.",
    status: "verified",
    evidence: [SEC, "apps/api/src/observability/sentry-assistant-scrub.spec.ts"],
    scopes: BOTH,
  },
  {
    id: "eng.kill-switch",
    kind: "engineering",
    title: "Immediate kill switch",
    statement: "Revoking a release, switching a school off, or withdrawing the school's terms stops model calls on the next request, with no cache in between.",
    status: "verified",
    evidence: [GOV],
    scopes: BOTH,
  },
  {
    id: "eng.terms-gate",
    kind: "engineering",
    title: "School owner terms gate",
    statement: "Only the school's owner can accept or withdraw the current AI terms; acceptance never activates anything; without it no model call is made.",
    status: "verified",
    evidence: [GOV],
    scopes: BOTH,
  },
  {
    id: "eng.fictional-classification",
    kind: "engineering",
    title: "Fictional classification guard",
    statement: "Only the platform admin can classify a school, only while it holds no student or guardian records; a fictional release never unlocks a live school.",
    status: "verified",
    evidence: [GOV],
    scopes: ["FICTIONAL"],
  },
  {
    id: "live.allowlist-row",
    kind: "engineering",
    title: "CLAUDE.md allowlist row (AO-1)",
    statement: "The owner has approved the assistant-orchestrator row of CLAUDE.md's PII-bearing prompt allowlist, and ASSISTANT_ORCHESTRATOR_APPROVAL is \"approved\" in the same reviewed change.",
    status: ASSISTANT_ORCHESTRATOR_APPROVAL === "approved" ? "verified" : "open",
    evidence: ASSISTANT_ORCHESTRATOR_APPROVAL === "approved" ? ["CLAUDE.md"] : [],
    scopes: ["LIVE"],
  },

  // ---- Attestations (recorded by a person through the audited API) -----------
  {
    id: "att.fictional.records-only",
    kind: "attestation",
    title: "Pilot school holds fictional records only",
    statement: "The pilot school holds only records created by the fictional-pilot seed or invented by testers. No real pupil, parent or staff personal information has been entered into it.",
    scopes: ["FICTIONAL"],
  },
  {
    id: "att.fictional.staff-briefed",
    kind: "attestation",
    title: "Pilot testers briefed",
    statement: "Everyone with access to the pilot school has been told in writing to type and say no real personal information while testing, and how to report it if any is entered.",
    scopes: ["FICTIONAL"],
  },
  {
    id: "att.provider-retention",
    kind: "attestation",
    title: "Provider terms reviewed for the production keys",
    statement: "I have checked the organisations behind the production Anthropic and OpenAI keys: requests are not used for training, standard retention is up to 30 days, and zero data retention is not enabled. I accept this for the data scope being authorised.",
    scopes: BOTH,
  },
  {
    id: "att.live.counsel",
    kind: "attestation",
    title: "Counsel's written conclusion",
    statement: "A qualified data-protection reviewer has given a written conclusion on lawful basis, controller and processor roles, international transfer, children's data and the DPIA for staff-initiated model and voice processing, and its conditions are met.",
    scopes: ["LIVE"],
  },
  {
    id: "att.live.terms-and-notices",
    kind: "attestation",
    title: "Terms, privacy policy and parent notice approved",
    statement: "Counsel has approved the current school AI terms wording, the published privacy policy describes this processing, and the parent notice or consent decision has been made and carried out.",
    scopes: ["LIVE"],
  },
  {
    id: "att.live.release-evals",
    kind: "attestation",
    title: "Live evaluations on the release commit",
    statement: "The assistant-orchestrator live evaluations passed on the exact commit being released, with no scenario skipped.",
    scopes: ["LIVE"],
  },
];

export function aiReleaseRequirementsFor(scope: AiReleaseScopeName): readonly AiReleaseRequirement[] {
  return AI_RELEASE_REQUIREMENTS.filter((r) => r.scopes.includes(scope));
}
