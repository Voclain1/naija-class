import { ReportCardsPicker } from "@/components/report-cards/report-cards-picker";

// Teacher-side mirror of (admin)/report-cards — same component, same
// server-side authorization (a bare `teacher` role is bounced out of the
// (admin) route group entirely by RequireAuth, so a form teacher needs
// their own reachable route to the exact board they're already allowed to
// act on server-side). See report-cards-picker.tsx for the shared logic.
export default function TeacherReportCardsPickerPage() {
  return <ReportCardsPicker basePath="/teacher/report-cards" />;
}
