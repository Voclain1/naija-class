"use client";

import Link from "next/link";
import { ReceiptText, Sparkles, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/use-auth";

import { resolveDashboardActions, type DashboardActionKey } from "./dashboard-actions";

// The dashboard header's quick actions, rendered on the SAME ROW as the
// greeting rather than in a band of their own.
//
// Each is permission-gated (see dashboard-actions.ts) so a role never sees a
// button that would 403 on arrival — the same rule the topbar's Ledger pill
// follows.

const ICONS: Record<DashboardActionKey, typeof UserPlus> = {
  "record-fee": ReceiptText,
  insights: Sparkles,
  "add-student": UserPlus,
};

export function DashboardActionBar() {
  const { permissions } = useAuth();
  const actions = resolveDashboardActions(permissions);

  if (actions.length === 0) return null;

  return (
    // flex-wrap, not nowrap: three buttons beside a greeting is exactly the
    // shape that pushed the topbar's account control off-screen at 768px
    // earlier in this redesign. Wrapping under the greeting is the correct
    // narrow-screen behaviour; overflowing is not.
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => {
        const Icon = ICONS[action.key];
        return (
          <Button
            key={action.key}
            asChild
            size="sm"
            variant={action.emphasis === "primary" ? "default" : "outline"}
          >
            <Link href={action.href}>
              <Icon className="mr-2 h-4 w-4" aria-hidden />
              {action.label}
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
