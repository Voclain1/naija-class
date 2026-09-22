import { Stack } from "expo-router";

// CP9b — a stack inside the "expenses" route, like every staff section, so
// the screen keeps its own header and back button.
export default function ExpensesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
