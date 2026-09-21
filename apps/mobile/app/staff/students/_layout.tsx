import { Stack } from "expo-router";

// CP4c — a stack inside the "students" section, so a student opened from the
// list, or the add form, keeps its back button under the tab bar.
export default function StudentsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
