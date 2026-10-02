import { SectionStack } from "../../../src/components/section-stack";

// A stack INSIDE the "homework" route, so the screen keeps its own header and
// back button — same reason as the calendar and announcements layouts.
export default function HomeworkLayout() {
  return <SectionStack />;
}
