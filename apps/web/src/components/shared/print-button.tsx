"use client";

import { Printer } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";

interface Props extends Pick<ButtonProps, "variant" | "size" | "className"> {
  label?: string;
  disabled?: boolean;
}

// Triggers the browser's native print dialog — no backend PDF generation.
// Chrome (nav/topbar, page-level buttons, filters, pagination) is hidden via
// `print:hidden` at the layout level and per-page; the data table underneath
// prints as-is. Pairs with ExportCsvButton: Export gets the working data,
// Print gets a presentable view of what's currently on screen.
export function PrintButton({ label = "Print", disabled, variant = "outline", size = "sm", className }: Props) {
  return (
    <Button type="button" variant={variant} size={size} className={className} disabled={disabled} onClick={() => window.print()}>
      <Printer className="h-4 w-4" />
      {label}
    </Button>
  );
}
