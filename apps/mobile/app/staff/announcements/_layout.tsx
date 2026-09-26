import { Stack } from "expo-router";

// A stack INSIDE the "announcements" route, so the screen keeps its own header
// and back button — same reason as the calendar's layout.
export default function AnnouncementsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
