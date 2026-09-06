import { AlertCircle, AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export interface InlineAlertAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * Severity. `destructive` is the original and remains the default, so every
 * existing caller is unchanged.
 *
 * `warning` was added for a status that is IMPORTANT but not an error: a lesson
 * plan that is not grounded in the school's own curriculum is a perfectly
 * usable plan the teacher must simply be aware of. Rendering that in the red
 * used for "could not load dashboard" would teach teachers to discount the
 * colour, which costs more than it gains — the point of a shared alert shape is
 * that its severity means something.
 */
export type InlineAlertTone = "destructive" | "warning";

const TONE_CLASSES: Record<InlineAlertTone, string> = {
  destructive: "border-destructive/40 bg-destructive/5 text-destructive",
  // Amber reads as "look at this" in both themes without reading as breakage.
  warning: "border-amber-500/50 bg-amber-500/10 text-amber-900 dark:text-amber-200",
};

/**
 * A concise, in-flow status message for a page or form.
 *
 * This intentionally handles only the repeated banner shape: a clear status,
 * optional short heading, and one recovery action. It is not a toast, dialog,
 * or general-purpose callout API.
 */
export function InlineAlert({
  title,
  children,
  action,
  className,
  tone = "destructive",
}: {
  title?: string;
  children: ReactNode;
  action?: InlineAlertAction;
  className?: string;
  tone?: InlineAlertTone;
}) {
  // Tone drives the classes rather than being appended by the caller: Tailwind
  // resolves conflicts by stylesheet order, not by position in the class
  // string, so a caller passing `border-amber-500` through `className` would
  // win or lose unpredictably against the base `border-destructive`.
  const Icon = tone === "warning" ? AlertTriangle : AlertCircle;
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-md border p-4 text-sm ${TONE_CLASSES[tone]}${className ? ` ${className}` : ""}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        <div className={title ? "mt-1" : undefined}>{children}</div>
      </div>
      {action && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
