import { redirect } from "next/navigation";

// Tabbed landing page for /settings/academic. Slice 1 only has Years/Terms,
// so we bounce straight to /settings/academic/years. When Slice 2 adds
// ClassLevels and Slice 3 adds Subjects, this becomes a real tabbed page
// with a Years/Class Levels/Subjects selector.
export default function AcademicSettingsIndex() {
  redirect("/settings/academic/years");
}
