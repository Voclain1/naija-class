import { z } from "zod";

// The SchoolKit Assistant workspace (2026-11-09, docs/modules/assistant-workspace.md).
//
// One panel in the staff shell that turns a staff member's request into one of
// four existing, reviewed workflows. Requests are understood by the
// deterministic router below, IN THE BROWSER. No request text goes to a model:
// operational chat is not covered by any approved model prompt, and the
// help-assistant exception (CLAUDE.md) is scoped to help questions in a pilot
// that is not active.
//
// Model orchestration (2026-11-09, ./orchestration.ts) is a separate, gated
// path: the `assistant-model-routing` switch, off everywhere, and refused in
// production until its own allowlist row is approved. When it is unavailable
// the browser uses the deterministic router below.

export const ASSISTANT_WORKFLOWS = ["invoices", "reminders", "intake", "corrections"] as const;
export type AssistantWorkflow = (typeof ASSISTANT_WORKFLOWS)[number];

/** The approved browser-only inactivity limit (CLAUDE.md, help-assistant rule 1). */
export const ASSISTANT_INACTIVITY_MINUTES = 15;
/** Longest request the composer accepts. */
export const ASSISTANT_MAX_REQUEST_CHARS = 500;

export const ASSISTANT_WORKFLOW_LABELS: Record<AssistantWorkflow, string> = {
  invoices: "Generate term invoices",
  reminders: "Send fee reminders",
  intake: "Add and enrol students",
  corrections: "Correct student records",
};

export type AssistantUnavailableReason = "FEATURE_OFF" | "NO_PERMISSION";

export interface AssistantCapabilitiesDto {
  /** The workspace itself (the "assistant-workspace" switch, and the platform override). */
  enabled: boolean;
  workflows: Record<AssistantWorkflow, { available: boolean; reason: AssistantUnavailableReason | null; canApprove: boolean }>;
  /** Searching the in-app guide. No model. */
  help: { available: boolean };
  /** A model reading free-text requests. Not approved: always false in this build. */
  /**
   * Model-backed understanding (./orchestration.ts). NOT_APPROVED: the prompt's
   * allowlist row is pending and this is a production deployment.
   * FEATURE_OFF: the school's `assistant-model-routing` switch is off.
   * AI_UNAVAILABLE: AI is off for the school or not configured.
   */
  modelRouting: { available: boolean; reason: "NOT_APPROVED" | "FEATURE_OFF" | "AI_UNAVAILABLE" | null };
  inactivityMinutes: number;
}

export const assistantHelpQuerySchema = z.object({ question: z.string().trim().min(2).max(300) }).strict();
export type AssistantHelpQuery = z.infer<typeof assistantHelpQuerySchema>;

export interface AssistantHelpHitDto {
  anchor: string;
  title: string;
  path: string;
  excerpt: string;
}

// ---------------------------------------------------------------------------
// The deterministic router
// ---------------------------------------------------------------------------

export type UnsupportedTopic =
  | "deletion"
  | "admission-number"
  | "grades"
  | "behaviour"
  | "health"
  | "guardians"
  | "credentials"
  | "status"
  | "enrolment-move"
  | "money"
  | "messaging"
  | "student-writing"
  | "other";

export interface RouteHints {
  /** "current", "next", or a term sequence (1 = first term). */
  term?: "current" | "next" | 1 | 2 | 3;
  /** Normalised class mentions ("jss1a", "primary4"); matched to real classes by the caller. */
  classes?: string[];
  allClasses?: boolean;
  overdueOnly?: boolean;
  includePaymentPlans?: boolean;
  studentCount?: number;
  /** Which correctable fields were mentioned. */
  fields?: ("name" | "dateOfBirth" | "gender" | "email")[];
}

export type AssistantRoute =
  | { kind: "workflow"; workflow: AssistantWorkflow; hints: RouteHints }
  | { kind: "help"; query: string }
  | { kind: "unsupported"; topic: UnsupportedTopic; message: string; next: AssistantWorkflow | "help" | null }
  | { kind: "greeting" }
  | { kind: "clarify"; options: AssistantWorkflow[] };

