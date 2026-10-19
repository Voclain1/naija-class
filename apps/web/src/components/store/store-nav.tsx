"use client";

import { SectionTabs, type SectionTabItem } from "@/components/shared/section-tabs";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";

// The Store's sections (docs/modules/id-cards-and-store.md §4). A tab shows
// only to someone holding its permission.
const TABS: Array<SectionTabItem & { permission: string }> = [
  { href: "/store", label: "Items", exact: true, permission: "store.read" },
  { href: "/store/stock-takes", label: "Stock takes", permission: "store.read" },
  { href: "/store/reports", label: "Reports", permission: "store.read" },
  { href: "/store/assets", label: "Assets", permission: "asset.read" },
];

export function StoreNav() {
  const { permissions } = useAuth();
  const items = TABS.filter((t) => hasPermission(permissions, t.permission));
  if (items.length < 2) return null;
  return <SectionTabs ariaLabel="Store sections" items={items} />;
}
