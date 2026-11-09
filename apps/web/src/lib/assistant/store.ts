import {
  ASSISTANT_BLOCK_LABELS,
  ASSISTANT_INACTIVITY_MINUTES,
  ASSISTANT_MAX_REQUEST_CHARS,
  ASSISTANT_TURN_MAX_MESSAGES,
  ASSISTANT_TURN_MAX_TASKS,
  ASSISTANT_WORKFLOW_LABELS,
  routeAssistantRequest,
  type AssistantCapabilitiesDto,
  type AssistantHelpHitDto,
  type AssistantRoute,
  type AssistantTaskState,
  type AssistantTurnAction,
  type AssistantTurnDto,
  type AssistantTurnInput,
  type AssistantWorkflow,
  type RouteHints,
  type StudentCorrectionField,
} from "@school-kit/types";

// The SchoolKit Assistant's conversation (docs/modules/assistant-workspace.md).
//
// MEMORY ONLY. Nothing here touches localStorage, sessionStorage, IndexedDB,
// cookies, the URL or analytics: the transcript lives in this object, which
// lives in the root provider, so it survives ordinary staff navigation and
// dies with a reload. It is cleared on sign-out, on any change of account or
// school, and after 15 minutes without activity (the approved browser rule).
//
// Clearing never cancels server work and never forgets an operation whose
// outcome is still open: such a task is reduced to a REFERENCE (workflow and
// opaque ids only, no names or values) so its original outcome can still be
// checked. Nothing here ever re-sends a mutation.
//
// MODEL ORCHESTRATION (docs/modules/assistant-workspace.md, "Model
// orchestration"): when the school's model routing is available, a request
// goes to POST /assistant/workspace/turn with the conversation's text and a
// STRUCTURED summary of open tasks (handles, statuses, ids, counts: never
// names or values typed into a card). The answer's actions update the task
// cards through `plan` and `revision`; nothing in an action can approve.
// Rows that look pasted never go to the model: they go into the intake form.

export type TaskStatus = "active" | "confirming" | "uncertain" | "done" | "closed";

/** Opaque server ids for an operation whose outcome may need checking. */
export interface TaskRef {
  proposalId?: string;
  campaignId?: string;
  runId?: string;
}

/** Where an active card is: still choosing, or showing the server's preview for approval. */
export type TaskStage = "editing" | "review";

/** What a card currently holds, as ids and counts only (sent to the model turn as structure, never content). */
export interface TaskScope {
  termId?: string | null;
  classArmIds?: string[];
  overdueOnly?: boolean;
  includePaymentPlans?: boolean;
  placeLater?: boolean;
  fields?: StudentCorrectionField[];
  studentCount?: number;
}

/** A change the model turn asked a card to make. Applied by the card when `revision` moves on. */
export type TaskPlan =
  | { kind: "invoices"; termId: string; classArmIds: string[]; runId: string | null; problem: string | null }
  | { kind: "reminders"; termId: string | null; classArmId: string | null; className: string | null; overdueOnly: boolean; includePaymentPlans: boolean; autoPreview: boolean }
  | { kind: "intake"; termId: string | null; classArmId: string | null; placeLater: boolean; pasted?: string }
  | { kind: "corrections"; fields: StudentCorrectionField[] };

export interface AssistantTask {
  id: string;
  workflow: AssistantWorkflow;
  status: TaskStatus;
  hints: RouteHints;
  ref: TaskRef;
  /** True for a task reduced to its ids by a clear: it can only check its outcome. */
  reference: boolean;
  /** Read the original outcome as soon as the card shows (a "show" from the model turn). */
  autoCheck?: boolean;
  plan?: TaskPlan;
  /** Moves on each time a plan is applied, so the card applies it once. */
  revision: number;
  stage: TaskStage;
  scope: TaskScope;
}

