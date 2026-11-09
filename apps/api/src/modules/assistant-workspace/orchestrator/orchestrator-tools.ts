import { orchestratorToolSpec } from "@school-kit/ai";
import { z } from "zod";

import {
  STUDENT_CORRECTION_FIELDS,
  type AssistantCapabilitiesDto,
  type AssistantHelpHitDto,
  type AssistantTaskState,
  type AssistantTaskStatus,
  type AssistantTurnAction,
  type AssistantWorkflow,
  type BillingRunDto,
  type ReminderCampaignDto,
  type StudentCorrectionProposalDto,
  type StudentIntakeProposalDto,
  type StudentLookupResultDto,
} from "@school-kit/types";
import { ConflictError, ForbiddenError, NotFoundError, STUDENT_RECORD_SECTIONS } from "@school-kit/types";

import type { AuthContext } from "../../../common/auth/auth-context.js";
import { ToolRegistry, type ReadToolDefinition } from "../../../common/ai/tools/tool-registry.js";
import { distinctArmLabel, resolveClasses, resolveTerm, safeLabel, termLabel, type SchoolStructure, type StructureArm } from "./resolve.js";

// ---------------------------------------------------------------------------
// The orchestration tools (docs/modules/assistant-workspace.md, "Model
// orchestration"). Built per turn, bound to that turn's state, and run through
// the ordinary ToolRegistry, which re-reads the user's active status and
// grants, validates arguments and cuts outputs to a field allowlist on EVERY
// call. On top of that each tool re-checks the workflow's own availability
// (switches, role) the way its service does.
//
// What a tool returns to the MODEL: term and class labels, counts and
// statuses. Never names, contacts, admission numbers, money or ids. What it
// returns to the BROWSER is a separate list of actions, built here from
// resolved, tenant-scoped ids.
//
// No tool approves. prepare_invoices creates the billing run's PENDING preview
// (the existing #512 service); approval is the separate endpoint the person
// calls from the card, with the preview's hash.
// ---------------------------------------------------------------------------

/** Everything a tool reaches outside itself. Supplied by the service, or by the conformance spec. */
export interface OrchestratorDeps {
  structure(auth: AuthContext): Promise<SchoolStructure>;
  capabilities(auth: AuthContext): Promise<AssistantCapabilitiesDto>;
  prepareInvoices(auth: AuthContext, scope: { termId: string; classArmIds: string[] }): Promise<BillingRunDto>;
  invoiceRun(auth: AuthContext, id: string): Promise<BillingRunDto>;
  campaign(auth: AuthContext, id: string): Promise<ReminderCampaignDto>;
  reminderProposalCampaignId(auth: AuthContext, id: string): Promise<string | null>;
  intakeProposal(auth: AuthContext, id: string): Promise<StudentIntakeProposalDto>;
  correctionProposal(auth: AuthContext, id: string): Promise<StudentCorrectionProposalDto>;
  recentCampaignIds(auth: AuthContext): Promise<string[]>;
  searchGuide(question: string): AssistantHelpHitDto[];
  /** Named lookup through StudentLookupService (tenant, role, student.read, teacher scope). */
  findStudents(auth: AuthContext, query: { name: string; classArmIds?: string[] }): Promise<StudentLookupResultDto>;
  /** The caller's current permissions, for per-section checks. */
  permissions(auth: AuthContext): Promise<Set<string>>;
}

/** A student this conversation found, re-checked against tenant and scope this turn. */
export interface TurnStudent {
  handle: string;
  studentId: string;
  selected: boolean;
  classLabel: string | null;
}

/** A task the browser described, with its ids checked against this school. */
export interface TurnTask {
  handle: string;
  workflow: AssistantWorkflow;
  status: AssistantTaskStatus;
  termId: string | null;
  arms: StructureArm[];
  overdueOnly: boolean;
  includePaymentPlans: boolean;
  placeLater: boolean;
  fields: string[];
  studentCount: number;
  runId?: string;
  proposalId?: string;
  campaignId?: string;
}

