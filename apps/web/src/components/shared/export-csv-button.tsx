"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, type ButtonProps } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";

interface Props extends Pick<ButtonProps, "variant" | "size" | "className"> {
  label?: string;
  disabled?: boolean;
  // May be async (e.g. paginated pages loop the existing list endpoint to
  // pull every page before generating the file) or sync (pages that already
  // hold the full dataset in state).
  onExport: () => void | Promise<void>;
}

// Shared "Export CSV" affordance for the Students, Staff, Gradebook,
// Invoices, Debtors, and Expenses pages. Each caller supplies its own
// `onExport` that builds rows from data already fetched through that page's
// existing, permission-guarded API call(s) — this component only owns the
// loading/error UX, never the data access.
export function ExportCsvButton({ label = "Export CSV", disabled, onExport, variant = "outline", size = "sm", className }: Props) {
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setLoading(true);
    try {
      await onExport();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "Could not export CSV — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button type="button" variant={variant} size={size} className={className} disabled={disabled || loading} onClick={() => void handleClick()}>
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {loading ? "Exporting…" : label}
    </Button>
  );
}
