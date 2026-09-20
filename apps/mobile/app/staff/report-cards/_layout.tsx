import { Stack } from "expo-router";

// CP8 — a stack INSIDE the "report-cards" tab.
//
// Without this, expo-router flattens the folder's routes into the tab
// navigator above: every nested screen would become its own tab, and a
// pushed detail screen would replace the bar instead of sitting under it.
// One stack per section also restores each screen's own header title.
export default function ReportCardsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
