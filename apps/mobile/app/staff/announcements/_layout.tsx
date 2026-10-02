import { SectionStack } from "../../../src/components/section-stack";

// A stack INSIDE the "announcements" route, so the screen keeps its own header
// and back button — same reason as the calendar's layout.
export default function AnnouncementsLayout() {
  return <SectionStack />;
}
