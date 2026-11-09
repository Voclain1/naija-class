import {
  ASSISTANT_INACTIVITY_MINUTES,
  ASSISTANT_MAX_REQUEST_CHARS,
  ASSISTANT_WORKFLOW_LABELS,
  routeAssistantRequest,
  type AssistantCapabilitiesDto,
  type AssistantHelpHitDto,
  type AssistantRoute,
  type AssistantWorkflow,
  type RouteHints,
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

export type TaskStatus = "active" | "confirming" | "uncertain" | "done" | "closed";

/** Opaque server ids for an operation whose outcome may need checking. */
export interface TaskRef {
  proposalId?: string;
  campaignId?: string;
  runId?: string;
}

export interface AssistantTask {
  id: string;
  workflow: AssistantWorkflow;
  status: TaskStatus;
  hints: RouteHints;
  ref: TaskRef;
  /** True for a task reduced to its ids by a clear: it can only check its outcome. */
  reference: boolean;
}

export type AssistantMessage =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; kind: "text"; text: string }
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
    const keep = Object.values(this.state.tasks).filter((t) => (t.status === "confirming" || t.status === "uncertain" || (t.status === "active" && (t.ref.campaignId || t.ref.runId))) && (t.ref.proposalId || t.ref.campaignId || t.ref.runId));
    for (const [id, s] of this.sessions) {
      s.dispose();
      this.sessions.delete(id);
    }
    const tasks: Record<string, AssistantTask> = {};
    const messages: AssistantMessage[] = [];
    for (const t of keep) {
      tasks[t.id] = { ...t, hints: {}, reference: true, status: "uncertain" };
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
        const task: AssistantTask = { id, workflow: route.workflow, status: "active", hints: route.hints, ref: {}, reference: false };
        this.set({ tasks: { ...this.state.tasks, [id]: task } });
        this.say({ id: this.nextId(), role: "assistant", kind: "task", taskId: id, text: INTRO[route.workflow] });
        return;
      }
    }
  }

  setHelpHits(messageId: string, hits: AssistantHelpHitDto[]) {
    this.set({ messages: this.state.messages.map((m) => (m.id === messageId && m.role === "assistant" && m.kind === "help" ? { ...m, hits } : m)) });
  }

  // ---- Tasks ---------------------------------------------------------------

  task(id: string): AssistantTask | undefined {
    return this.state.tasks[id];
  }

  updateTask(id: string, patch: Partial<Pick<AssistantTask, "status" | "ref">>) {
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