const UNSUPPORTED: { topic: UnsupportedTopic; test: RegExp; message: string; next: AssistantWorkflow | "help" | null }[] = [
  {
    topic: "credentials",
    test: /\b(password|passcode|otp|one[- ]time|bvn|nin|result ?pin|pin code|login code|2fa|two[- ]factor)\b/,
    message: "I can't see or change passwords, PINs, codes or BVNs, and please don't type them here. Account access is managed in Settings → Staff, and result PINs on the Result PINs page.",
    next: "help",
  },
  {
    topic: "deletion",
    test: /\b(delete|remove|erase|wipe|purge|drop)\b.*\b(students?|records?|pupils?|everyone|all|account|data|invoices?)\b|\b(delete|erase|wipe|purge)\b/,
    message: "I can't delete anything. Deleting records stays a deliberate action on its own page, with its own checks.",
    next: "help",
  },
  {
    topic: "student-writing",
    test: /\b(write|draft|compose)\b.*\b(essay|assignment|homework|composition|answers?)\b/,
    message: "I don't write students' work. I help staff with school admin tasks.",
    next: null,
  },
  {
    topic: "admission-number",
    test: /\badmission (number|no\.?)s?\b/,
    message: "I can't change admission numbers. Corrections here cover names, date of birth, gender and email; admission numbers keep their own controlled path on the student's page.",
    next: "corrections",
  },
  {
    topic: "grades",
    test: /\b(grades?|scores?|marks?|results?|report cards?|gradebook|position)\b/,
    message: "I can't enter or change grades, scores or report cards. Those stay with the teachers' gradebook and report-card approval.",
    next: "help",
  },
  {
    topic: "behaviour",
    test: /\b(behaviou?r|discipline|incident|suspension|merit|demerit|detention)\b/,
    message: "I don't read or record behaviour. Use the Behaviour pages, where those records have their own permissions.",
    next: null,
  },
  {
    topic: "health",
    test: /\b(health|medical|allerg\w*|sick\w*|clinic|vaccin\w*|medication|blood group|genotype)\b/,
    message: "I don't read or change health information. It stays on the Health pages, with their own access rules.",
    next: null,
  },
  {
    topic: "guardians",
    test: /\b(link|unlink|attach|connect)\b.*\b(parents?|guardians?|mother|father)\b|\bguardian links?\b/,
    message: "I can't link or unlink guardians. Do that from the student's Guardians tab.",
    next: "help",
  },
  {
    topic: "enrolment-move",
    test: /\b(move|transfer|promote|switch)\b.*\b(class|arm|jss|js|sss|ss|primary|pri|basic|year)|\bpromotions?\b/,
    message: "I can place NEW students in a class, but I can't move existing students between classes. Use Enrollments or Promotions for that.",
    next: "intake",
  },
  {
    topic: "status",
    test: /\b(withdraw|graduate|reactivate|deactivate|suspend|expel)\w*\b/,
    message: "I can't change a student's status. Withdrawals and graduations stay on the student's page, where they are recorded and audited.",
    next: null,
  },
  {
    topic: "money",
    test: /\b(record|log|enter|post)\b.*\bpayments?\b|\b(refunds?|discounts?|waive\w*|write[- ]off|payroll|salar\w*|expenses?|cancel\w* invoices?)\b/,
    message: "I can't record payments, refunds, discounts or cancellations. I can prepare term invoices and fee-reminder campaigns; money changes stay in Finance.",
    next: "invoices",
  },
];

/** Messages that are not fee reminders: announcements, bulk SMS, WhatsApp blasts. */
const MESSAGING = /\b(announce\w*|broadcast|newsletter|bulk (sms|text|message)|whatsapp|message (all|every)|text (all|every)|sms (all|every)|send (an? )?(sms|text|message|email)s?\b)/;
const FEE = /\b(fees?|owing|owe|debt\w*|unpaid|outstanding|balances?|arrears?|overdue|invoices?|pay(ment)?s?)\b/;