export type AssistantMessage =
  | { id: string; role: "user"; text: string }
  /** `model`: written by the AI model (after the server's check), not by this app. */
  | { id: string; role: "assistant"; kind: "text"; text: string; model?: boolean }
  /** A model turn in flight. Replaced by its answer; never sent back to the model. */
  | { id: string; role: "assistant"; kind: "pending"; text: string }
  | { id: string; role: "assistant"; kind: "task"; taskId: string; text: string }
  | { id: string; role: "assistant"; kind: "help"; text: string; hits: AssistantHelpHitDto[] | null; query: string }
  | { id: string; role: "assistant"; kind: "refusal"; text: string; next: AssistantWorkflow | "help" | null }
  | { id: string; role: "assistant"; kind: "clarify"; text: string; options: AssistantWorkflow[] };

export interface AssistantState {
  open: boolean;
  messages: AssistantMessage[];
  tasks: Record<string, AssistantTask>;
  account: string | null;
  lastActivity: number;
  /** Shown once after an automatic clear, so the person knows why. */
  notice: string | null;
}

/** Something a task keeps alive in memory (a session object); disposed on clear. */
export interface Disposable {
  dispose(): void;
}

const IDLE_MS = ASSISTANT_INACTIVITY_MINUTES * 60_000;

export class AssistantStore {
  private state: AssistantState;
  private listeners = new Set<() => void>();
  /** Live session objects per task id. Never serialised, never stored. */
  private sessions = new Map<string, Disposable>();
  private seq = 0;
  /** Moves on at every wipe or clear, so a late model answer for an earlier conversation is dropped. */
  private generation = 0;

  constructor(private now: () => number = () => Date.now(), private id: () => string = () => crypto.randomUUID()) {
    this.state = { open: false, messages: [], tasks: {}, account: null, lastActivity: now(), notice: null };
  }