/** Statuses after which a task is fixed: its operation is in flight or finished. */
const LOCKED: ReadonlySet<AssistantTaskStatus> = new Set(["confirming", "uncertain", "done"]);

export class TurnState {
  readonly actions: AssistantTurnAction[] = [];
  readonly tasks = new Map<string, TurnTask>();
  /** Same scope prepared twice in one turn (a repeated tool call): one preview, one action. */
  private readonly prepared = new Map<string, Record<string, unknown>>();

  readonly students = new Map<string, TurnStudent>();

  /**
   * `students`: found earlier and already re-checked by the caller (ids from
   * another school, or outside a teacher's classes, are absent). `persons`:
   * the ⟨P#⟩ markers of this request → the name as typed, held by the server
   * for this request only and never sent to the model.
   */
  constructor(
    readonly structure: SchoolStructure,
    tasks: readonly AssistantTaskState[],
    students: readonly TurnStudent[] = [],
    readonly persons: ReadonlyMap<string, string> = new Map(),
  ) {
    for (const st of students) this.students.set(st.handle, st);
    const termIds = new Set(structure.terms.map((t) => t.id));
    const arms = new Map(structure.arms.map((a) => [a.id, a]));
    for (const t of tasks) {
      // Another school's term or class id resolves to nothing here.
      this.tasks.set(t.handle, {
        handle: t.handle,
        workflow: t.workflow,
        status: t.status,
        termId: t.termId && termIds.has(t.termId) ? t.termId : null,
        arms: (t.classArmIds ?? []).map((id) => arms.get(id)).filter((a): a is StructureArm => !!a),
        overdueOnly: t.overdueOnly ?? false,
        includePaymentPlans: t.includePaymentPlans ?? false,
        placeLater: t.placeLater ?? false,
        fields: t.fields ?? [],
        studentCount: t.studentCount ?? 0,
        runId: t.runId,
        proposalId: t.proposalId,
        campaignId: t.campaignId,
      });
    }
  }

  /** The handle for a new task: the next free t1…t9. */
  private newHandle(): string | null {
    for (let i = 1; i <= 9; i++) if (!this.tasks.has(`t${i}`)) return `t${i}`;
    return null;
  }

  /** Resolves "new" or a handle to a task of this workflow the model may change. */
  target(asked: string, workflow: AssistantWorkflow): { ok: true; task: TurnTask } | { ok: false; out: Record<string, unknown> } {
    if (asked === "new") {
      const handle = this.newHandle();
      if (!handle) return { ok: false, out: { status: "too_many_tasks", note: "Ask the person to close a finished task first." } };
      const task: TurnTask = { handle, workflow, status: "editing", termId: null, arms: [], overdueOnly: false, includePaymentPlans: false, placeLater: false, fields: [], studentCount: 0 };
      this.tasks.set(handle, task);
      return { ok: true, task };
    }
    const task = this.tasks.get(asked);
    if (!task) return { ok: false, out: { status: "unknown_task", note: "Use a handle from <tasks> or \"new\"." } };
    if (task.workflow !== workflow) return { ok: false, out: { status: "wrong_task", task: task.handle, note: `That task is ${task.workflow}, not ${workflow}.` } };
    if (LOCKED.has(task.status)) {
      return { ok: false, out: { status: "locked", task: task.handle, note: "Its operation was already approved or finished; it cannot change. Offer a new task." } };
    }
    return { ok: true, task };
  }

  act(action: AssistantTurnAction) {
    // A later plan for the same task replaces an earlier one from this turn.
    const i = this.actions.findIndex((a) => "handle" in a && "handle" in action && a.handle === action.handle && a.kind === action.kind);
    if (i >= 0) this.actions.splice(i, 1);
    this.actions.push(action);
  }

  remember(key: string): Record<string, unknown> | undefined {
    return this.prepared.get(key);
  }