const DETECT: { workflow: AssistantWorkflow; test: RegExp }[] = [
  { workflow: "reminders", test: /\b(remind\w*|chase|follow[- ]up|nudge)\b|\b(debtors?|defaulters?)\b/ },
  { workflow: "invoices", test: /\b(invoice\w*|bill(s|ing)?)\b|\b(generate|issue|raise|prepare|create|send out)\b.*\bfees?\b/ },
  { workflow: "corrections", test: /\b(correct\w*|fix\w*|update\w*|change\w*|edit\w*|amend\w*|wrong|misspel\w*|typo|spelling)\b.*\b(names?|surname|first name|middle name|last name|date of birth|dob|birthday|gender|sex|emails?)\b|\b(names?|date of birth|dob|gender|emails?)\b.*\b(wrong|incorrect|misspel\w*|typo)\b/ },
  { workflow: "intake", test: /\b(add|enrol\w*|enroll\w*|admit\w*|register\w*|onboard)\b.*\b(students?|pupils?|children|kids|learners?|class list|register)\b|\bnew (students?|pupils?|intake|admissions?)\b/ },
];

const HELP = /^(how|where|what|why|when|which|who|can|could|is|are|do|does|should|explain|help|tell me)\b|\?\s*$/;
const ACTION = /\b(generate|issue|raise|send|remind|chase|nudge|add|enrol\w*|enroll\w*|admit|register|fix|correct|update|change|edit|amend|bill|invoice)\b/;
const GREETING = /^(hi|hello|hey|good (morning|afternoon|evening)|thanks|thank you|ok|okay)\b[\s!.]*$/;

function termHint(t: string): RouteHints["term"] {
  if (/\b(this|current|present) term\b/.test(t)) return "current";
  if (/\bnext term\b/.test(t)) return "next";
  if (/\b(first|1st) term\b/.test(t)) return 1;
  if (/\b(second|2nd) term\b/.test(t)) return 2;
  if (/\b(third|3rd) term\b/.test(t)) return 3;
  return undefined;
}

const CLASS = /\b(jss|js|sss|ss|primary|pri|basic|nursery|kg|year|grade|creche|pre[- ]?nursery)\s*-?\s*(\d{1,2})\s*([a-z])?\b/g;

/** "JSS 1 A" / "jss1a" / "Primary 4" -> "jss1a" / "primary4". */
export function normaliseClassLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bpri\b/g, "primary")
    .replace(/\bjs\b/g, "jss")
    .replace(/[^a-z0-9]/g, "");
}

function classHints(t: string): string[] {
  const out = new Set<string>();
  for (const m of t.matchAll(CLASS)) out.add(normaliseClassLabel(`${m[1]}${m[2]}${m[3] ?? ""}`));
  return [...out];
}

const FIELDS: { field: NonNullable<RouteHints["fields"]>[number]; test: RegExp }[] = [
  { field: "name", test: /\b(names?|surname|spelling|misspel\w*|typo)\b/ },
  { field: "dateOfBirth", test: /\b(date of birth|dob|birthday|birth date)\b/ },
  { field: "gender", test: /\b(gender|sex)\b/ },
  { field: "email", test: /\bemails?\b/ },
];

/**
 * Understands a staff request without a model. Returns which workflow it
 * starts, or an honest refusal, or a help search. It never extracts a
 * student's name or any value to act on: names, dates and emails are typed
 * into the workflow's own structured controls, and the request text is not
 * sent anywhere by routing.
 */
