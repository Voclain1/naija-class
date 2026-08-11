// Phase 5 / Slice 2 — lesson plan generator.
//
// Topic is FREE TEXT throughout, deliberately: there is no Topic table and no
// curriculum taxonomy (phase-5.md D13). See the LessonPlan model header in
// schema.prisma for why inventing one now would be premature.

export type LessonPlanStatusDto = "DRAFT" | "ACCEPTED";

// The five content sections mirror ARCHITECTURE.md §7's specified output and
// map 1:1 onto lesson_plans columns. All nullable: the row exists from the
// moment generation is requested, so a failed generation is inspectable
// rather than absent.
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

  introduction: string | null;
  mainContent: string | null;
  activities: string | null;
  assessment: string | null;
  homework: string | null;
  quiz: string | null;

  createdBy: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

// List rows omit the generated bodies — a teacher's list view needs the
// heading fields only, and the content columns are long enough that shipping
// them in a list would dominate the payload.
export type LessonPlanSummaryDto = Omit<
  LessonPlanDto,
  "introduction" | "mainContent" | "activities" | "assessment" | "homework" | "quiz"
> & { hasContent: boolean; hasQuiz: boolean };