  record(key: string, out: Record<string, unknown>) {
    this.prepared.set(key, out);
  }

  /** A handle for a student: the existing one, or the next free s1…s9 (null when full). */
  studentHandle(studentId: string, classLabel: string | null): string | null {
    for (const st of this.students.values()) if (st.studentId === studentId) return st.handle;
    for (let i = 1; i <= 9; i++) {
      const h = `s${i}`;
      if (!this.students.has(h)) {
        this.students.set(h, { handle: h, studentId, selected: false, classLabel });
        return h;
      }
    }
    return null;
  }

  /** The structured task summary appended to the person's latest message. Handles, labels and counts only. */
  summary(): string {
    const students = [...this.students.values()].map((st) => `${st.handle}: ${st.selected ? "selected" : "found"}; class ${st.classLabel ? safeLabel(st.classLabel) : "none this term"}`);
    const block = students.length ? `\n<students>\n${students.join("\n")}\n</students>` : "";
    return this.taskSummary() + block;
  }

  private taskSummary(): string {
    if (this.tasks.size === 0) return "<tasks>none</tasks>";
    const armLabel = (a: StructureArm) => distinctArmLabel(a, this.structure.arms);
    const lines = [...this.tasks.values()].map((t) => {
      const term = this.structure.terms.find((x) => x.id === t.termId);
      const parts = [`${t.handle}: ${t.workflow}`, `status ${t.status}`];
      if (term) parts.push(`term ${termLabel(term)}`);
      if (t.workflow === "invoices" || t.workflow === "reminders") parts.push(`classes ${t.arms.length ? t.arms.map(armLabel).join(", ") : "none chosen"}`);
      if (t.workflow === "reminders") parts.push(`overdue only ${t.overdueOnly ? "yes" : "no"}`, `payment plans ${t.includePaymentPlans ? "included" : "left out"}`);
      if (t.workflow === "intake") parts.push(t.placeLater ? "placement later" : `class ${t.arms[0] ? armLabel(t.arms[0]) : "not chosen"}`, `students in form ${t.studentCount}`);
      if (t.workflow === "corrections") parts.push(`fields ${t.fields.join(", ") || "none"}`, `students selected ${t.studentCount}`);
      if (t.workflow === "reminders" && t.studentCount) parts.push(`students selected ${t.studentCount}`);
      return parts.join("; ");
    });
    return `<tasks>\n${lines.join("\n")}\n</tasks>`;
  }
}

// ---- argument schemas -------------------------------------------------------

const TASK = z.string().regex(/^(new|t[1-9])$/);
const LABEL = z.string().trim().min(1).max(40);
const LABELS = z.array(LABEL).max(20);

const invoiceArgs = z
  .object({ task: TASK, term: LABEL.optional(), classes: LABELS.optional(), exclude_classes: LABELS.optional(), all_classes: z.boolean().optional() })
  .strict();
const reminderArgs = z
  .object({ task: TASK, term: LABEL.optional(), class: LABEL.optional(), all_classes: z.boolean().optional(), overdue_only: z.boolean().optional(), include_payment_plans: z.boolean().optional() })
  .strict();
const intakeArgs = z.object({ task: TASK, class: LABEL.optional(), term: LABEL.optional(), place_later: z.boolean().optional() }).strict();
const correctionArgs = z.object({ task: TASK, fields: z.array(z.enum(STUDENT_CORRECTION_FIELDS)).min(1).max(6) }).strict();
const statusArgs = z.object({ task: z.string().regex(/^t[1-9]$/) }).strict();
const noArgs = z.object({}).strict();
const guideArgs = z.object({ question: z.string().trim().min(2).max(300) }).strict();
const findStudentArgs = z.object({ person: z.string().regex(/^P[1-9]\d?$/), class: LABEL.optional() }).strict();
const studentArgs = z.object({ student: z.string().regex(/^s[1-9]$/) }).strict();
const recordArgs = z.object({ student: z.string().regex(/^s[1-9]$/), section: z.enum(STUDENT_RECORD_SECTIONS) }).strict();
const SECTION_PERMISSION: Record<(typeof STUDENT_RECORD_SECTIONS)[number], string> = { summary: "student.read", attendance: "attendance.read", results: "report-card.read" };


