"use client";

import Link from "next/link";
import { useState } from "react";
import {
  CalendarCheck,
  ClipboardPenLine,
  FileText,
  ChevronDown,
  GraduationCap,
  Megaphone,
  MessagesSquare,
  ReceiptText,
  UserPlus,
} from "lucide-react";

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
  "take-attendance": CalendarCheck,
  "record-payment": ReceiptText,
  "add-student": UserPlus,
  "enter-scores": ClipboardPenLine,
  students: GraduationCap,
  "report-cards": FileText,
  messages: MessagesSquare,
  announcements: Megaphone,
};

// On phones only the first MOBILE_VISIBLE shortcuts show, with the last cell a
// "More" button that reveals the rest, so the greeting card stays short. From
// sm up every shortcut is always visible.
const MOBILE_VISIBLE = 5;

export function DashboardActionBar() {
  const { permissions, school } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const actions = resolveDashboardActions(permissions, school?.modulePreferences?.selected);

  if (actions.length === 0) return null;

  const hasMore = actions.length > MOBILE_VISIBLE + 1;

  return (
    // Two equal columns on phones, a wrapping row from sm up.
    <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
      {actions.map((action, i) => {
        const Icon = ICONS[action.key];
        const hiddenOnPhone = hasMore && !expanded && i >= MOBILE_VISIBLE;
        return (
          <Button
            key={action.key}
            asChild
            size="sm"
            variant={action.emphasis === "primary" ? "default" : "outline"}
            className={`h-auto min-h-11 w-full min-w-0 justify-start whitespace-normal rounded-xl px-2.5 py-1.5 text-left text-[13px] leading-tight max-[339px]:px-2 max-[339px]:text-xs sm:h-9 sm:w-auto sm:justify-center sm:whitespace-nowrap sm:rounded-md sm:px-3 sm:py-0 sm:text-sm ${hiddenOnPhone ? "hidden sm:inline-flex" : ""}`}
          >
            <Link href={action.href}>
              <Icon className="mr-1.5 h-4 w-4 shrink-0 sm:mr-2" aria-hidden />
              <span>{action.label}</span>
            </Link>
          </Button>
        );
      })}
      {hasMore && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
          className="min-h-11 w-full justify-start rounded-xl border border-dashed border-primary/40 px-2.5 text-[13px] text-primary sm:hidden"
        >
          <ChevronDown className={`mr-1.5 h-4 w-4 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} aria-hidden />
          {expanded ? "Show less" : "More"}
        </Button>
      )}
    </div>
  );
}
