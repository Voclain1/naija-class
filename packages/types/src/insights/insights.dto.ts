import { z } from "zod";

// Admin insights — Phase 5 / Slice 8.
//
// An admin types a question in their own words; the platform answers it.
//
// THE DIVISION OF LABOUR IS THE WHOLE DESIGN. The model does exactly two
// things, and neither of them is arithmetic:
//   1. ROUTES — decides which of the fixed questions below is being asked.
//      Its output space is this enum and nothing else.
//   2. NARRATES — writes prose over figures that have already been computed.
//
// Every number an admin sees is produced by SQL in InsightsService. The model
// is never asked to count, rank, average or compare, and never sees a row it
// could misread into a new figure. That is what makes "AI-led" safe here: a
// hallucinated number in front of an owner deciding which class needs a new
// teacher is a materially worse failure than a hallucinated sentence, and this
// shape makes the first one structurally impossible rather than unlikely.
//
// The model also gets NO parameters to fill. An earlier shape had it emit
// `{ intent, params }`; that was dropped because any id-shaped parameter is
// either invented (the model has never seen a class-arm id) or an injection
// surface. Term comes from the request, filters come from the intent. The
// model picks one label from a closed list, full stop.

// The closed set the router may choose from. Declared here rather than in
// packages/ai because both the prompt renderer (which describes them to the
// model) and the query layer (which executes them) must agree, and a drift
// between those two is a silently wrong answer rather than a crash.
export const INSIGHT_INTENTS = [
  "at-risk-students",
  "underperforming-classes",
  "weakest-subjects",
  "attendance-concerns",
] as const;

export type InsightIntent = (typeof INSIGHT_INTENTS)[number];

// What each intent means, in the words the model is shown. Kept beside the
// enum so adding an intent without describing it is visibly incomplete.
export const INSIGHT_INTENT_DESCRIPTIONS: Record<InsightIntent, string> = {
  "at-risk-students":
    "Which individual students are at risk of failing, or falling behind — combining low subject averages with poor attendance.",
  "underperforming-classes":
    "Which classes or class arms are performing worst overall this term, compared with the rest of the school.",
  "weakest-subjects":
    "Which subjects are scoring worst across the school this term, regardless of which class.",
  "attendance-concerns":
    "Which classes have the worst attendance this term, and how many students are frequently absent.",
};

// POST /insights/ask
export const askInsightSchema = z
  .object({
    // Free text from the admin. Length-capped: this is the one field on this
    // surface that reaches a prompt, so it is bounded at the edge rather than
    // trusted to be short.
    question: z.string().trim().min(3).max(500),
    termId: z.string().uuid(),
  })
  .strict();

export type AskInsightInput = z.infer<typeof askInsightSchema>;

// ---------------------------------------------------------------------------
// Result rows — one shape per intent, all computed in SQL.
// ---------------------------------------------------------------------------

// Student rows DO carry names. That is not a PII leak: they are returned to an
// authenticated admin of the student's own school over the API, and rendered
// by the browser. They are never sent to the model — the narration input
// carries counts and class labels only. The two paths are deliberately
// separate for exactly this reason.
export interface AtRiskStudentDto {
  studentId: string;
  firstName: string;
  lastName: string;
  classArmLabel: string;
  averageScore: number | null; // 0-100
  attendanceRate: number | null; // 0-100
  subjectsBelowPass: number;
}

export interface ClassPerformanceDto {
  classArmId: string;
  label: string;
  studentCount: number;
  averageScore: number | null;
  attendanceRate: number | null;
}

export interface SubjectPerformanceDto {
  subjectId: string;
  name: string;
  averageScore: number | null;
  scoredStudentCount: number;
  belowPassCount: number;
}

export interface AttendanceConcernDto {
  classArmId: string;
  label: string;
  attendanceRate: number | null;
  studentsBelowThreshold: number;
  daysMarked: number;
}

export type InsightData =
  | { intent: "at-risk-students"; rows: AtRiskStudentDto[] }
  | { intent: "underperforming-classes"; rows: ClassPerformanceDto[] }
  | { intent: "weakest-subjects"; rows: SubjectPerformanceDto[] }
  | { intent: "attendance-concerns"; rows: AttendanceConcernDto[] };

export interface AskInsightResultDto {
  // Which question the router decided was being asked, echoed back so the UI
  // can say "showing: students at risk" and the admin can tell immediately
  // when it routed wrong. A misroute is this feature's most likely failure,
  // so it is surfaced rather than hidden behind confident prose.
  intent: InsightIntent;
  // Null when the router could not map the question to a supported one. The
  // UI then shows what IS supported instead of guessing — answering a
  // different question than the one asked is worse than saying "not that".
  unsupported: boolean;
  // The narration. Null when unsupported, or when the AI is unavailable and
  // the figures were computed anyway — the table still renders, which is the
  // point of computing first and narrating second.
  answer: string | null;
  data: InsightData | null;
  termId: string;
  termName: string;
}

// The pass mark used for "below pass" counts. 40 is the conventional Nigerian
// secondary-school pass; it is a constant rather than a per-school setting
// because GradeBoundary already models the school's own bands and this is a
// coarse triage signal, not a grade. If a school disputes it, the honest fix
// is to read their lowest passing GradeBoundary, not to make this
// configurable in two places.
export const INSIGHT_PASS_MARK = 40;

// Attendance below this is "frequently absent" for triage purposes.
export const INSIGHT_ATTENDANCE_THRESHOLD = 75;
