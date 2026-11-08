import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

// The AnthropicPort boundary (FD-2b, docs/reviews/agentic-implementation-plan.md
// §3.3): only AiGenerationService, in apps/api/src/common/ai, may build, hold
// or call the port. Every model call must pass the per-school budget check
// first and write its ai_generations row (CLAUDE.md AI hard rules), and both
// live there.
//
// The ESLint rule (@typescript-eslint/no-restricted-imports in
// packages/config/eslint/base.js) stops the port's names being imported. This
// spec is the mechanical backstop for what an import rule cannot see: a
// `.converse(` call on a port obtained some other way, and the AI_PORT
// injection token. Same idea as security-definer-inventory.spec.ts: a standing
// gate in CI rather than a review habit.

const SRC = path.resolve(__dirname, "..");

const FORBIDDEN: ReadonlyArray<{ readonly label: string; readonly pattern: RegExp }> = [
  { label: "calls converse() on the port", pattern: /\.converse\s*[?!]?\.?\s*\(/ },
  { label: "builds an Anthropic client", pattern: /\bcreateAnthropicClient\s*\(/ },
  { label: "uses the AI_PORT injection token", pattern: /\bAI_PORT\b/ },
  { label: "names the AnthropicPort type", pattern: /\bAnthropicPort\b/ },
];

/** Paths allowed to touch the port: the AI service's own directory, and specs (fake ports). */
function isAllowed(relPath: string): boolean {
  const p = relPath.split(path.sep).join("/");
  return p.startsWith("common/ai/") || /\.(spec|test)\.ts$/.test(p) || p.startsWith("__tests__/");
}

export function findBoundaryViolations(files: ReadonlyArray<{ path: string; content: string }>): string[] {
  const out: string[] = [];
  for (const file of files) {
    if (isAllowed(file.path)) continue;
    file.content.split("\n").forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, ""); // a mention in a comment is not a use
      for (const rule of FORBIDDEN) {
        if (rule.pattern.test(code)) out.push(`${file.path}:${i + 1} ${rule.label}`);
      }
    });
  }
  return out;
}

function sourceFiles(dir: string, base = dir): Array<{ path: string; content: string }> {
  const found: Array<{ path: string; content: string }> = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sourceFiles(full, base));
    else if (entry.name.endsWith(".ts")) found.push({ path: path.relative(base, full), content: fs.readFileSync(full, "utf8") });
  }
  return found;
}

describe("AnthropicPort boundary", () => {
  it("no file outside apps/api/src/common/ai builds, holds or calls the port", () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(100); // the scan really read the tree
    expect(findBoundaryViolations(files)).toEqual([]);
  });

  it("the scan catches each forbidden use in a module file, and ignores comments, specs and common/ai", () => {
    const violations = findBoundaryViolations([
      { path: "modules/x/x.service.ts", content: "await this.port.converse({ messages });" },
      { path: "modules/x/y.service.ts", content: "const p = createAnthropicClient(key);" },
      { path: "modules/x/z.module.ts", content: "{ provide: AI_PORT, useValue: fake }" },
      { path: "modules/x/w.service.ts", content: "constructor(private readonly port: AnthropicPort) {}" },
      { path: "modules/x/v.service.ts", content: "port.converse?.(req)" },
      { path: "modules/x/ok.service.ts", content: "// AnthropicPort is only used by AiGenerationService" },
      { path: "modules/x/x.service.spec.ts", content: "port.converse({})" },
      { path: "common/ai/ai-generation.service.ts", content: "this.port.converse({})" },
    ]);
    expect(violations).toEqual([
      "modules/x/x.service.ts:1 calls converse() on the port",
      "modules/x/y.service.ts:1 builds an Anthropic client",
      "modules/x/z.module.ts:1 uses the AI_PORT injection token",
      "modules/x/w.service.ts:1 names the AnthropicPort type",
      "modules/x/v.service.ts:1 calls converse() on the port",
    ]);
  });
});
