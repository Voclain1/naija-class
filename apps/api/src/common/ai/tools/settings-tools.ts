import { z } from "zod";

import { withTenant } from "@school-kit/db";
import { PLAN_LABELS, resolveLetterGrade } from "@school-kit/types";

import { GradingService } from "../../../modules/grading/grading.service";
import { NotificationPreferencesService } from "../../../modules/notifications/notification-preferences.service";
import { SetupStateService } from "../../../modules/setup-state/setup-state.service";
import type { ReadToolDefinition } from "./tool-registry";

// ---------------------------------------------------------------------------
// FD-5b — the help assistant's settings tools (docs/reviews/
// agentic-implementation-plan.md §3.3). Read-only views of the school's own
// configuration, each a narrow projection of what an existing service
// already returns to the same person on the matching settings page.
//
// Rules every tool here follows:
//   - It calls the EXISTING service, so the service's own role check still
//     applies on top of the registry's permission check (setup progress and
//     notification channels are owner/admin in the service; a refusal there
//     reaches the model as "not permitted", see tool-registry.ts).
//   - No ids, no user ids, no timestamps of who changed what: the model gets
//     settings, not records.
//   - No contact details, Paystack or bank fields, and nothing about any
//     student, guardian or member of staff. The FD-3b gate runs every tool
//     here over a populated fixture school on every CI pass.
//   - Strings a school typed (grade remarks, component labels, the school's
//     name) are DATA. FD-5c's prompt treats them so; nothing here interprets
//     them.
// ---------------------------------------------------------------------------

const grading = new GradingService();
const setupState = new SetupStateService();
const notificationPrefs = new NotificationPreferencesService();

type NoArgs = z.ZodObject<Record<string, never>, "strict">;
const noArgs = z.object({}).strict();
const noArgsSchema = { type: "object", properties: {}, additionalProperties: false } as const;

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const SCHOOL_PROFILE_SUMMARY: ReadToolDefinition<NoArgs> = {
  name: "school_profile_summary",
  description:
    "The signed-in user's school: its name, its SchoolKit plan, and the current school year and term with their dates. No contact details.",
  access: {
    kind: "anyActiveStaff",
    reason: "Every member of staff sees the school's name, plan and current term in the app's header and dashboard.",
  },
  effect: "read",
  args: noArgs,
  inputSchema: noArgsSchema,
  outputFields: ["schoolName", "plan", "currentYear", "currentTerm"],
  conformanceCalls: [{}],
  async run({ authCtx }) {
    const { school, year, term } = await withTenant(authCtx.schoolId, async (db) => ({
      // `schools` has no RLS (it is the tenant table): read the one row by the session's own id.
      school: await db.school.findUniqueOrThrow({
        where: { id: authCtx.schoolId },
        select: { name: true, plan: true },
      }),
      year: await db.academicYear.findFirst({
        where: { isCurrent: true },
        select: { label: true, startDate: true, endDate: true },
      }),
      term: await db.term.findFirst({
        where: { isCurrent: true },
        select: { name: true, startDate: true, endDate: true },
      }),
    }));
    return {
      schoolName: school.name,
      plan: PLAN_LABELS[school.plan],
      currentYear: year ? { label: year.label, starts: isoDate(year.startDate), ends: isoDate(year.endDate) } : null,
      currentTerm: term ? { name: term.name, starts: isoDate(term.startDate), ends: isoDate(term.endDate) } : null,
    };
  },
};

export const SCHOOL_SETUP_PROGRESS: ReadToolDefinition<NoArgs> = {
  name: "school_setup_progress",
  description:
    "The dashboard's setup checklist for the user's school: each step's key, title, whether it is done, and the page that completes it. Owners and admins only.",
  access: {
    kind: "anyActiveStaff",
    reason: "Gated in the service itself (owner or admin), as the dashboard checklist is; anyone else is refused there.",
  },
  effect: "read",
  args: noArgs,
  inputSchema: noArgsSchema,
  outputFields: ["status", "steps"],
  conformanceCalls: [{}],
  async run({ authCtx }) {
    const state = await setupState.getSetupState(authCtx);
    // Keys, titles, done flags and the page to go to. Not the counts: "how
    // many students" is a figure about the roster, and the checklist does not
    // need it to say what is left.
    return {
      status: state.status,
      steps: state.steps.map((s) => ({ key: s.key, tier: s.tier, title: s.title, done: s.done, page: s.href })),
    };
  },
};

