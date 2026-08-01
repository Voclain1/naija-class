import { ReportCardBoard } from "@/components/report-cards/report-card-board";

// Teacher-side mirror of (admin)/report-cards/[armId] — see
// (teacher)/teacher/report-cards/page.tsx for why this route exists.
export default function TeacherReportCardBoardPage() {
  return <ReportCardBoard basePath="/teacher/report-cards" />;
}
