import type { DashboardCollectionGroupDto } from "@school-kit/types";

import { formatKobo } from "@/lib/finance/format";

// Billed vs collected per class level.
//
// ONE component, rendered on BOTH the admin dashboard and the finance
// dashboard. Deliberately shared rather than copied: the rows include a
// synthetic "Unassigned" bucket whose whole purpose is to make them sum to the
// totals shown above them, and two copies would be two places for that to
// drift. The server-side builder is shared for the same reason
// (apps/api/src/modules/finance/collection-by-group.ts).
//
// Amounts are rendered exactly as the API returned them. No arithmetic here —
// CLAUDE.md's money rule: the frontend displays what the API computed.

export const UNASSIGNED_GROUP_ID = "unassigned";

export function CollectionByLevel({
  groups,
  emptyMessage = "No invoices issued this term yet.",
}: {
  groups: DashboardCollectionGroupDto[];
  emptyMessage?: string;
}) {
  if (groups.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <CollectionRow key={group.groupId} group={group} />
      ))}
    </div>
  );
}

function CollectionRow({ group }: { group: DashboardCollectionGroupDto }) {
  const unassigned = group.groupId === UNASSIGNED_GROUP_ID;
  const percent = Math.min(100, Math.max(0, group.percent));

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="text-sm font-medium text-foreground">
          {group.label}
          {unassigned && (
            // Named rather than silently folded in: these are invoices whose
            // student has no enrollment for the term. Showing the bucket is
            // what makes the rows add up; explaining it is what stops it
            // reading as a data error.
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              not enrolled this term
            </span>
          )}
        </span>
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatKobo(group.collected)} of {formatKobo(group.billed)}{" "}
          <span className="ml-1 font-medium text-foreground">{group.percent}%</span>
        </span>
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-primary/15"
        role="progressbar"
        aria-valuenow={group.percent}
        aria-valuemin={0}
        aria-valuemax={100}
        // Distinctive, so it cannot collide by substring with a nav item, a
        // term <select>, or another row's label — the accessible-name
        // collision that broke the a11y suite once already.
        aria-label={`${group.label} fee collection`}
      >
        <div
          className={unassigned ? "h-full rounded-full bg-muted-foreground/50" : "h-full rounded-full bg-primary"}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
