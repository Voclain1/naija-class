import { describe, expect, it, vi } from "vitest";
import type { AssistantCapabilitiesDto, AssistantTurnDto, AssistantTurnInput } from "@school-kit/types";

import { AssistantStore, looksPasted } from "./store";

// The panel's side of model orchestration (docs/modules/assistant-workspace.md,
// "Model orchestration"): what a turn sends, how its actions reach the cards,
// and every way a turn can fail without anything being approved or replayed.

const caps = (over: Partial<AssistantCapabilitiesDto> = {}): AssistantCapabilitiesDto => ({
  enabled: true,
  workflows: {
    invoices: { available: true, reason: null, canApprove: true },
    reminders: { available: true, reason: null, canApprove: true },
    intake: { available: true, reason: null, canApprove: true },
    corrections: { available: true, reason: null, canApprove: true },
  },
  help: { available: true },
  modelRouting: { available: true, reason: null },
  inactivityMinutes: 15,
  ...over,
});

const answer = (over: Partial<AssistantTurnDto> = {}): AssistantTurnDto => ({ outcome: "answered", reply: "Ready in the card.", actions: [], blockedCategories: [], toolsUsed: [], ...over });
const T = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const B = "33333333-3333-4333-8333-333333333333";
const R = "44444444-4444-4444-8444-444444444444";

function setup() {
  let n = 0;
  const store = new AssistantStore(() => 1_000, () => `id${++n}`);
  store.setAccount("school:user");
  const sent: AssistantTurnInput[] = [];
  const replies: AssistantTurnDto[] = [];
  const api = { turn: vi.fn(async (input: AssistantTurnInput) => { sent.push(structuredClone(input)); return replies.shift() ?? answer(); }) };
  return { store, api, sent, replies };
}

