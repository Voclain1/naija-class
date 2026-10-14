import { SectionStack } from "../../../src/components/section-stack";

// A stack INSIDE the "exam-papers" route, so each screen keeps its own header
// and back button — same reason as the homework and calendar layouts.
export default function ExamPapersLayout() {
  return <SectionStack />;
}
