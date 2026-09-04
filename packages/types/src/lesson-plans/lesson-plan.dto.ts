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
/** One chunk that grounded a generation, as shown to the teacher. */
export interface LessonPlanGroundingChunkDto {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  /** Citable path, e.g. "First Term > WEEK 5". Null when the source had no detectable structure. */
  heading: string | null;
  /** Cosine distance. Displayed to nobody; stored so CP4 can tune the floor from real retrievals. */
  distance: number;
}

export type LessonPlanGroundingReasonDto =
  | "ok"
  | "no-documents"
  // CP5 / D35 — a scheme of work exists for this subject and class level but
  // has not been approved yet. Distinct from "no-documents" because the action
  // it implies is the opposite: confirm what you uploaded, do not upload again.
  | "awaiting-review"
  | "no-match"
  | "not-configured"
  | "error";

export interface LessonPlanGroundingDto {
  reason: LessonPlanGroundingReasonDto;
  /** Nearest distance even when nothing cleared the floor — CP4 tuning data. */
  nearestDistance: number | null;
  chunks: LessonPlanGroundingChunkDto[];
}

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

  /**
   * What this plan was grounded in (Phase 7 / CP3, D20). Null for every plan
   * generated before CP3, and for generations where retrieval was never
   * attempted.
   *
   * Present-but-empty is meaningful and NOT the same as null: it means
   * retrieval ran and found nothing, which is what the UI reports so a teacher
   * knows whether to upload a scheme of work.
   */
  groundedOn: LessonPlanGroundingDto | null;

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
  // Grounding is a DETAIL-view concern. The list shows what plans exist; the
  // citation belongs beside the plan it justifies, where a teacher can check
  // it against the retrieved content. Carrying it in the list would also mean
  // loading every plan's chunk metadata to render a page that never shows it.
  | "groundedOn"
> & { hasContent: boolean; hasQuiz: boolean };
