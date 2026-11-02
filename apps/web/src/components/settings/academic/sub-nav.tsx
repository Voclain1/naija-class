"use client";

import { SectionTabs, type SectionTabItem } from "@/components/shared/section-tabs";

// Order follows the first-time-setup flow: calendar → buckets → groupings →
// catalogue → which subjects each class takes.
const TABS: SectionTabItem[] = [
  { href: "/settings/academic/years", label: "Years" },
  { href: "/settings/academic/class-levels", label: "Class Levels" },
  { href: "/settings/academic/class-arms", label: "Class Arms" },
  { href: "/settings/academic/subjects", label: "Subjects" },
  { href: "/settings/academic/class-subjects", label: "Subjects by class" },
];

export function AcademicSubNav() {
  return <SectionTabs ariaLabel="Academic settings sections" items={TABS} />;
}
