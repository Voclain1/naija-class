"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

import { useAssistant } from "../assistant-provider";

// Shared pieces for the assistant’s task cards. Tints, never accent borders
// (CLAUDE.md design rule); every state is said in words as well.

export const control = "w-full rounded-lg border border-input bg-background px-3 py-2 text-base sm:text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export function CardShell({ title, status, children, tone = "default" }: { title: string; status?: string; children: ReactNode; tone?: "default" | "done" | "warning" }) {
  return (
    <section
      aria-label={title}
      className={cn(
        "rounded-xl border border-border p-3 text-sm shadow-sm sm:p-4",
        tone === "done" ? "bg-primary/5" : tone === "warning" ? "bg-secondary/15" : "bg-background",
      )}
    >
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="font-semibold">{title}</h3>
        {status && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{status}</span>}
      </header>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "warning" | "error" | "success"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={cn(
        "rounded-lg px-3 py-2 text-sm",
        tone === "error" ? "bg-destructive/10 text-destructive" : tone === "warning" ? "bg-secondary/20" : tone === "success" ? "bg-primary/10" : "bg-muted",
      )}
    >
      {children}
    </p>
  );
}

/** The single explicit approval control: a checkbox plus a separate button. */
export function ApproveControl({ id, checked, onChecked, statement, button, onApprove, disabled, busy }: {
  id: string; checked: boolean; onChecked: (v: boolean) => void; statement: string; button: string; onApprove: () => void; disabled?: boolean; busy?: boolean;
}) {
  return (
    <div className="space-y-2 rounded-lg bg-muted/60 p-3">
      <label htmlFor={id} className="flex items-start gap-2 text-sm">
        <input id={id} type="checkbox" className="mt-0.5 h-4 w-4" checked={checked} onChange={(e) => onChecked(e.target.checked)} disabled={disabled || busy} />
        <span>{statement}</span>
      </label>
      <button
        type="button"
        onClick={onApprove}
        disabled={!checked || disabled || busy}
        className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-50"
      >
        {busy ? "Working…" : button}
      </button>
    </div>
  );
}

/**
 * Phases in which an operation is in flight or its outcome is open: a model
 * plan never resets these, and the store refuses to re-plan them.
 */
export const IN_FLIGHT_PHASES: ReadonlySet<string> = new Set(["approving", "confirming", "checking", "recovering", "unknown", "acting"]);

/**
 * The person's approval of a task's preview, through the store's gate
 * (docs/modules/assistant-workspace.md, "Model orchestration"): refused while a
 * model plan for the task is not yet applied (the preview on screen is out of
 * date), and locked from the click until the request settles.
 */
export function useApprovalGate(taskId: string) {
  const { store } = useAssistant();
  return {
    canApprove: store.canApprove(taskId),
    pending: store.planPending(taskId),
    approve: (run: () => Promise<unknown> | void) => { void store.approve(taskId, run); },
  };
}

export function PlanChangedNotice() {
  return <Notice tone="warning">The assistant changed this task. This preview is out of date: check the updated details and ask for a fresh preview.</Notice>;
}
