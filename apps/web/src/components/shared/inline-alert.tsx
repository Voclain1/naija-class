import { AlertCircle } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

export interface InlineAlertAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

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
}: {
  title?: string;
  children: ReactNode;
  action?: InlineAlertAction;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex items-start gap-3 rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive${className ? ` ${className}` : ""}`}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
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