type Def = ReadToolDefinition<z.AnyZodObject>;

/** Why a workflow is unavailable to this person, or null. Re-read on every call. */
async function refuseUnless(deps: OrchestratorDeps, auth: AuthContext, workflow: AssistantWorkflow): Promise<void> {
  const caps = await deps.capabilities(auth);
  const w = caps.workflows[workflow];
  if (!caps.enabled || !w.available) throw new ForbiddenError("ASSISTANT_TASK_UNAVAILABLE", "Not available.");
}

function clarification(structure: SchoolStructure, term: ReturnType<typeof resolveTerm> | null, classes: ReturnType<typeof resolveClasses> | null) {
  return {
    status: "needs_clarification",
    term: term && !term.ok ? { problem: term.problem, options: term.options } : null,
    classes: classes && (classes.unknown.length || classes.ambiguous.length)
      ? { unknown: classes.unknown, ambiguous: classes.ambiguous, choices: structure.arms.slice(0, 40).map((a) => distinctArmLabel(a, structure.arms)) }
      : null,
    note: "Ask the person one short question. Do not guess.",
  };
}

/** Builds this turn's registry. */
export function orchestratorToolRegistry(deps: OrchestratorDeps, state: TurnState): ToolRegistry {
  const registry = new ToolRegistry();
  for (const def of orchestratorTools(deps, state)) registry.register(def);
  return registry;
}

