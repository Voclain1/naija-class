"use client";

import Link from "next/link";
import {
  CalendarCheck,
  ClipboardPenLine,
  FileText,
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

export function DashboardActionBar() {
  const { permissions, school } = useAuth();
  const actions = resolveDashboardActions(permissions, school?.modulePreferences?.selected);

  if (actions.length === 0) return null;

  return (
    // Two buttons per row on phones (equal width, comfortable tap height),
    // then a wrapping row from sm up. Never overflows the greeting card.
    <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap sm:items-center sm:gap-2">
      {actions.map((action) => {
        const Icon = ICONS[action.key];
        return (
          <Button
            key={action.key}
            asChild
            size="sm"
            className="h-auto w-full flex-col items-start justify-center gap-1.5 whitespace-normal break-words rounded-2xl px-3 py-2.5 text-left text-[0.8125rem] leading-tight min-[360px]:text-sm sm:h-9 sm:w-auto sm:flex-row sm:items-center sm:gap-0 sm:whitespace-nowrap sm:rounded-md sm:px-3 sm:py-0 sm:text-sm"
            variant={action.emphasis === "primary" ? "default" : "outline"}
          >
            <Link href={action.href}>
              <Icon className="h-5 w-5 shrink-0 sm:mr-2 sm:h-4 sm:w-4" aria-hidden />
              <span>{action.label}</span>
            </Link>
          </Button>
        );
      })}
    </div>
  );
}
