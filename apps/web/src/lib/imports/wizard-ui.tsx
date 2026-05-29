"use client";

import { Loader2 } from "lucide-react";
import { type ReactNode } from "react";

// Shared wizard chrome — extracted slice 8 cp2 from the slice 6/7 student
// wizard. Slice 6 cp4 kept these components inline because there was only
// one wizard; slice 8 adds a second (guardian) wizard, slice 10 will add
// a third (teacher), so the right time to extract is now.
//
// All five components are pure / presentational — no router, no fetch.
// Pages own the data and pass it down. Components stay small enough that
// future wizard variants can compose them or fork specific cells without
// reworking the whole shell.
//
// Naming: the components hang off a Wizard.* namespace via re-export so
// pages can write `<Wizard.Header step={2} title="..." />`. Internal
// names are unprefixed so pages that import individual components also
// read cleanly.

// =========================================================================
// Wizard.Header — step counter + title
// =========================================================================

export interface WizardHeaderProps {
  step: number;
  totalSteps?: number; // defaults to 4 — the post-slice-8 wizard length
  title: string;
}

export function WizardHeader({ step, totalSteps = 4, title }: WizardHeaderProps) {
  return (
    <header className="flex flex-col gap-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Step {step} of {totalSteps}
      </p>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
    </header>
  );
}

// =========================================================================
// Wizard.SummaryCard — coloured summary tile on the preview screen.
//
// Two tones (success / warning) match the slice 6 design. `action` is an
// optional CTA rendered at the bottom-right of the card (used for the
// "Download bad rows" button on the bad-side card).
// =========================================================================

export interface WizardSummaryCardProps {
  tone: "success" | "warning";
  icon: ReactNode;
  title: string;
  subtitle: string;
  action?: ReactNode;
}

export function WizardSummaryCard({
  tone,
  icon,
  title,
  subtitle,
  action,
}: WizardSummaryCardProps) {
  const toneStyles =
    tone === "success"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900"
      : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div className={`flex flex-col gap-3 rounded-md border p-4 ${toneStyles}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5">{icon}</span>
        <div className="flex flex-1 flex-col gap-0.5">
          <p className="text-sm font-semibold">{title}</p>
          <p className="text-xs">{subtitle}</p>
        </div>
      </div>
      {action && <div className="flex justify-end">{action}</div>}
    </div>
  );
}

// =========================================================================
// Wizard.EmptyPanel — dashed-border empty state.
//
// Used on the preview screen when a panel has zero rows ("No rows passed
// validation." / "No rows need fixing.").
// =========================================================================

export function WizardEmptyPanel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

// =========================================================================
// Wizard.BadRowsTable — first-50 bad rows + per-row error messages.
//
// Shared shape across both wizards: every bad row has rowNumber + an
// `errors: { field, message }[]` array. The `field` value comes back as
// the canonical TS field name (e.g. "lastName") — render verbatim;
// admins fixing the CSV in Excel match it against the column header
// they themselves provided.
// =========================================================================

export interface WizardBadRow {
  rowNumber: number;
  errors: { field: string; message: string }[];
}

export function WizardBadRowsTable({ rows }: { rows: WizardBadRow[] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-left text-xs uppercase text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">Row</th>
            <th className="px-3 py-2 font-medium">What needs fixing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rowNumber} className="border-t align-top">
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {r.rowNumber}
              </td>
              <td className="px-3 py-2">
                <ul className="flex flex-col gap-1 text-sm">
                  {r.errors.map((err, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs text-muted-foreground">
                        {err.field}
                      </span>
                      : {err.message}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// =========================================================================
// Wizard.PollingSkeleton — centred spinner + label + elapsed timer.
//
// Used by the preview page during VALIDATING and the done page during
// COMMITTING. Caller owns the elapsed counter (a useEffect/setInterval
// pattern that resets when the polled status changes); this component
// just renders the seconds it's passed.
// =========================================================================

export interface WizardPollingSkeletonProps {
  label: string;
  elapsedSeconds: number;
}

export function WizardPollingSkeleton({
  label,
  elapsedSeconds,
}: WizardPollingSkeletonProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border bg-muted/20 p-12 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">
        Elapsed: {formatElapsed(elapsedSeconds)}
      </p>
    </div>
  );
}

// Shared elapsed-time formatter — pages don't need to roll their own.
export function formatElapsed(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${s}s`;
}

// =========================================================================
// Namespace re-export so call sites can write `<Wizard.Header ... />`.
// Each component is also a direct named export above so flat-import
// callers don't pay a namespace tax.
// =========================================================================

export const Wizard = {
  Header: WizardHeader,
  SummaryCard: WizardSummaryCard,
  EmptyPanel: WizardEmptyPanel,
  BadRowsTable: WizardBadRowsTable,
  PollingSkeleton: WizardPollingSkeleton,
};
