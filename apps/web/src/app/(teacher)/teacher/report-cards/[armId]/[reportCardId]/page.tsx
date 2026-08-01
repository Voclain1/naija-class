import { ReportCardDetailPage } from "@/components/report-cards/report-card-detail-page";

// Teacher-side mirror of (admin)/report-cards/[armId]/[reportCardId] — see
// (teacher)/teacher/report-cards/page.tsx for why this route exists.
export default function TeacherReportCardDetail() {
  return <ReportCardDetailPage basePath="/teacher/report-cards" />;
}
