import { Stack } from "expo-router";

// CP4b — a stack inside the "approvals" section, so a class opened from the
// list keeps its back button and the tab bar stays underneath.
export default function ApprovalsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
