import * as fs from "node:fs";
import * as path from "node:path";

import { AI_RELEASE_REQUIREMENTS, AI_RELEASE_REQUIREMENTS_VERSION, ASSISTANT_ORCHESTRATOR_APPROVAL, aiReleaseRequirementsFor } from "@school-kit/ai";
import { describe, expect, it } from "vitest";

import { attestationHash, computeScopeStatus, type ReleaseEventRow } from "../common/ai-release/ai-governance";

// The release checklist cannot claim what the repository does not show
// (docs/modules/assistant-ai-governance.md, "Release authorisation").
//
// An engineering check marked "verified" must cite at least one spec file
// that exists and names the check in a test or describe TITLE
// ("[release-check:<id>]"). A comment is not enough: the title is what CI
// runs and reports. Attestations are never verified in code.

const REPO = path.resolve(__dirname, "../../../..");

describe("AI release requirements conformance", () => {
  it("ids are unique, every requirement belongs to a scope, and every statement is substantive", () => {
    const ids = AI_RELEASE_REQUIREMENTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of AI_RELEASE_REQUIREMENTS) {
      expect(r.scopes.length, r.id).toBeGreaterThan(0);
      expect(r.statement.length, r.id).toBeGreaterThan(60);
      expect(r.id).toMatch(r.kind === "attestation" ? /^att\./ : /^(eng|live)\./);
    }
  });

  it("every verified engineering check is backed by a spec that names it in a test title", () => {
    for (const r of AI_RELEASE_REQUIREMENTS) {
      if (r.kind !== "engineering" || r.status !== "verified") continue;
      expect(r.evidence.length, r.id).toBeGreaterThan(0);
      for (const file of r.evidence) {
        if (file === "CLAUDE.md") {
          expect(fs.readFileSync(path.join(REPO, file), "utf8")).toMatch(/\|\s*`assistant-orchestrator`\s*\|/);
          continue;
        }
        const full = path.join(REPO, file);
        expect(fs.existsSync(full), `${r.id}: ${file} does not exist`).toBe(true);
        const titles = [...fs.readFileSync(full, "utf8").matchAll(/\b(?:it|describe)(?:\.each\([^)]*\))?\(\s*(["'`])([\s\S]*?)\1/g)].map((m) => m[2]);
        expect(titles.some((t) => t!.includes(`release-check:${r.id}`)), `${r.id}: no test title in ${file} names it`).toBe(true);
      }
    }
  });

  it("the LIVE release cannot be complete while CLAUDE.md's allowlist row (AO-1) is pending", () => {
    const row = aiReleaseRequirementsFor("LIVE").find((r) => r.id === "live.allowlist-row");
    expect(row?.kind).toBe("engineering");
    if (ASSISTANT_ORCHESTRATOR_APPROVAL === "pending") {
      expect(row?.kind === "engineering" && row.status).toBe("open");
      // Even with every attestation recorded and an authorisation, LIVE is not authorised.
      const at = new Date();
      const events: ReleaseEventRow[] = [
        ...aiReleaseRequirementsFor("LIVE").filter((r) => r.kind === "attestation").map((r) => ({
          scope: "LIVE", action: "ATTEST", requirementId: r.id, requirementsVersion: AI_RELEASE_REQUIREMENTS_VERSION,
          statementSha256: attestationHash(r), reference: "x", recordedBy: "u", recordedAt: at,
        })),
        { scope: "LIVE", action: "AUTHORISE", requirementId: null, requirementsVersion: AI_RELEASE_REQUIREMENTS_VERSION, statementSha256: null, reference: "x", recordedBy: "u", recordedAt: new Date(at.getTime() + 1) },
      ];
      expect(computeScopeStatus("LIVE", events, true)).toMatchObject({ complete: false, authorised: false });
    }
  });

  it("an attestation for other words, another version or another scope does not count; a later revocation wins", () => {
    const req = aiReleaseRequirementsFor("FICTIONAL").filter((r) => r.kind === "attestation");
    const t = (ms: number) => new Date(Date.UTC(2026, 10, 22, 12, 0, 0, ms));
    const attest = (over: Partial<ReleaseEventRow> = {}) =>
      req.map((r, i) => ({
        scope: "FICTIONAL", action: "ATTEST", requirementId: r.id, requirementsVersion: AI_RELEASE_REQUIREMENTS_VERSION,
        statementSha256: attestationHash(r), reference: "ref", recordedBy: "u", recordedAt: t(i), ...over,
      }));
    const authorise: ReleaseEventRow = { scope: "FICTIONAL", action: "AUTHORISE", requirementId: null, requirementsVersion: AI_RELEASE_REQUIREMENTS_VERSION, statementSha256: null, reference: "go", recordedBy: "u", recordedAt: t(100) };
    expect(computeScopeStatus("FICTIONAL", [...attest(), authorise], true).authorised).toBe(true);
    expect(computeScopeStatus("FICTIONAL", [...attest({ statementSha256: "0".repeat(64) }), authorise], true).authorised).toBe(false);
    expect(computeScopeStatus("FICTIONAL", [...attest({ requirementsVersion: "2020-01-01.1" }), authorise], true).authorised).toBe(false);
    expect(computeScopeStatus("FICTIONAL", [...attest({ scope: "LIVE" }), authorise], true).authorised).toBe(false);
    const revoke: ReleaseEventRow = { ...authorise, action: "REVOKE", recordedAt: t(200) };
    expect(computeScopeStatus("FICTIONAL", [...attest(), authorise, revoke], true).authorised).toBe(false);
    expect(computeScopeStatus("FICTIONAL", [...attest(), authorise, revoke, { ...authorise, recordedAt: t(300) }], true).authorised).toBe(true);
    // An authorisation made for an older requirements version does not carry over.
    expect(computeScopeStatus("FICTIONAL", [...attest(), { ...authorise, requirementsVersion: "2020-01-01.1" }], true).authorised).toBe(false);
  });
});
