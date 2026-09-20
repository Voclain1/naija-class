import { Stack } from "expo-router";

// CP8 — a stack INSIDE the "timetable" route, so the screen keeps its own header
// and back button. A direct file child of the Tabs layout would render with
// neither, because its <Stack.Screen> options have no stack to apply to.
export default function TimetableLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
