import { SectionStack } from "../../../src/components/section-stack";

// A stack INSIDE the "question-bank" route, so each screen keeps its own header
// and back button — same reason as the homework and calendar layouts.
export default function QuestionBankLayout() {
  return <SectionStack />;
}
