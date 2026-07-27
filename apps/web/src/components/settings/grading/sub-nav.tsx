"use client";

import { SectionTabs, type SectionTabItem } from "@/components/shared/section-tabs";

// Sub-nav for /settings/grading/*. Phase 2 / Slice 1 ships two tabs: the
// component-weight scheme and the letter-grade boundaries. Later slices may
// add more grading config here.
const TABS: SectionTabItem[] = [
  { href: "/settings/grading", label: "Scheme", exact: true },
  { href: "/settings/grading/boundaries", label: "Boundaries" },
];

export function GradingSubNav() {
  return <SectionTabs ariaLabel="Grading settings sections" items={TABS} />;
}