export function routeAssistantRequest(raw: string): AssistantRoute {
  const t = raw.toLowerCase().replace(/\s+/g, " ").trim().slice(0, ASSISTANT_MAX_REQUEST_CHARS);
  if (!t) return { kind: "clarify", options: [...ASSISTANT_WORKFLOWS] };
  if (GREETING.test(t)) return { kind: "greeting" };

  for (const u of UNSUPPORTED) {
    if (!u.test.test(t)) continue;
    // "fix the date of birth" is a correction, not "results"; "admission" alone is fine.
    if (u.topic === "grades" && /\b(date of birth|names?|gender|emails?)\b/.test(t)) continue;
    if (u.topic === "money" && /\b(remind\w*|invoices?)\b/.test(t) && !/\b(refunds?|discounts?|record\w* (a )?payments?|cancel\w*)\b/.test(t)) continue;
    if (u.topic === "deletion" && /\b(remove|drop)\b/.test(t) && !/\b(students?|records?|pupils?|everyone|account|data|invoices?)\b/.test(t)) continue;
    return { kind: "unsupported", topic: u.topic, message: u.message, next: u.next };
  }

  // "Where do I find the debtors list?" is a question about the product, not
  // a task: without an action word it goes to the guide.
  if (HELP.test(t) && !ACTION.test(t)) return { kind: "help", query: raw.trim().slice(0, 300) };

  const hits = DETECT.filter((d) => d.test.test(t)).map((d) => d.workflow);
  // A fee reminder is a reminder even when phrased as "send texts to parents who owe".
  if (hits.length === 0 && FEE.test(t) && /\b(parents?|guardians?|families|text|sms|email|message|tell)\b/.test(t)) hits.push("reminders");
  if (hits.length === 0 && MESSAGING.test(t)) {
    return {
      kind: "unsupported",
      topic: "messaging",
      message: "I can only send fee reminders, using the school's own reminder templates and channels. Announcements and other messages are written and sent from Announcements or Messages.",
      next: "reminders",
    };
  }

  if (hits.length === 0) {
    if (HELP.test(t)) return { kind: "help", query: raw.trim().slice(0, 300) };
    return { kind: "unsupported", topic: "other", message: "I can't do that from here yet. I can generate term invoices, send fee reminders, add and enrol students, and correct student names, dates of birth, gender and email.", next: "help" };
  }
  // "Remind parents about invoices" -> reminders; "invoice and remind" -> ask.
  const unique = [...new Set(hits)];
  if (unique.length > 1 && !(unique.includes("reminders") && unique.includes("invoices") && /\bremind\w*\b/.test(t) && !/\b(generate|issue|raise|create)\b/.test(t))) {
    return { kind: "clarify", options: unique };
  }
  const workflow = unique.includes("reminders") && unique.length > 1 ? "reminders" : unique[0]!;

  const hints: RouteHints = {};
  const term = termHint(t);
  if (term !== undefined) hints.term = term;
  const classes = classHints(t);
  if (classes.length) hints.classes = classes;
  if (/\b(all|every|each|whole school|entire school)\b.*\b(class(es)?|arms?|school)\b/.test(t)) hints.allClasses = true;
  if (/\boverdue\b|\bpast due\b|\blate\b/.test(t)) hints.overdueOnly = true;
  if (/\binclud\w* .*payment plans?\b|\bon payment plans? too\b/.test(t)) hints.includePaymentPlans = true;
  const count = t.match(/\b(\d{1,3}) (new )?(students?|pupils?|children|kids)\b/);
  if (count) hints.studentCount = Math.min(Number(count[1]), 200);
  if (workflow === "corrections") {
    const fields = FIELDS.filter((f) => f.test.test(t)).map((f) => f.field);
    if (fields.length) hints.fields = fields;
  }
  return { kind: "workflow", workflow, hints };
}

/** Matches normalised class hints to the school's own classes (exact label or arm name). */
export function matchClassHints<T extends { id: string; name: string; level: string }>(hints: string[], arms: readonly T[]): { matched: T[]; unmatched: string[] } {
  const matched = new Map<string, T>();
  const unmatched: string[] = [];
  for (const h of hints) {
    const exact = arms.filter((a) => normaliseClassLabel(a.name) === h || normaliseClassLabel(`${a.level}${a.name}`) === h);
    // "jss1" names the level: every arm of JSS 1.
    const level = exact.length ? exact : arms.filter((a) => normaliseClassLabel(a.level) === h);
    if (level.length === 0) unmatched.push(h);
    for (const a of level) matched.set(a.id, a);
  }
  return { matched: [...matched.values()], unmatched };
}
