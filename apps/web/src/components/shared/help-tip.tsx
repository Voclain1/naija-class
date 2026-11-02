"use client";

import { CircleHelp } from "lucide-react";
import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// A "?" beside a page title that opens the page's tips in a small window
// (2026-10-30). Pages keep one line of what to do; the how-to and the
// what-if live here, one tap away. A window rather than a hover tooltip so it
// works the same on a phone.

export function HelpTip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Help: ${title}`}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CircleHelp className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-sm text-muted-foreground">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
