"use client";

import { useMatrixDirty } from "@/components/settings/academic/matrix-dirty-context";
import { SectionTabs, type SectionTabItem } from "@/components/shared/section-tabs";

// Slice 3 added Class Arms, Subjects, and Class-Subject Matrix tabs.
// Order follows the first-time-setup cognitive flow:
//   calendar → buckets → groupings → catalogue → mapping.
const TABS: SectionTabItem[] = [
  { href: "/settings/academic/years", label: "Years" },
  { href: "/settings/academic/class-levels", label: "Class Levels" },
  { href: "/settings/academic/class-arms", label: "Class Arms" },
  { href: "/settings/academic/subjects", label: "Subjects" },
  { href: "/settings/academic/class-subjects", label: "Matrix" },
];

export function AcademicSubNav() {
  // The matrix page provides the dirty signal via context. Other pages see
  // the default (false) and the confirm guard below is a no-op there.
  const matrixDirty = useMatrixDirty();

  return (
    <SectionTabs
      ariaLabel="Academic settings sections"
      items={TABS}
      onNavigate={(_item, active, e) => {
        if (active) return;
        if (matrixDirty && !window.confirm("The matrix has unsaved changes. Discard them and leave this tab?")) {
          e.preventDefault();
        }
      }}
    />
  );
}