export const GRADING_SCHEME: ReadToolDefinition<NoArgs> = {
  name: "grading_scheme",
  description:
    "The school's grading scheme: its name and its score components (for example First CA 20, Second CA 20, Exam 60) with their weights, which add up to 100.",
  access: { kind: "permissions", permissions: ["grading-scheme.read"] },
  effect: "read",
  args: noArgs,
  inputSchema: noArgsSchema,
  outputFields: ["name", "components"],
  conformanceCalls: [{}],
  async run({ authCtx }) {
    const scheme = await grading.getScheme(authCtx);
    return {
      name: scheme.name,
      components: scheme.components.map((c) => ({ label: c.label, weight: c.weight })),
    };
  },
};

export const GRADING_BOUNDARIES: ReadToolDefinition<NoArgs> = {
  name: "grading_boundaries",
  description:
    "The school's grade boundaries: each letter grade with its lowest and highest total score (both inclusive) and the school's remark for it.",
  access: { kind: "permissions", permissions: ["grade-boundary.read"] },
  effect: "read",
  args: noArgs,
  inputSchema: noArgsSchema,
  outputFields: ["boundaries"],
  conformanceCalls: [{}],
  async run({ authCtx }) {
    const rows = await grading.listBoundaries(authCtx);
    return { boundaries: rows.map((b) => ({ letter: b.letter, min: b.minScore, max: b.maxScore, remark: b.remark })) };
  },
};

const explainArgs = z.object({ score: z.number().int().min(0).max(100) }).strict();

export const GRADING_EXPLAIN_SCORE: ReadToolDefinition<typeof explainArgs> = {
  name: "grading_explain_score",
  description:
    "Which grade a total score (a whole number from 0 to 100) gets under this school's boundaries, the band it falls in, and how far it is from the next grade up and down. The user gives the number; no student is looked up.",
  access: { kind: "permissions", permissions: ["grade-boundary.read"] },
  effect: "read",
  args: explainArgs,
  inputSchema: {
    type: "object",
    properties: { score: { type: "integer", minimum: 0, maximum: 100, description: "A term total from 0 to 100." } },
    required: ["score"],
    additionalProperties: false,
  },
  outputFields: ["score", "grade", "band", "nextUp", "nextDown"],
  conformanceCalls: [{ score: 0 }, { score: 39 }, { score: 40 }, { score: 59 }, { score: 60 }, { score: 100 }],
  async run({ authCtx }, { score }) {
    const rows = await grading.listBoundaries(authCtx);
    const bands = rows.map((b) => ({ letter: b.letter, minScore: b.minScore, maxScore: b.maxScore, remark: b.remark }));
    // The SAME function the gradebook uses to grade a total (assessment.service.ts).
    const letter = resolveLetterGrade(score, bands);
    const band = bands.find((b) => b.letter === letter) ?? null;
    const above = bands.filter((b) => b.minScore > score).sort((a, b) => a.minScore - b.minScore)[0];
    const below = bands.filter((b) => b.maxScore < score).sort((a, b) => b.maxScore - a.maxScore)[0];
    return {
      score,
      grade: letter, // null when the school's bands leave this score uncovered
      band: band ? { min: band.minScore, max: band.maxScore, remark: band.remark } : null,
      nextUp: above ? { grade: above.letter, from: above.minScore, marksNeeded: above.minScore - score } : null,
      nextDown: below ? { grade: below.letter, upTo: below.maxScore } : null,
    };
  },
};

export const NOTIFICATION_CHANNELS: ReadToolDefinition<NoArgs> = {
  name: "notification_channels",
  description:
    "Which channels the school's notifications go out on (email, SMS, push), as set in Settings → Notifications.",
  access: { kind: "permissions", permissions: ["notification-preferences.read"] },
  effect: "read",
  args: noArgs,
  inputSchema: noArgsSchema,
  outputFields: ["email", "sms", "push"],
  conformanceCalls: [{}],
  async run({ authCtx }) {
    const p = await notificationPrefs.get(authCtx);
    // Not `updatedBy`: that is a user id.
    return { email: p.emailEnabled, sms: p.smsEnabled, push: p.pushEnabled };
  },
};

export const SETTINGS_TOOLS = [
  SCHOOL_PROFILE_SUMMARY,
  SCHOOL_SETUP_PROGRESS,
  GRADING_SCHEME,
  GRADING_BOUNDARIES,
  GRADING_EXPLAIN_SCORE,
  NOTIFICATION_CHANNELS,
] as const;