describe("model turns from the panel", () => {
  it("prepares on one turn and revises the SAME task on the next, sending only text and task structure", async () => {
    const { store, api, sent, replies } = setup();
    replies.push(answer({ actions: [{ kind: "invoices", handle: "t1", termId: T, classArmIds: [A, B], runId: R, problem: null }] }));
    await store.sendModel("Prepare second-term invoices for JSS2", caps(), api);
    const [task] = Object.values(store.snapshot().tasks);
    expect(task).toMatchObject({ workflow: "invoices", revision: 1, plan: { kind: "invoices", runId: R, classArmIds: [A, B] } });
    expect(sent[0]).toEqual({ messages: [{ role: "user", text: "Prepare second-term invoices for JSS2" }], tasks: [] });

    // The card reports where it is (ids and counts), then the person refines.
    store.reportTask(task!.id, { stage: "review", scope: { termId: T, classArmIds: [A, B] } });
    store.updateTask(task!.id, { ref: { runId: R } });
    replies.push(answer({ reply: "Left JSS 2C out.", actions: [{ kind: "invoices", handle: "t1", termId: T, classArmIds: [A], runId: "55555555-5555-4555-8555-555555555555", problem: null }] }));
    await store.sendModel("Actually leave JSS2C out", caps(), api);
    expect(sent[1]!.messages).toEqual([
      { role: "user", text: "Prepare second-term invoices for JSS2" },
      { role: "assistant", text: "Ready in the card." },
      { role: "user", text: "Actually leave JSS2C out" },
    ]);
    expect(sent[1]!.tasks).toEqual([{ handle: "t1", workflow: "invoices", status: "review", termId: T, classArmIds: [A, B], runId: R }]);
    const tasks = Object.values(store.snapshot().tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ revision: 2, plan: { classArmIds: [A] } });
    // Model replies are marked as the model's; no "pending" message is left behind.
    const texts = store.snapshot().messages.filter((m) => m.role === "assistant" && m.kind === "text");
    expect(texts.every((m) => m.role === "assistant" && m.kind === "text" && m.model)).toBe(true);
    expect(store.isThinking()).toBe(false);
  });

  it("never re-plans a task whose approval is in flight, its outcome open, or finished", async () => {
    const { store, api, replies } = setup();
    replies.push(answer({ actions: [{ kind: "invoices", handle: "t1", termId: T, classArmIds: [A], runId: R, problem: null }] }));
    await store.sendModel("invoices for 2A", caps(), api);
    const id = Object.keys(store.snapshot().tasks)[0]!;
    store.updateTask(id, { status: "confirming" });
    replies.push(answer({ actions: [{ kind: "invoices", handle: "t1", termId: T, classArmIds: [B], runId: null, problem: null }] }));
    await store.sendModel("make it 2B", caps(), api);
    expect(store.task(id)).toMatchObject({ revision: 1, plan: { classArmIds: [A] } });
    expect(store.resetSession(id)).toBe(false);
  });

  it("personal data blocked by the server: says what kind (never the text) and still helps on this device", async () => {
    const { store, api, replies } = setup();
    replies.push(answer({ outcome: "blocked", reply: "", blockedCategories: ["roster-name", "email"] }));
    await store.sendModel("Correct the email for Ada Obi", caps(), api);
    const texts = store.snapshot().messages.map((m) => ("text" in m ? m.text : ""));
    expect(texts.join("\n")).toContain("a name of someone at your school, an email address");
    // The local router still opens the corrections card.
    expect(Object.values(store.snapshot().tasks).map((t) => t.workflow)).toEqual(["corrections"]);
  });

  it("unavailable, failed, or timed out: nothing is applied or retried, and the person is told plainly", async () => {
    const { store, api, replies } = setup();
    replies.push(answer({ outcome: "unavailable", reply: "x" }));
    await store.sendModel("Send fee reminders", caps(), api);
    expect(Object.values(store.snapshot().tasks).map((t) => t.workflow)).toEqual(["reminders"]);

    const failing = { turn: vi.fn(async () => { throw new Error("network"); }) };
    await store.sendModel("Prepare invoices", caps(), failing);
    expect(failing.turn).toHaveBeenCalledTimes(1);
    expect(store.snapshot().messages.at(-1)).toMatchObject({ kind: "text", text: expect.stringContaining("Nothing was approved or changed") });

    const hanging = { turn: vi.fn(() => new Promise<AssistantTurnDto>(() => {})) };
    await store.sendModel("Prepare invoices again", caps(), hanging, 5);
    expect(store.isThinking()).toBe(false);
    expect(hanging.turn).toHaveBeenCalledTimes(1);
    expect(Object.values(store.snapshot().tasks)).toHaveLength(1);
  });

  it("an answer that arrives after a clear or an account change is dropped", async () => {
    const { store } = setup();
    let release!: (v: AssistantTurnDto) => void;
    const slow = { turn: () => new Promise<AssistantTurnDto>((r) => { release = r; }) };
    const pending = store.sendModel("Prepare invoices", caps(), slow);
    store.setAccount("school:someone-else");
    release(answer({ actions: [{ kind: "invoices", handle: "t1", termId: T, classArmIds: [A], runId: R, problem: null }] }));
    await pending;
    expect(store.snapshot().tasks).toEqual({});
    expect(store.snapshot().messages).toEqual([]);
  });

  it("pasted rows never reach the model: they go into the intake form on this device", async () => {
    const { store, api } = setup();
    const rows = "Ada,Obi,2014-01-02,F\nTunde,Bello,2013-11-20,M";
    expect(looksPasted(rows)).toBe(true);
    expect(looksPasted("Prepare invoices for JSS 1, JSS 2")).toBe(false);
    await store.sendModel(rows, caps(), api);
    expect(api.turn).not.toHaveBeenCalled();
    expect(JSON.stringify(store.snapshot().messages)).not.toContain("Tunde");
    expect(Object.values(store.snapshot().tasks)[0]).toMatchObject({ workflow: "intake", plan: { kind: "intake", pasted: rows } });
  });

  it("a shown operation opens one read-only card that reads the server; guide hits appear as a help answer", async () => {
    const { store, api, replies } = setup();
    const show = { kind: "show" as const, workflow: "reminders" as const, campaignId: R };
    replies.push(answer({ actions: [show, { kind: "help", query: "how", hits: [{ anchor: "a", title: "Adding parents", path: "/help/guide#a", excerpt: "…" }] }] }));
    await store.sendModel("What happened to the campaign I started?", caps(), api);
    replies.push(answer({ actions: [show] }));
    await store.sendModel("and now?", caps(), api);
    const tasks = Object.values(store.snapshot().tasks);
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ reference: true, autoCheck: true, ref: { campaignId: R } });
    expect(store.snapshot().messages.some((m) => m.role === "assistant" && m.kind === "help")).toBe(true);
  });

  it("a task the person may not run is not opened from a model action", async () => {
    const { store, api, replies } = setup();
    replies.push(answer({ actions: [{ kind: "corrections", handle: "t1", fields: ["email"] }] }));
    const noCorrections = caps();
    noCorrections.workflows.corrections = { available: false, reason: "NO_PERMISSION", canApprove: false };
    await store.sendModel("Correct an email", noCorrections, api);
    expect(store.snapshot().tasks).toEqual({});
  });
});
