import { Stack } from "expo-router";

// CP4d — a stack inside the "reports" section, so the teacher activity view
// opened from the summary keeps its back button under the tab bar.
export default function ReportsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
