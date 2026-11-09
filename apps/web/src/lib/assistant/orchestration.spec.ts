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
  lookup: { available: true },
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
    expect(sent[0]).toEqual({ messages: [{ role: "user", text: "Prepare second-term invoices for JSS2" }], tasks: [], students: [] });

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

  it("a revised plan makes the preview on screen unapprovable until the card applies it, even with the box already ticked", async () => {
    const { store, api, replies } = setup();
    // An intake preview for JSS 1A is on screen (the card applied revision 1).
    replies.push(answer({ actions: [{ kind: "intake", handle: "t1", termId: T, classArmId: A, placeLater: false }] }));
    await store.sendModel("Add students to JSS1A", caps(), api);
    const id = Object.keys(store.snapshot().tasks)[0]!;
    store.markApplied(id, 1);
    store.reportTask(id, { stage: "review" });
    expect(store.canApprove(id)).toBe(true);
    // "Make that JSS 2A": a new plan. The old preview can no longer be confirmed.
    replies.push(answer({ actions: [{ kind: "intake", handle: "t1", termId: T, classArmId: B, placeLater: false }] }));
    await store.sendModel("Actually JSS 2A", caps(), api);
    expect(store.planPending(id)).toBe(true);
    expect(store.canApprove(id)).toBe(false);
    const confirm = vi.fn();
    expect(await store.approve(id, confirm)).toBe(false); // the person had ticked the box: still refused
    expect(confirm).not.toHaveBeenCalled();
    // The card applies the plan (fresh session, placement JSS 2A) and only a NEW preview may be approved.
    expect(store.resetSession(id)).toBe(true);
    store.markApplied(id, 2);
    expect(store.canApprove(id)).toBe(true);
  });

  it("races: a plan arriving after the person pressed approve is not applied (and they are told); approval cannot start while a plan is pending", async () => {
    const { store, api, replies } = setup();
    replies.push(answer({ actions: [{ kind: "corrections", handle: "t1", fields: ["email"] }] }));
    await store.sendModel("Correct an email", caps(), api);
    const id = Object.keys(store.snapshot().tasks)[0]!;
    store.markApplied(id, 1);
    // 1. Approve first; the model's revision lands while the confirmation is in flight.
    let finish!: () => void;
    const inFlight = store.approve(id, () => new Promise<void>((r) => { finish = r; }));
    expect(store.canApprove(id)).toBe(false);
    replies.push(answer({ actions: [{ kind: "corrections", handle: "t1", fields: ["lastName"] }] }));
    await store.sendModel("Change the surname instead", caps(), api);
    expect(store.task(id)).toMatchObject({ revision: 1, plan: { fields: ["email"] } });
    expect(store.snapshot().messages.at(-1)).toMatchObject({ text: expect.stringContaining("was not applied") });
    expect(store.resetSession(id)).toBe(false);
    finish();
    expect(await inFlight).toBe(true);
    // 2. The model's revision lands first; a click before the card applies it does nothing.
    replies.push(answer({ actions: [{ kind: "corrections", handle: "t1", fields: ["lastName"] }] }));
    await store.sendModel("Change the surname instead", caps(), api);
    const run = vi.fn();
    expect(await store.approve(id, run)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("uncertain and finished tasks are never reset or re-planned; drafts live in the task's memory, not the session's", async () => {
    const { store, api, replies } = setup();
    replies.push(answer({ actions: [{ kind: "intake", handle: "t1", termId: T, classArmId: A, placeLater: false }] }));
    await store.sendModel("Add students to JSS1A", caps(), api);
    const id = Object.keys(store.snapshot().tasks)[0]!;
    store.setMemo(id, "intakeDraft", { rows: ["typed"] });
    store.markApplied(id, 1);
    expect(store.resetSession(id)).toBe(true);
    expect(store.memo(id, "intakeDraft", () => null)).toEqual({ rows: ["typed"] }); // survives a reset
    for (const status of ["uncertain", "done"] as const) {
      store.updateTask(id, { status });
      replies.push(answer({ actions: [{ kind: "intake", handle: "t1", termId: T, classArmId: B, placeLater: false }] }));
      await store.sendModel("Move them to JSS 2A", caps(), api);
      expect(store.task(id)).toMatchObject({ revision: 1 });
      expect(store.resetSession(id)).toBe(false);
      expect(store.canApprove(id)).toBe(false);
    }
    store.clear("user");
    expect(store.memo(id, "intakeDraft", () => "gone")).toBe("gone"); // a clear drops typed rows
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

  it("a blocked request never re-enters model history; later clean requests are not poisoned by it", async () => {
    const { store, api, sent, replies } = setup();
    replies.push(answer({ outcome: "blocked", reply: "", blockedCategories: ["roster-name"] }));
    await store.sendModel("Show Samuel in JSS2", caps(), api);
    for (const text of ["Prepare invoices for JSS2", "Actually only JSS 2A", "And remind overdue families"]) {
      replies.push(answer({ reply: `ok: ${text}` }));
      await store.sendModel(text, caps(), api);
    }
    for (const turn of sent.slice(1)) expect(JSON.stringify(turn.messages)).not.toContain("Samuel");
    expect(sent[3]!.messages).toEqual([
      { role: "user", text: "Prepare invoices for JSS2" }, { role: "assistant", text: "ok: Prepare invoices for JSS2" },
      { role: "user", text: "Actually only JSS 2A" }, { role: "assistant", text: "ok: Actually only JSS 2A" },
      { role: "user", text: "And remind overdue families" },
    ]);
    // The blocked text is still on screen for the person, marked ineligible.
    expect(store.snapshot().messages.find((m) => m.role === "user" && m.text === "Show Samuel in JSS2")).toMatchObject({ eligible: false });
  });

  it("failed, timed-out and unavailable requests are not promoted; a retry is checked afresh and promoted only when accepted", async () => {
    const { store, sent } = setup();
    const outcomes: Array<AssistantTurnDto | Error | "hang"> = [new Error("network"), "hang", answer({ outcome: "unavailable" }), answer({ reply: "Retried fine." }), answer({ reply: "Next." })];
    const api = { turn: vi.fn(async (input: AssistantTurnInput) => {
      sent.push(structuredClone(input));
      const next = outcomes.shift()!;
      if (next === "hang") return new Promise<AssistantTurnDto>(() => {});
      if (next instanceof Error) throw next;
      return next;
    }) };
    await store.sendModel("Prepare invoices (lost)", caps(), api, 1_000);
    await store.sendModel("Prepare invoices (timed out)", caps(), api, 5);
    await store.sendModel("Prepare invoices (unavailable)", caps(), api, 1_000);
    await store.sendModel("Prepare invoices", caps(), api, 1_000);
    await store.sendModel("Thanks", caps(), api, 1_000);
    // Each earlier attempt was sent ONCE as the new message and never again as history.
    expect(sent[4]!.messages).toEqual([{ role: "user", text: "Prepare invoices" }, { role: "assistant", text: "Retried fine." }, { role: "user", text: "Thanks" }]);
    expect(api.turn).toHaveBeenCalledTimes(5);
  });

  it("named lookup: matches and records stay on screen; later turns send handles and the person's own text, never the rendered names", async () => {
    const { store, api, sent, replies } = setup();
    const match = (id: string, name: string, adm: string, cls: string, handle: string) => ({ studentId: id, name, admissionNumber: adm, classArmId: A, classLabel: cls, termId: T, status: "ACTIVE", match: "exact" as const, handle });
    replies.push(answer({ reply: "Two students match. Which class?", actions: [{ kind: "students", asked: "Samuel", status: "several", matches: [
      match("11111111-0000-4000-8000-000000000001", "Samuel Okoro", "ADM-001", "JSS 2 · JSS 2A", "s1"),
      match("11111111-0000-4000-8000-000000000002", "Samuel Bello", "ADM-002", "JSS 2 · JSS 2B", "s2"),
    ] }] }));
    await store.sendModel("Show Samuel in JSS2", caps(), api);
    expect(store.snapshot().students.map((e) => e.match.name)).toEqual(["Samuel Okoro", "Samuel Bello"]);
    expect(store.snapshot().messages.some((m) => m.role === "assistant" && m.kind === "students")).toBe(true);
    // The person picks one in the card; its summary shows.
    store.selectStudent("11111111-0000-4000-8000-000000000002");
    expect(store.snapshot().messages.at(-1)).toMatchObject({ kind: "student-record", section: "summary" });
    replies.push(answer({ reply: "Here is her attendance.", actions: [{ kind: "student-record", handle: "s2", studentId: "11111111-0000-4000-8000-000000000002", section: "attendance" }] }));
    await store.sendModel("Show her attendance", caps(), api);
    const second = sent[1]!;
    expect(second.students).toEqual([
      { handle: "s1", studentId: "11111111-0000-4000-8000-000000000001", selected: false },
      { handle: "s2", studentId: "11111111-0000-4000-8000-000000000002", selected: true },
    ]);
    // The person's own words are resent (the server redacts names in them each turn); the rendered matches are not.
    const wire = JSON.stringify(second);
    for (const rendered of ["Okoro", "Bello", "ADM-001", "ADM-002", "JSS 2 · JSS 2B"]) expect(wire).not.toContain(rendered);
    expect(second.messages.map((m) => m.text)).toEqual(["Show Samuel in JSS2", "Two students match. Which class?", "Show her attendance"]);
    expect(store.snapshot().messages.at(-1)).toMatchObject({ kind: "student-record", section: "attendance" });
    // A record for a student this conversation never found is ignored.
    store.applyActions([{ kind: "student-record", handle: "s9", studentId: "99999999-0000-4000-8000-000000000009", section: "results" }], new Map(), caps());
    expect(store.snapshot().messages.at(-1)).toMatchObject({ section: "attendance" });
    // Clearing the conversation drops every found student (names included).
    store.clear("user");
    expect(store.snapshot().students).toEqual([]);
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
