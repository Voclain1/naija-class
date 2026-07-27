import Link from "next/link";

// Extracted from the dashboard rebuild's inline "needs you today" JSX
// (dashboard/page.tsx), which was hardcoded to AdminDashboardDto's
// `needsYouToday` array. This version takes a plain, section-agnostic item
// shape so any page's own "needs attention" list (pending invitations on
// Settings > Users, overdue invoices on Finance, awaiting-approval report
// cards) can reuse the same row + empty-state treatment.
export interface AlertListItem {
  key: string;
  label: string;
  count: number;
  href: string;
}

export function AlertList({
  items,
  emptyLabel = "All caught up — nothing needs attention today.",
}: {
  items: AlertListItem[];
  emptyLabel?: string;
}) {
  const visible = items.filter((item) => item.count > 0);

  if (visible.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {visible.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
        >
          <span className="text-foreground">{item.label}</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {item.count}
          </span>
        </Link>
      ))}
    </div>
  );
}
