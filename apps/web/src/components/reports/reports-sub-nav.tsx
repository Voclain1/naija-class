"use client";

import { SectionTabs, type SectionTabItem } from "@/components/shared/section-tabs";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";

// Sub-nav for /reports/* (Phase 9 / CP1.2, docs/modules/phase-9.md §8.3).
// Recording is the Phase 8 completeness report; the other three are the
// analytics tabs, each its own page so it can be linked to and so one
// page's audited or heavier reads never run because another was opened.
// A tab shows only for someone holding its permission.
const TABS: Array<SectionTabItem & { permission: string }> = [
  { href: "/reports", label: "Recording", exact: true, permission: "reports.completeness.read" },
  { href: "/reports/academic", label: "Academic", exact: true, permission: "reports.analytics.read" },
  { href: "/reports/attendance", label: "Attendance", exact: true, permission: "reports.analytics.read" },
  { href: "/reports/enrolment", label: "Enrolment", exact: true, permission: "reports.analytics.read" },
];

export function ReportsSubNav() {
  const { permissions } = useAuth();
  const items = TABS.filter((t) => hasPermission(permissions, t.permission));
  if (items.length < 2) return null;
  return <SectionTabs ariaLabel="Report sections" items={items} />;
}