export function orchestratorTools(deps: OrchestratorDeps, state: TurnState): Def[] {
  const s = state.structure;
  const armLabel = (a: StructureArm) => distinctArmLabel(a, s.arms);

  const schoolStructure: ReadToolDefinition<typeof noArgs> = {
    name: "school_structure",
    ...orchestratorToolSpec("school_structure"),
    access: { kind: "anyActiveStaff", reason: "Term and class names are school structure every staff member works with; no person is listed." },
    effect: "read",
    args: noArgs,
    outputFields: ["terms", "classes"],
    conformanceCalls: [{}],
    async run() {
      return {
        terms: s.terms.map((t) => ({ label: termLabel(t), current: t.isCurrent })),
        classes: s.arms.slice(0, 80).map((a) => ({ label: armLabel(a), level: safeLabel(a.level) })),
      };
    },
  };

  const prepareInvoices: ReadToolDefinition<typeof invoiceArgs> = {
    name: "prepare_invoices",
    ...orchestratorToolSpec("prepare_invoices"),
    access: { kind: "permissions", permissions: ["invoice.read"] },
    effect: "prepare",
    args: invoiceArgs,
    outputFields: ["status", "task", "term", "classes", "classCount", "newInvoices", "alreadyInvoiced", "problems", "reason", "note"],
    conformanceCalls: [{ task: "new", term: "current", all_classes: true }, { task: "new", classes: ["No Such Class"] }],
    async run({ authCtx }, args) {
      await refuseUnless(deps, authCtx, "invoices");
      const target = state.target(args.task, "invoices");
      if (!target.ok) return target.out;
      const task = target.task;
      const term = args.term !== undefined || !task.termId ? resolveTerm(s, args.term ?? "current") : { ok: true as const, term: s.terms.find((t) => t.id === task.termId)! };
      const base = args.all_classes ? { arms: s.arms, unknown: [], ambiguous: [] } : args.classes ? resolveClasses(s, args.classes) : { arms: task.arms, unknown: [], ambiguous: [] };
      const excluded = args.exclude_classes ? resolveClasses(s, args.exclude_classes) : { arms: [], unknown: [], ambiguous: [] };
      const classes = { arms: base.arms.filter((a) => !excluded.arms.some((x) => x.id === a.id)), unknown: [...base.unknown, ...excluded.unknown], ambiguous: [...base.ambiguous, ...excluded.ambiguous] };
      if (!term.ok || classes.unknown.length || classes.ambiguous.length) return clarification(s, term.ok ? null : term, classes);
      if (classes.arms.length === 0) return { status: "needs_clarification", note: "No classes are chosen. Ask which classes." };
      if (classes.arms.length > 20) return { status: "needs_clarification", note: "A run covers at most 20 classes. Ask the person to narrow it." };

      const ids = classes.arms.map((a) => a.id).sort();
      const key = `invoices:${task.handle}:${term.term.id}:${ids.join(",")}`;
      const seen = state.remember(key);
      if (seen) return seen;

      const labels = { term: termLabel(term.term), classes: classes.arms.map(armLabel) };
      task.termId = term.term.id;
      task.arms = classes.arms;
      let out: Record<string, unknown>;
      try {
        const run = await deps.prepareInvoices(authCtx, { termId: term.term.id, classArmIds: ids });
        state.act({ kind: "invoices", handle: task.handle, termId: term.term.id, classArmIds: ids, runId: run.id, problem: null });
        out = {
          status: "prepared", task: task.handle, ...labels, classCount: run.arms.length,
          newInvoices: run.createCount, alreadyInvoiced: run.skipCount, problems: run.blockers.length,
          note: "The preview is in the card. The person checks it and approves there; a changed scope needs a fresh review.",
        };
      } catch (e) {
        if (!(e instanceof ConflictError || e instanceof NotFoundError)) throw e;
        // Prefill the card so the person can adjust; nothing was prepared.
        state.act({ kind: "invoices", handle: task.handle, termId: term.term.id, classArmIds: ids, runId: null, problem: e.code ?? "NOT_PREPARED" });
        out = { status: "not_prepared", task: task.handle, ...labels, reason: e.code === "BILLING_LIMIT" ? "too many students or classes for one run" : "the server could not prepare this preview" };
      }
      state.record(key, out);
      return out;
    },
  };

  const planReminders: ReadToolDefinition<typeof reminderArgs> = {
    name: "plan_reminders",
    ...orchestratorToolSpec("plan_reminders"),
    access: { kind: "permissions", permissions: ["finance.debtors.read"] },
    effect: "read",
    args: reminderArgs,
    outputFields: ["status", "task", "term", "class", "overdueOnly", "includePaymentPlans", "note"],
    conformanceCalls: [{ task: "new", all_classes: true, overdue_only: true }],
    async run({ authCtx }, args) {
      await refuseUnless(deps, authCtx, "reminders");
      const target = state.target(args.task, "reminders");
      if (!target.ok) return target.out;
      const task = target.task;
      const term = args.term !== undefined || !task.termId ? resolveTerm(s, args.term ?? "current") : { ok: true as const, term: s.terms.find((t) => t.id === task.termId)! };
      const cls = args.class ? resolveClasses(s, [args.class]) : null;
      if (!term.ok || (cls && (cls.unknown.length || cls.ambiguous.length))) return clarification(s, term.ok ? null : term, cls);
      if (cls && cls.arms.length > 1) return { status: "needs_clarification", note: "Reminders cover one class or all classes. Ask which one, or all." };
      const arm = args.all_classes ? null : cls ? cls.arms[0]! : task.arms[0] ?? null;
      const overdueOnly = args.overdue_only ?? task.overdueOnly;
      const includePaymentPlans = args.include_payment_plans ?? task.includePaymentPlans;
      Object.assign(task, { termId: term.term.id, arms: arm ? [arm] : [], overdueOnly, includePaymentPlans });
      state.act({ kind: "reminders", handle: task.handle, termId: term.term.id, classArmId: arm?.id ?? null, overdueOnly, includePaymentPlans, autoPreview: true });
      return {
        status: "preview_requested", task: task.handle, term: termLabel(term.term), class: arm ? armLabel(arm) : "all classes", overdueOnly, includePaymentPlans,
        note: "The card selects the matching families and shows the server's preview. The person confirms there; nothing is sent before that.",
      };
    },
  };

  const planIntake: ReadToolDefinition<typeof intakeArgs> = {
    name: "plan_student_intake",
    ...orchestratorToolSpec("plan_student_intake"),
    access: { kind: "permissions", permissions: ["student.create"] },
    effect: "read",
    args: intakeArgs,
    outputFields: ["status", "task", "class", "term", "placeLater", "studentsInForm", "note"],
    conformanceCalls: [{ task: "new", place_later: true }],
    async run({ authCtx }, args) {
      await refuseUnless(deps, authCtx, "intake");
      const target = state.target(args.task, "intake");
      if (!target.ok) return target.out;
      const task = target.task;
      if (args.place_later) {
        Object.assign(task, { placeLater: true, arms: [], termId: null });
        state.act({ kind: "intake", handle: task.handle, termId: null, classArmId: null, placeLater: true });
        return { status: "form_ready", task: task.handle, placeLater: true, studentsInForm: task.studentCount, note: "Students are typed or pasted into the card." };
      }
      const term = resolveTerm(s, args.term ?? "current");
      const cls = args.class ? resolveClasses(s, [args.class]) : null;
      if (!term.ok || (cls && (cls.unknown.length || cls.ambiguous.length))) return clarification(s, term.ok ? null : term, cls);
      if (cls && cls.arms.length !== 1) return { status: "needs_clarification", note: "Students go into one class. Ask which." };
      const arm = cls ? cls.arms[0]! : task.arms[0] ?? null;
      Object.assign(task, { placeLater: false, arms: arm ? [arm] : [], termId: term.term.id });
      state.act({ kind: "intake", handle: task.handle, termId: term.term.id, classArmId: arm?.id ?? null, placeLater: false });
      return {
        status: "form_ready", task: task.handle, class: arm ? armLabel(arm) : "not chosen", term: termLabel(term.term), placeLater: false,
        studentsInForm: task.studentCount, note: "Students are typed or pasted into the card; the person checks the server's preview and confirms there.",
      };
    },
  };

  const planCorrections: ReadToolDefinition<typeof correctionArgs> = {
    name: "plan_corrections",
    ...orchestratorToolSpec("plan_corrections"),
    access: { kind: "permissions", permissions: ["student.read", "student.update"] },
    effect: "read",
    args: correctionArgs,
    outputFields: ["status", "task", "fields", "selectedStudents", "note"],
    conformanceCalls: [{ task: "new", fields: ["email"] }],
    async run({ authCtx }, args) {
      await refuseUnless(deps, authCtx, "corrections");
      const target = state.target(args.task, "corrections");
      if (!target.ok) return target.out;
      const task = target.task;
      task.fields = [...new Set(args.fields)];
      state.act({ kind: "corrections", handle: task.handle, fields: [...new Set(args.fields)] });
      return {
        status: "form_ready", task: task.handle, fields: task.fields, selectedStudents: task.studentCount,
        note: task.studentCount ? "The new values are typed in the card; the person checks the before-and-after and confirms there." : "The person finds the student in the card first.",
      };
    },
  };

  const taskStatus: ReadToolDefinition<typeof statusArgs> = {
    name: "task_status",
    ...orchestratorToolSpec("task_status"),
    access: { kind: "anyActiveStaff", reason: "Reads only the person's own saved operation, through its own service's checks." },
    effect: "read",
    args: statusArgs,
    outputFields: ["status", "task", "workflow", "state", "issued", "skipped", "saved", "changed", "sends", "heldForQuietHours", "note"],
    conformanceCalls: [{ task: "t1" }],
    async run({ authCtx }, { task: handle }) {
      const task = state.tasks.get(handle);
      if (!task) return { status: "unknown_task", task: handle };
      const base = { status: "ok", task: handle, workflow: task.workflow };
      if (task.workflow === "invoices" && task.runId) {
        const run = await deps.invoiceRun(authCtx, task.runId);
        state.act({ kind: "show", workflow: "invoices", runId: run.id });
        return { ...base, state: run.status === "COMPLETED" ? "issued" : "awaiting approval", issued: run.result?.created ?? 0, skipped: run.result?.skipped ?? 0 };
      }
      if (task.workflow === "reminders" && (task.campaignId || task.proposalId)) {
        const id = task.campaignId ?? (await deps.reminderProposalCampaignId(authCtx, task.proposalId!));
        if (!id) return { ...base, state: "not confirmed", note: "Nothing was sent from this review." };
        const c = await deps.campaign(authCtx, id);
        state.act({ kind: "show", workflow: "reminders", campaignId: c.id });
        return { ...base, state: c.status.toLowerCase(), sends: c.counts, heldForQuietHours: c.heldForQuietHours, note: "UNKNOWN means it may have been sent; it is never retried automatically." };
      }
      if (task.workflow === "intake" && task.proposalId) {
        const p = await deps.intakeProposal(authCtx, task.proposalId);
        state.act({ kind: "show", workflow: "intake", proposalId: p.id });
        return { ...base, state: p.status.toLowerCase(), saved: p.status === "COMPLETED" && p.outcome ? p.outcome.createdCount : 0 };
      }
      if (task.workflow === "corrections" && task.proposalId) {
        const p = await deps.correctionProposal(authCtx, task.proposalId);
        state.act({ kind: "show", workflow: "corrections", proposalId: p.id });
        return { ...base, state: p.status.toLowerCase(), changed: p.status === "COMPLETED" && p.outcome ? p.outcome.updatedCount : 0 };
      }
      return { ...base, state: "nothing saved yet", note: "Nothing from this task has reached the server." };
    },
  };

  const recentCampaigns: ReadToolDefinition<typeof noArgs> = {
    name: "recent_campaigns",
    ...orchestratorToolSpec("recent_campaigns"),
    access: { kind: "permissions", permissions: ["finance.debtors.read"] },
    effect: "read",
    args: noArgs,
    outputFields: ["campaigns", "note"],
    conformanceCalls: [{}],
    async run({ authCtx }) {
      const ids = (await deps.recentCampaignIds(authCtx)).slice(0, 3);
      const campaigns: Record<string, unknown>[] = [];
      for (const id of ids) {
        const c = await deps.campaign(authCtx, id);
        campaigns.push({ started: c.createdAt.slice(0, 10), state: c.status.toLowerCase(), sends: c.counts, heldForQuietHours: c.heldForQuietHours });
      }
      if (ids[0]) state.act({ kind: "show", workflow: "reminders", campaignId: ids[0] });
      return { campaigns, note: campaigns.length ? "UNKNOWN means it may have been sent; it is never retried automatically." : "No campaigns started by this person." };
    },
  };

  const guide: ReadToolDefinition<typeof guideArgs> = {
    name: "search_guide",
    ...orchestratorToolSpec("search_guide"),
    access: { kind: "anyActiveStaff", reason: "The Getting started guide is product documentation every staff member can read." },
    effect: "read",
    args: guideArgs,
    outputFields: ["sections"],
    conformanceCalls: [{ question: "How do I add parents?" }],
    async run(_ctx, { question }) {
      const hits = deps.searchGuide(question);
      state.act({ kind: "help", query: question, hits });
      return { sections: hits.map((h) => ({ title: h.title, excerpt: h.excerpt.slice(0, 400) })) };
    },
  };

  const findStudent: ReadToolDefinition<typeof findStudentArgs> = {
    name: "find_student",
    ...orchestratorToolSpec("find_student"),
    access: { kind: "permissions", permissions: ["student.read"] },
    effect: "read",
    args: findStudentArgs,
    outputFields: ["status", "matches", "note"],
    conformanceCalls: [{ person: "P1" }, { person: "P1", class: "JSS 2" }],
    async run({ authCtx }, args) {
      const raw = state.persons.get(args.person);
      if (!raw) return { status: "unknown_person", note: "Use a ⟨P#⟩ marker from the person's message." };
      const cls = args.class ? resolveClasses(s, [args.class]) : null;
      if (cls && (cls.unknown.length || cls.ambiguous.length)) return clarification(s, null, cls);
      // The server resolves the name it holds for this marker, under the caller's tenant, role and scope.
      const result = await deps.findStudents(authCtx, { name: raw, ...(cls ? { classArmIds: cls.arms.map((a) => a.id) } : {}) });
      const matches = result.matches.flatMap((m) => {
        const handle = state.studentHandle(m.studentId, m.classLabel);
        return handle ? [{ ...m, handle }] : [];
      });
      if (result.status === "found" && matches[0]) state.students.get(matches[0].handle)!.selected = true;
      state.act({ kind: "students", asked: raw, status: result.status, matches });
      return {
        status: result.status,
        // Handles and class labels only: the names are shown to the person in a card.
        matches: matches.map((m) => ({ student: m.handle, class: m.classLabel ? safeLabel(m.classLabel) : "none this term", match: m.match })),
        note:
          result.status === "found" ? "One student; shown to the person in a card and selected."
            : result.status === "several" ? "Several students have that name. Ask which one, by class; do not guess."
              : result.status === "similar" ? "No exact match; close spellings are shown. Ask the person to choose or correct the name."
                : "No student the person can see matches. Say so and ask them to check the name or class.",
      };
    },
  };

  const selectStudent: ReadToolDefinition<typeof studentArgs> = {
    name: "select_student",
    ...orchestratorToolSpec("select_student"),
    access: { kind: "permissions", permissions: ["student.read"] },
    effect: "read",
    args: studentArgs,
    outputFields: ["status", "student", "class"],
    conformanceCalls: [{ student: "s1" }],
    async run(_ctx, { student }) {
      const st = state.students.get(student);
      if (!st) return { status: "unknown_student" };
      for (const other of state.students.values()) other.selected = other.handle === student;
      state.act({ kind: "select-student", handle: st.handle, studentId: st.studentId });
      return { status: "selected", student: st.handle, class: st.classLabel ? safeLabel(st.classLabel) : "none this term" };
    },
  };

  const studentRecord: ReadToolDefinition<typeof recordArgs> = {
    name: "student_record",
    ...orchestratorToolSpec("student_record"),
    access: { kind: "permissions", permissions: ["student.read"] },
    effect: "read",
    args: recordArgs,
    outputFields: ["status", "student", "section", "note"],
    conformanceCalls: [{ student: "s1", section: "summary" }, { student: "s1", section: "attendance" }, { student: "s1", section: "results" }],
    async run({ authCtx }, { student, section }) {
      const st = state.students.get(student);
      if (!st) return { status: "unknown_student", note: "Find the student first." };
      // Each section is read by the browser from its own permission-checked endpoint; refuse early when it would be refused there.
      const perms = await deps.permissions(authCtx);
      if (!perms.has("*") && !perms.has(SECTION_PERMISSION[section])) return { status: "not_permitted", student, section };
      state.act({ kind: "student-record", handle: st.handle, studentId: st.studentId, section });
      return { status: "shown", student, section, note: "Shown to the person in a card. You do not see the record; do not describe its contents." };
    },
  };

  return [schoolStructure, prepareInvoices, planReminders, planIntake, planCorrections, taskStatus, recentCampaigns, guide, findStudent, selectStudent, studentRecord] as unknown as Def[];
}

export const ORCHESTRATOR_TOOL_NAMES = [
  "find_student",
  "plan_corrections",
  "plan_reminders",
  "plan_student_intake",
  "prepare_invoices",
  "recent_campaigns",
  "school_structure",
  "search_guide",
  "select_student",
  "student_record",
  "task_status",
] as const;