  snapshot = (): AssistantState => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  };
  private set(patch: Partial<AssistantState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private nextId() {
    this.seq += 1;
    return `${this.id()}-${this.seq}`;
  }

  // ---- Lifecycle -----------------------------------------------------------

  /** Called with "<status>:<schoolId>:<userId>". Any change wipes everything. */
  setAccount(account: string | null) {
    if (account === this.state.account) return;
    const hadContent = this.state.messages.length > 0;
    this.wipe();
    this.set({ account, open: false, notice: hadContent && account ? "The assistant was cleared because the signed-in account changed." : null });
  }

  /** Sign-out, a forced session end, or an account change: nothing survives. */
  wipe() {
    this.generation += 1;
    for (const s of this.sessions.values()) s.dispose();
    this.sessions.clear();
    this.set({ messages: [], tasks: {}, notice: null, lastActivity: this.now() });
  }

  touch() {
    this.set({ lastActivity: this.now() });
  }

  /** Clears after 15 minutes without activity. Returns true when it cleared. */
  checkIdle(): boolean {
    if (this.state.messages.length === 0) return false;
    if (this.now() - this.state.lastActivity < IDLE_MS) return false;
    this.clear("idle");
    return true;
  }

  /** True while an operation's outcome is not yet known on screen. */
  hasOpenOperation(): boolean {
    return Object.values(this.state.tasks).some((t) => t.status === "confirming" || t.status === "uncertain");
  }

  /**
   * Clears the conversation. Operations whose outcome may still be open are
   * kept as references (ids only) so they can be checked; everything else,
   * including every name or value typed, goes.
   */
  clear(reason: "user" | "idle") {
    this.generation += 1;
    const keep = Object.values(this.state.tasks).filter((t) => (t.status === "confirming" || t.status === "uncertain" || (t.status === "active" && (t.ref.campaignId || t.ref.runId))) && (t.ref.proposalId || t.ref.campaignId || t.ref.runId));
    for (const [id, s] of this.sessions) {
      s.dispose();
      this.sessions.delete(id);
    }
    const tasks: Record<string, AssistantTask> = {};
    const messages: AssistantMessage[] = [];
    for (const t of keep) {
      tasks[t.id] = { ...t, hints: {}, plan: undefined, scope: {}, reference: true, status: "uncertain" };
      messages.push({ id: this.nextId(), role: "assistant", kind: "task", taskId: t.id, text: `${ASSISTANT_WORKFLOW_LABELS[t.workflow]}: check the original outcome before doing this again.` });
    }
    this.set({
      messages,
      tasks,
      lastActivity: this.now(),
      notice: reason === "idle" ? `The conversation was cleared after ${ASSISTANT_INACTIVITY_MINUTES} minutes without activity.` : null,
    });
  }

  dismissNotice() {
    this.set({ notice: null });
  }

  setOpen(open: boolean) {
    this.set({ open, ...(open ? { lastActivity: this.now() } : {}) });
  }

  // ---- Conversation --------------------------------------------------------

  /** Handles one request typed by the person. Routing happens here, locally. */
  send(raw: string, caps: AssistantCapabilitiesDto | null): AssistantRoute | null {
    const text = raw.trim().slice(0, ASSISTANT_MAX_REQUEST_CHARS);
    if (!text) return null;
    const messages: AssistantMessage[] = [...this.state.messages, { id: this.nextId(), role: "user", text }];
    this.set({ messages, lastActivity: this.now(), notice: null });
    const route = routeAssistantRequest(text);
    this.respond(route, caps);
    return route;
  }

  /** Starts a workflow from a suggestion or a clarification choice. */
  start(workflow: AssistantWorkflow, caps: AssistantCapabilitiesDto | null, hints: RouteHints = {}) {
    this.respond({ kind: "workflow", workflow, hints }, caps);
  }

  private say(m: AssistantMessage) {
    this.set({ messages: [...this.state.messages, m], lastActivity: this.now() });
  }

  private respond(route: AssistantRoute, caps: AssistantCapabilitiesDto | null) {
    switch (route.kind) {
      case "greeting":
        this.say({ id: this.nextId(), role: "assistant", kind: "text", text: "Hello. Tell me what you need done, or pick one of the tasks below." });
        return;
      case "clarify":
        this.say({ id: this.nextId(), role: "assistant", kind: "clarify", text: "Which of these do you want to do?", options: route.options });
        return;
      case "unsupported":
        this.say({ id: this.nextId(), role: "assistant", kind: "refusal", text: route.message, next: route.next });
        return;
      case "help":
        if (caps && !caps.help.available) {
          this.say({ id: this.nextId(), role: "assistant", kind: "text", text: "Guide search isn't available right now. Open Help → Getting started guide from the menu." });
          return;
        }
        this.say({ id: this.nextId(), role: "assistant", kind: "help", text: "Here is what the Getting started guide says.", hits: null, query: route.query });
        return;
      case "workflow": {
        const w = caps?.workflows[route.workflow];
        if (!w?.available) {
          const why =
            w?.reason === "NO_PERMISSION"
              ? "Your account doesn't have permission for this, so I can't prepare it for you."
              : "This task isn't switched on for your school yet.";
          this.say({ id: this.nextId(), role: "assistant", kind: "refusal", text: `${ASSISTANT_WORKFLOW_LABELS[route.workflow]}: ${why}`, next: null });
          return;
        }
        const id = this.nextId();
        const task: AssistantTask = newTask(id, route.workflow, route.hints);
        this.set({ tasks: { ...this.state.tasks, [id]: task } });
        this.say({ id: this.nextId(), role: "assistant", kind: "task", taskId: id, text: INTRO[route.workflow] });
        return;
      }
    }
  }

  setHelpHits(messageId: string, hits: AssistantHelpHitDto[]) {
    this.set({ messages: this.state.messages.map((m) => (m.id === messageId && m.role === "assistant" && m.kind === "help" ? { ...m, hits } : m)) });
  }

  // ---- Model orchestration -------------------------------------------------

  /** True while a model turn is in flight (one at a time). */
  isThinking(): boolean {
    return this.state.messages.some((m) => m.role === "assistant" && m.kind === "pending");
  }

  /**
   * Sends one request to the model turn. Resolves when the answer (or a plain
   * failure) is in the conversation. A turn whose answer arrives after the
   * account changed, or after a clear, is discarded. A lost answer is never
   * retried: any preview the server made is a preview, not a write.
   */
  async sendModel(raw: string, caps: AssistantCapabilitiesDto | null, api: { turn(input: AssistantTurnInput): Promise<AssistantTurnDto> }, timeoutMs = 60_000): Promise<void> {
    if (this.isThinking()) return;
    if (looksPasted(raw)) {
      this.pasteToIntake(raw, caps);
      return;
    }
    const text = raw.trim().slice(0, ASSISTANT_MAX_REQUEST_CHARS);
    if (!text) return;
    const account = this.state.account;
    const generation = this.generation;
    const history = this.modelMessages();
    const { tasks, handles } = this.turnTasks();
    const pendingId = this.nextId();
    this.set({
      messages: [...this.state.messages, { id: this.nextId(), role: "user", text }, { id: pendingId, role: "assistant", kind: "pending", text: "Working on it…" }],
      lastActivity: this.now(),
      notice: null,
    });

    let answer: AssistantTurnDto | null = null;
    let failed = false;
    try {
      answer = await withTimeout(api.turn({ messages: [...history, { role: "user", text }], tasks }), timeoutMs);
    } catch {
      failed = true;
    }
    // Discard an answer for another account or an earlier conversation.
    if (this.state.account !== account || this.generation !== generation) return;
    const drop = () => this.state.messages.filter((m) => m.id !== pendingId);
    if (failed || !answer) {
      this.set({ messages: [...drop(), { id: this.nextId(), role: "assistant", kind: "text", text: "I couldn’t get an answer from the assistant. Nothing was approved or changed. Try again, or use the task buttons below." }] });
      return;
    }
    this.set({ messages: drop() });
    switch (answer.outcome) {
      case "blocked": {
        const found = answer.blockedCategories.map((c) => ASSISTANT_BLOCK_LABELS[c] ?? c).join(", ");
        this.say({ id: this.nextId(), role: "assistant", kind: "text", text: `I didn’t send that to the AI because it seems to include ${found}. Personal details go in the task forms, not the chat.` });
        // Still help, without the model: the request is understood on this device.
        this.respond(routeAssistantRequest(text), caps);
        return;
      }
      case "unavailable":
        this.respond(routeAssistantRequest(text), caps);
        return;
      default:
        this.say({ id: this.nextId(), role: "assistant", kind: "text", text: answer.reply, model: answer.outcome === "answered" });
        this.applyActions(answer.actions, handles, caps);
    }
  }

  /** Earlier user text and model replies, newest last, as the turn API takes them. */
  private modelMessages(): AssistantTurnInput["messages"] {
    const out: AssistantTurnInput["messages"] = [];
    for (const m of this.state.messages) {
      if (m.role === "user") out.push({ role: "user", text: m.text.slice(0, 1_000) });
      else if (m.kind === "text" && m.model) out.push({ role: "assistant", text: m.text.slice(0, 1_000) });
    }
    return out.slice(-(ASSISTANT_TURN_MAX_MESSAGES - 1));
  }

  /** Open tasks as handles t1…t9 with their structure; the handle map is kept for this turn only. */
  private turnTasks(): { tasks: AssistantTaskState[]; handles: Map<string, string> } {
    const handles = new Map<string, string>();
    const tasks: AssistantTaskState[] = [];
    const open = Object.values(this.state.tasks).filter((t) => t.status !== "closed" && !t.reference).slice(-ASSISTANT_TURN_MAX_TASKS);
    open.forEach((t, i) => {
      const handle = `t${i + 1}`;
      handles.set(handle, t.id);
      const status = t.status === "active" ? t.stage : t.status === "closed" ? "closed" : t.status;
      tasks.push({
        handle, workflow: t.workflow, status,
        ...(t.scope.termId !== undefined ? { termId: t.scope.termId } : {}),
        ...(t.scope.classArmIds ? { classArmIds: t.scope.classArmIds.slice(0, 20) } : {}),
        ...(t.scope.overdueOnly !== undefined ? { overdueOnly: t.scope.overdueOnly } : {}),
        ...(t.scope.includePaymentPlans !== undefined ? { includePaymentPlans: t.scope.includePaymentPlans } : {}),
        ...(t.scope.placeLater !== undefined ? { placeLater: t.scope.placeLater } : {}),
        ...(t.scope.fields ? { fields: t.scope.fields } : {}),
        ...(t.scope.studentCount !== undefined ? { studentCount: Math.min(t.scope.studentCount, 500) } : {}),
        ...(t.ref.runId ? { runId: t.ref.runId } : {}),
        ...(t.ref.proposalId ? { proposalId: t.ref.proposalId } : {}),
        ...(t.ref.campaignId ? { campaignId: t.ref.campaignId } : {}),
      });
    });
    return { tasks, handles };
  }

  /** Applies a turn's actions to the cards. Only code-built actions; none approves. */
  applyActions(actions: readonly AssistantTurnAction[], handles: Map<string, string>, caps: AssistantCapabilitiesDto | null) {
    for (const a of actions) {
      if (a.kind === "help") {
        this.say({ id: this.nextId(), role: "assistant", kind: "help", text: "From the Getting started guide:", hits: a.hits, query: a.query });
        continue;
      }
      if (a.kind === "show") {
        const existing = Object.values(this.state.tasks).find((t) => (a.runId && t.ref.runId === a.runId) || (a.campaignId && t.ref.campaignId === a.campaignId) || (a.proposalId && t.ref.proposalId === a.proposalId));
        if (existing) continue;
        const id = this.nextId();
        const task: AssistantTask = { ...newTask(id, a.workflow, {}), reference: true, autoCheck: true, ref: { runId: a.runId, campaignId: a.campaignId, proposalId: a.proposalId } };
        this.set({ tasks: { ...this.state.tasks, [id]: task } });
        this.say({ id: this.nextId(), role: "assistant", kind: "task", taskId: id, text: "Here is what the server has now:" });
        continue;
      }
      if (!caps?.workflows[a.kind]?.available) continue;
      const plan: TaskPlan = a.kind === "invoices"
        ? { kind: "invoices", termId: a.termId, classArmIds: a.classArmIds, runId: a.runId, problem: a.problem }
        : a.kind === "reminders"
          ? { kind: "reminders", termId: a.termId, classArmId: a.classArmId, className: a.className, overdueOnly: a.overdueOnly, includePaymentPlans: a.includePaymentPlans, autoPreview: a.autoPreview }
          : a.kind === "intake"
            ? { kind: "intake", termId: a.termId, classArmId: a.classArmId, placeLater: a.placeLater }
            : { kind: "corrections", fields: a.fields };
      const known = handles.get(a.handle);
      const current = known ? this.state.tasks[known] : undefined;
      if (current && current.workflow === a.kind) {
        // Never re-plan a task whose operation is in flight or finished.
        if (current.status !== "active") continue;
        this.set({ tasks: { ...this.state.tasks, [current.id]: { ...current, plan, revision: current.revision + 1 } }, lastActivity: this.now() });
        continue;
      }
      const id = this.nextId();
      handles.set(a.handle, id);
      this.set({ tasks: { ...this.state.tasks, [id]: { ...newTask(id, a.kind, {}), plan, revision: 1 } } });
      this.say({ id: this.nextId(), role: "assistant", kind: "task", taskId: id, text: ASSISTANT_WORKFLOW_LABELS[a.kind] });
    }
  }

  /** Pasted rows go into the intake form, never to the model. */
  private pasteToIntake(raw: string, caps: AssistantCapabilitiesDto | null) {
    this.set({ messages: [...this.state.messages, { id: this.nextId(), role: "user", text: "(pasted rows: kept on this device)" }], lastActivity: this.now(), notice: null });
    if (!caps?.workflows.intake.available) {
      this.say({ id: this.nextId(), role: "assistant", kind: "text", text: "That looks like pasted rows. I didn’t send them anywhere. Adding students isn’t available to you here, so nothing else happened." });
      return;
    }
    const id = this.nextId();
    this.set({ tasks: { ...this.state.tasks, [id]: { ...newTask(id, "intake", {}), plan: { kind: "intake", termId: null, classArmId: null, placeLater: false, pasted: raw.slice(0, 20_000) }, revision: 1 } } });
    this.say({ id: this.nextId(), role: "assistant", kind: "text", text: "I kept those rows out of the AI and put them in the student form below. Check them, choose where they go, then ask for the server’s preview." });
    this.say({ id: this.nextId(), role: "assistant", kind: "task", taskId: id, text: ASSISTANT_WORKFLOW_LABELS.intake });
  }

  /** A card reports where it is and what it holds (ids and counts). Cheap when unchanged. */
  reportTask(id: string, patch: { stage?: TaskStage; scope?: TaskScope }) {
    const t = this.state.tasks[id];
    if (!t) return;
    const next = { ...t, ...(patch.stage ? { stage: patch.stage } : {}), ...(patch.scope ? { scope: { ...t.scope, ...patch.scope } } : {}) };
    if (JSON.stringify(next.scope) === JSON.stringify(t.scope) && next.stage === t.stage) return;
    this.set({ tasks: { ...this.state.tasks, [id]: next } });
  }

  // ---- Tasks ---------------------------------------------------------------

  task(id: string): AssistantTask | undefined {
    return this.state.tasks[id];
  }

  updateTask(id: string, patch: Partial<Pick<AssistantTask, "status" | "ref" | "stage">>) {
    const t = this.state.tasks[id];
    if (!t) return;
    this.set({ tasks: { ...this.state.tasks, [id]: { ...t, ...patch, ref: { ...t.ref, ...(patch.ref ?? {}) } } }, lastActivity: this.now() });
  }

  /** The task's live session, created once and kept across navigation. */
  session<T extends Disposable>(taskId: string, create: () => T): T {
    let s = this.sessions.get(taskId) as T | undefined;
    if (!s) {
      s = create();
      this.sessions.set(taskId, s);
    }
    return s;
  }

  /**
   * Drops a task's session so its card starts again with a fresh one: used when
   * a model plan revises a card whose unapproved preview is now out of date.
   * Refused while an operation is in flight or its outcome is open.
   */
  resetSession(id: string): boolean {
    const t = this.state.tasks[id];
    if (!t || t.status !== "active") return false;
    this.sessions.get(id)?.dispose();
    this.sessions.delete(id);
    this.set({ tasks: { ...this.state.tasks, [id]: { ...t, stage: "editing" } } });
    return true;
  }

  /** Closes a finished or abandoned task; refuses while its outcome is open. */
  closeTask(id: string): boolean {
    const t = this.state.tasks[id];
    if (!t || t.status === "confirming" || t.status === "uncertain") return false;
    this.sessions.get(id)?.dispose();
    this.sessions.delete(id);
    this.set({ tasks: { ...this.state.tasks, [id]: { ...t, status: "closed" } } });
    return true;
  }
}

const INTRO: Record<AssistantWorkflow, string> = {
  invoices: "I'll prepare term invoices. Choose the term and classes; I'll show the server's preview before anything is issued.",
  reminders: "I'll prepare a fee-reminder campaign. Choose the term and families; you'll review the server's preview before anything is sent.",
  intake: "I'll add and enrol students. Enter them below and choose where they go; nothing is saved until you confirm the preview.",
  corrections: "I'll prepare corrections. Find each student, change only what's wrong, and confirm the server's before-and-after.",
};

function newTask(id: string, workflow: AssistantWorkflow, hints: RouteHints): AssistantTask {
  return { id, workflow, status: "active", hints, ref: {}, reference: false, revision: 0, stage: "editing", scope: {} };
}

/** Two or more lines separated by tabs or commas: a paste from a spreadsheet. */
export function looksPasted(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  return lines.length >= 2 && lines.filter((l) => /[\t,]/.test(l)).length >= 2;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}
