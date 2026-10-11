"use client";

import { schoolInitials } from "@school-kit/types";

import { SchoolKitIcon } from "@/components/brand/schoolkit-mark";
import { useAuth } from "@/lib/auth/use-auth";

import { SchoolLogo } from "./school-logo";

// The school's own name and logo at the head of a signed-in shell
// (docs/modules/school-identity.md, slice 1). SchoolKit stays visible as the
// platform, smaller, through PoweredBySchoolKit below.

export function SchoolInitials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center rounded-md bg-primary font-semibold text-primary-foreground ${className ?? ""}`}
    >
      {schoolInitials(name)}
    </span>
  );
}

export function SchoolBrand({ className }: { className?: string }) {
  const { school } = useAuth();
  if (!school) return null;
  return (
    <span className={`flex min-w-0 items-center gap-2 ${className ?? ""}`}>
      <SchoolLogo
        className="h-7 w-7 shrink-0 rounded object-contain"
        fallback={<SchoolInitials name={school.name} className="h-7 w-7 text-xs" />}
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
