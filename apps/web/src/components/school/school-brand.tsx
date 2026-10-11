"use client";

import { SchoolKitIcon } from "@/components/brand/schoolkit-mark";
import { useAuth } from "@/lib/auth/use-auth";

import { SchoolLogo } from "./school-logo";

// The school's own name and logo at the head of a signed-in shell
// (docs/modules/school-identity.md, slice 1). SchoolKit stays visible as the
// platform, smaller, through PoweredBySchoolKit below. A school that has not
// uploaded a logo yet shows SchoolKit's icon beside its name (owner's call,
// 2026-10-11), and its owner and admins are reminded to add one
// (LogoReminder on the dashboard).

export function SchoolBrand({ className }: { className?: string }) {
  const { school } = useAuth();
  if (!school) return null;
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className ?? ""}`}>
      <SchoolLogo
        className="h-7 w-7 shrink-0 rounded object-contain"
        fallback={<SchoolKitIcon size={28} className="shrink-0" />}
      />
      <span className="truncate text-sm font-semibold tracking-tight text-foreground">{school.name}</span>
    </span>
  );
}

export function PoweredBySchoolKit() {
  return (
    <a
      href="https://schoolkit.ng"
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 border-t border-border px-5 py-3 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <SchoolKitIcon size={14} />
      <span>Powered by SchoolKit</span>
    </a>
  );
}
