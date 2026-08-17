// Phase 5 / Slice 2 — lesson plan generator.
//
// Topic is FREE TEXT throughout, deliberately: there is no Topic table and no
// curriculum taxonomy (phase-5.md D13). See the LessonPlan model header in
// schema.prisma for why inventing one now would be premature.

export type LessonPlanStatusDto = "DRAFT" | "ACCEPTED";

// Content sections follow the standard Nigerian lesson note (prompt v2,
// 2026-08-17) and map 1:1 onto lesson_plans columns. All nullable: the row
// exists from the moment generation is requested, so a failed generation is
// inspectable rather than absent.
//
// Rendering order is NOT this declaration order — it is
// LESSON_PLAN_SECTION_ORDER in packages/ai, derived from the output schema.
// Consumers read that rather than assuming field order here.
export interface LessonPlanDto {
  id: string;
  classLevelId: string;
  classLevelName: string;
  subjectId: string;
  subjectName: string;
  topic: string;
  objectives: string | null;
  durationMinutes: number | null;
  status: LessonPlanStatusDto;

  behaviouralObjectives: string | null;
  instructionalMaterials: string | null;
  previousKnowledge: string | null;
  referenceMaterials: string | null;
  mainContent: string | null;
  assessment: string | null;
  homework: string | null;
  conclusion: string | null;
  quiz: string | null;

  // LEGACY, pre-v2. Still served so lesson notes written before the
  // restructure render rather than appearing blank; never populated by a new
  // generation. See the LessonPlan model note in schema.prisma.
  introduction: string | null;
  activities: string | null;

  createdBy: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// List rows omit the generated bodies — a teacher's list view needs the
// heading fields only, and the content columns are long enough that shipping
// them in a list would dominate the payload.
export type LessonPlanSummaryDto = Omit<
  LessonPlanDto,
  | "behaviouralObjectives"
  | "instructionalMaterials"
  | "previousKnowledge"
  | "referenceMaterials"
  | "mainContent"
  | "assessment"
  | "homework"
  | "conclusion"
  | "quiz"
  | "introduction"
  | "activities"
> & { hasContent: boolean; hasQuiz: boolean };
