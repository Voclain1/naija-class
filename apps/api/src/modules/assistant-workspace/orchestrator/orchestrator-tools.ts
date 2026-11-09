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
} from "@school-kit/types";
import { ConflictError, ForbiddenError, NotFoundError } from "@school-kit/types";

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

  constructor(readonly structure: SchoolStructure, tasks: readonly AssistantTaskState[]) {
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

  /** The structured task summary appended to the person's latest message. Labels and counts only. */
  summary(): string {
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
const TASK_SCHEMA = { type: "string", pattern: "^(new|t[1-9])$", description: 'A handle from <tasks> to change that task, or "new".' };
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

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
const labelSchema = (description: string) => ({ type: "string", maxLength: 40, description });
const labelsSchema = (description: string) => ({ type: "array", items: { type: "string", maxLength: 40 }, maxItems: 20, description });

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
    description: "The school's terms (with which is current) and its active classes, as labels. Use it to match what the person said.",
    access: { kind: "anyActiveStaff", reason: "Term and class names are school structure every staff member works with; no person is listed." },
    effect: "read",
    args: noArgs,
    inputSchema: obj({}, []),
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
    description:
      "Prepare the server's preview of term invoices for some classes, in the invoice card. For a follow-up, pass the task's handle and only what changes (exclude_classes removes classes from its current set). Issues nothing: the person approves in the card.",
    access: { kind: "permissions", permissions: ["invoice.read"] },
    effect: "prepare",
    args: invoiceArgs,
    inputSchema: obj(
      {
        task: TASK_SCHEMA,
        term: labelSchema('"current", "next", "first"/"second"/"third", or a term label. Omit to keep the task\'s term (new task: current).'),
        classes: labelsSchema('Class labels ("JSS 2A") or whole levels ("JSS 2"). Omit to keep the task\'s classes.'),
        exclude_classes: labelsSchema("Classes to leave out."),
        all_classes: { type: "boolean", description: "Every active class." },
      },
      ["task"],
    ),
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
    description:
      "Set the fee-reminder card's term, ONE class or all classes, and options, then ask the server for its preview of matching families. Sends nothing: the person confirms in the card.",
    access: { kind: "permissions", permissions: ["finance.debtors.read"] },
    effect: "read",
    args: reminderArgs,
    inputSchema: obj(
      {
        task: TASK_SCHEMA,
        term: labelSchema('"current" or a term label. Omit to keep the task\'s term (new task: current).'),
        class: labelSchema("One class label. Omit with all_classes for every class."),
        all_classes: { type: "boolean", description: "Every class." },
        overdue_only: { type: "boolean", description: "Only families with an overdue invoice." },
        include_payment_plans: { type: "boolean", description: "Include families on a payment plan (default: leave them out)." },
      },
      ["task"],
    ),
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
      state.act({ kind: "reminders", handle: task.handle, termId: term.term.id, classArmId: arm?.id ?? null, className: arm?.name ?? null, overdueOnly, includePaymentPlans, autoPreview: true });
      return {
        status: "preview_requested", task: task.handle, term: termLabel(term.term), class: arm ? armLabel(arm) : "all classes", overdueOnly, includePaymentPlans,
        note: "The card selects the matching families and shows the server's preview. The person confirms there; nothing is sent before that.",
      };
    },
  };

  const planIntake: ReadToolDefinition<typeof intakeArgs> = {
    name: "plan_student_intake",
    description:
      "Open or update the add-and-enrol card with a class and term, or place later. The person types or pastes the students into the card's form, never into chat. Saves nothing.",
    access: { kind: "permissions", permissions: ["student.create"] },
    effect: "read",
    args: intakeArgs,
    inputSchema: obj(
      {
        task: TASK_SCHEMA,
        class: labelSchema("One class label."),
        term: labelSchema('"current" or a term label (default current).'),
        place_later: { type: "boolean", description: "Add the students without a class for now." },
      },
      ["task"],
    ),
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
    description:
      "Choose which fields the student-correction card changes (firstName, middleName, lastName, dateOfBirth, gender, email). The person finds the students and types the new values in the card. Changes nothing.",
    access: { kind: "permissions", permissions: ["student.read", "student.update"] },
    effect: "read",
    args: correctionArgs,
    inputSchema: obj({ task: TASK_SCHEMA, fields: { type: "array", items: { type: "string", enum: [...STUDENT_CORRECTION_FIELDS] }, minItems: 1, maxItems: 6 } }, ["task", "fields"]),
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
    description: "What happened to a task's saved work (its invoice run, intake, corrections or reminder campaign), read from the server now. Also shows it in a card.",
    access: { kind: "anyActiveStaff", reason: "Reads only the person's own saved operation, through its own service's checks." },
    effect: "read",
    args: statusArgs,
    inputSchema: obj({ task: { type: "string", pattern: "^t[1-9]$" } }, ["task"]),
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
    description: "The person's own most recent fee-reminder campaigns (newest first): when, status and send counts. Shows the newest in a card.",
    access: { kind: "permissions", permissions: ["finance.debtors.read"] },
    effect: "read",
    args: noArgs,
    inputSchema: obj({}, []),
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
    description: "Search SchoolKit's Getting started guide for how to do something. Returns up to three sections.",
    access: { kind: "anyActiveStaff", reason: "The Getting started guide is product documentation every staff member can read." },
    effect: "read",
    args: guideArgs,
    inputSchema: obj({ question: { type: "string", minLength: 2, maxLength: 300 } }, ["question"]),
    outputFields: ["sections"],
    conformanceCalls: [{ question: "How do I add parents?" }],
    async run(_ctx, { question }) {
      const hits = deps.searchGuide(question);
      state.act({ kind: "help", query: question, hits });
      return { sections: hits.map((h) => ({ title: h.title, excerpt: h.excerpt.slice(0, 400) })) };
    },
  };

  return [schoolStructure, prepareInvoices, planReminders, planIntake, planCorrections, taskStatus, recentCampaigns, guide] as unknown as Def[];
}

export const ORCHESTRATOR_TOOL_NAMES = [
  "plan_corrections",
  "plan_reminders",
  "plan_student_intake",
  "prepare_invoices",
  "recent_campaigns",
  "school_structure",
  "search_guide",
  "task_status",
] as const;
