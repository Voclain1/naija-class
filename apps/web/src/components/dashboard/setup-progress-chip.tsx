"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { useAuth } from "@/lib/auth/use-auth";
import { setupProgress } from "@/lib/setup-state/setup-progress";
import type { useSetupState } from "@/lib/setup-state/use-setup-state";

// "School setup · 75% done", on the same line as the dashboard greeting
// (owner's request, 2026-10-11). Owner and admin only — useSetupState makes no
// request for anyone else — and gone at 100%, so it is not permanent furniture.
// The whole chip links to the next thing to do; its name says what that is.

const SIZE = 36;
const STROKE = 4;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function SetupProgressChip({ setup }: { setup: ReturnType<typeof useSetupState> }) {
  const { school } = useAuth();
  const { setupState } = setup;
  if (!school || !setupState) return null;

  const { percent, next } = setupProgress(setupState.steps, school);
  if (percent >= 100 || !next) return null;

  return (
    <Link
      href={next.href}
      aria-label={`School setup ${percent}% done. Next: ${next.label}`}
      className="group inline-flex items-center gap-3 rounded-full bg-card py-1.5 pl-1.5 pr-3 shadow-sm ring-1 ring-border transition hover:ring-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" className="shrink-0 -rotate-90">
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" strokeWidth={STROKE} className="stroke-muted" />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
          className="stroke-primary transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <span className="flex flex-col leading-tight">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">School setup</span>
        <span className="text-sm font-semibold text-foreground">
          <span className="font-serif text-base tabular-nums">{percent}%</span> done
        </span>
      </span>
      <span className="hidden max-w-[14rem] truncate border-l border-border pl-3 text-xs text-muted-foreground sm:inline">
        Next: {next.label}
      </span>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
