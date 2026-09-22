import { Stack } from "expo-router";

// Branded receipts — a stack inside the "receipts" route, like every staff
// section, so each screen keeps its own header and back button.
export default function ReceiptsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
