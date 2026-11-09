import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AssistantCapabilitiesDto } from "@school-kit/types";

import { AssistantStore } from "./store";

const caps = (over: Partial<AssistantCapabilitiesDto["workflows"]> = {}): AssistantCapabilitiesDto => ({
  enabled: true,
  workflows: {
    invoices: { available: true, reason: null, canApprove: true },
    reminders: { available: true, reason: null, canApprove: true },
    intake: { available: true, reason: null, canApprove: true },
    corrections: { available: true, reason: null, canApprove: true },
    ...over,
  },
  help: { available: true },
  modelRouting: { available: false, reason: "NOT_APPROVED" },
  inactivityMinutes: 15,
});

function store(start = 0) {
  let now = start;
  const s = new AssistantStore(() => now, () => "id");
  return { s, advance: (ms: number) => { now += ms; } };
}

describe("assistant store", () => {
  it("routes a request locally into a task and refuses what it cannot do", () => {
    const { s } = store();
    s.setAccount("school:user");
    s.send("Generate invoices for JSS 1A this term", caps());
    const task = Object.values(s.snapshot().tasks)[0]!;
    expect(task).toMatchObject({ workflow: "invoices", status: "active", hints: { term: "current", classes: ["jss1a"] } });
    s.send("delete all students", caps());
    expect(s.snapshot().messages.at(-1)).toMatchObject({ kind: "refusal" });
    s.send("Add new students", caps({ intake: { available: false, reason: "NO_PERMISSION", canApprove: false } }));
    expect(s.snapshot().messages.at(-1)).toMatchObject({ kind: "refusal", text: expect.stringContaining("permission") });
    expect(Object.values(s.snapshot().tasks)).toHaveLength(1);
  });

  it("wipes everything on an account or school change, sign-out included", () => {
    const { s } = store();
    s.setAccount("schoolA:user1");
    s.send("remind parents who owe", caps());
    let disposed = 0;
    const id = Object.keys(s.snapshot().tasks)[0]!;
    s.session(id, () => ({ dispose: () => { disposed += 1; } }));
    s.updateTask(id, { status: "uncertain", ref: { proposalId: "p1" } });
    s.setAccount("schoolB:user1");
    expect(s.snapshot()).toMatchObject({ messages: [], tasks: {}, open: false });
    expect(disposed).toBe(1);
    s.send("hello", caps());
    s.setAccount(null); // signed out
    expect(s.snapshot().messages).toHaveLength(0);
  });

  it("clears after 15 minutes idle, keeping only ids of operations whose outcome is open", () => {
    const { s, advance } = store();
    s.setAccount("a:b");
    s.send("fix a misspelt surname", caps());
    s.send("add new students", caps());
    const [corr, intake] = Object.keys(s.snapshot().tasks);
    s.updateTask(corr!, { status: "confirming", ref: { proposalId: "prop-1" } });
    s.updateTask(intake!, { status: "active" });
    advance(14 * 60_000);
    expect(s.checkIdle()).toBe(false);
    advance(2 * 60_000);
    expect(s.checkIdle()).toBe(true);
    const st = s.snapshot();
    expect(Object.values(st.tasks)).toEqual([expect.objectContaining({ id: corr, reference: true, ref: { proposalId: "prop-1" }, hints: {} })]);
    expect(JSON.stringify(st.messages)).not.toMatch(/surname|students/i);
    expect(st.notice).toMatch(/15 minutes/);
  });

  it("refuses to close a task whose outcome is open, and never resends anything itself", () => {
    const { s } = store();
    s.setAccount("a:b");
    s.send("generate invoices", caps());
    const id = Object.keys(s.snapshot().tasks)[0]!;
    s.updateTask(id, { status: "uncertain", ref: { runId: "r1" } });
    expect(s.closeTask(id)).toBe(false);
    expect(s.hasOpenOperation()).toBe(true);
    s.updateTask(id, { status: "done" });
    expect(s.closeTask(id)).toBe(true);
  });

  it("keeps the transcript out of storage, URLs and analytics: no such API in the assistant code", () => {
    const roots = [join(__dirname), join(__dirname, "../../components/assistant")];
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !f.endsWith(".spec.ts")) files.push(p); } };
    roots.forEach(walk);
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      // Code only: comments that explain the rule may name what is forbidden.
      const src = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
      expect(src, f).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open|history\.(push|replace)State|posthog|captureException|track\(/);
    }
  });
});
