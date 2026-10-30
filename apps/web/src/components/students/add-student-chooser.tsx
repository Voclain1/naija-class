"use client";

import { Camera, ChevronRight, FileUp, Rows3, UserPlus } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Add student: one button, every way to add (owner's ask, 2026-10-30). The
// button used to open the one-at-a-time form, with the other ways behind a
// small caret most people never opened. Now the choice comes first, one line
// each, and the page that follows does the explaining.

interface AddMethod {
  href: string;
  title: string;
  line: string;
  icon: ComponentType<{ className?: string }>;
  beta?: boolean;
}

export const ADD_STUDENT_METHODS: AddMethod[] = [
  { href: "/students/new", title: "One student", line: "Fill in a short form.", icon: UserPlus },
  {
    href: "/students/new/bulk",
    title: "Several in a grid",
    line: "Type or paste a row per student.",
    icon: Rows3,
  },
  {
    href: "/students/import",
    title: "Import a spreadsheet",
    line: "Upload a CSV of your whole roster.",
    icon: FileUp,
  },
  {
    href: "/students/scan",
    title: "Scan a register",
    line: "Photograph a class list page.",
    icon: Camera,
    beta: true,
  },
];

export function AddStudentChooser({ size = "sm" }: { size?: "sm" | "default" }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size={size}>
          <UserPlus className="h-4 w-4" />
          Add students
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add students</DialogTitle>
          <DialogDescription>How would you like to add them?</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-2">
          {ADD_STUDENT_METHODS.map((m) => (
            <li key={m.href}>
              <Link
                href={m.href}
                className="flex items-center gap-3 rounded-lg border bg-card px-3 py-3 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <m.icon className="h-4 w-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    {m.title}
                    {m.beta && <Badge variant="warning">Beta</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">{m.line}</span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
