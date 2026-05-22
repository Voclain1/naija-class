"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, X } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createTermSchema,
  type CreateTermInput,
  type TermDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createTerm,
  updateTerm,
} from "@/lib/academic-years/academic-years-api";

// Create-OR-edit dialog for terms. Same shape as AcademicYearDialog.
// When `existing` is undefined we POST to the nested route under the year;
// otherwise we PATCH /terms/:id. The year context is required for create.
interface Props {
  open: boolean;
  academicYearId: string;
  /** Pre-suggested next sequence (1/2/3), used only for new terms. */
  suggestedSequence?: number;
  existing?: TermDto;
  onClose: () => void;
  onSaved: (term: TermDto) => void;
}

interface FormValues {
  sequence: number;
  name: string;
  startDate: string;
  endDate: string;
}

function toIsoDate(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

const DEFAULT_NAMES: Record<number, string> = {
  1: "First Term",
  2: "Second Term",
  3: "Third Term",
};

export function TermDialog({
  open,
  academicYearId,
  suggestedSequence,
  existing,
  onClose,
  onSaved,
}: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(createTermSchema) as never,
    defaultValues: { sequence: 1, name: "First Term", startDate: "", endDate: "" },
    mode: "onSubmit",
  });

  useEffect(() => {
    if (!open) return;
    if (existing) {
      form.reset({
        sequence: existing.sequence,
        name: existing.name,
        startDate: toIsoDate(existing.startDate),
        endDate: toIsoDate(existing.endDate),
      });
    } else {
      const seq = suggestedSequence ?? 1;
      form.reset({
        sequence: seq,
        name: DEFAULT_NAMES[seq] ?? "Term",
        startDate: "",
        endDate: "",
      });
    }
  }, [open, existing, suggestedSequence, form]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const input: CreateTermInput = {
        sequence: Number(values.sequence),
        name: values.name,
        startDate: new Date(values.startDate),
        endDate: new Date(values.endDate),
      };
      const saved = existing
        ? await updateTerm(existing.id, input)
        : await createTerm(academicYearId, input);
      toast.success(existing ? "Term updated." : "Term created.");
      onSaved(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "SEQUENCE_TAKEN") {
          form.setError("sequence", {
            type: "manual",
            message: "A term with that sequence already exists in this year.",
          });
        } else if (error.code === "VALIDATION_ERROR") {
          form.setError("endDate", {
            type: "manual",
            message: error.message,
          });
        } else {
          toast.error(error.message);
        }
      } else {
        toast.error("Could not reach the server. Try again.");
      }
    }
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="term-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="term-dialog-title" className="text-lg font-semibold">
              {existing ? "Edit term" : "Add term"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Sequences 1-3 only. Dates must fall inside the academic year.
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <div className="flex gap-2">
            <div className="flex w-24 flex-col gap-1">
              <Label htmlFor="term-sequence">Sequence</Label>
              <Input
                id="term-sequence"
                type="number"
                min={1}
                max={3}
                {...form.register("sequence", { valueAsNumber: true })}
                aria-invalid={Boolean(form.formState.errors.sequence)}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="term-name">Name</Label>
              <Input
                id="term-name"
                placeholder="First Term"
                {...form.register("name")}
                aria-invalid={Boolean(form.formState.errors.name)}
              />
            </div>
          </div>
          {(form.formState.errors.sequence || form.formState.errors.name) && (
            <p className="text-sm text-destructive">
              {form.formState.errors.sequence?.message ?? form.formState.errors.name?.message}
            </p>
          )}

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="term-start">Start date</Label>
              <Input id="term-start" type="date" {...form.register("startDate")} />
              {form.formState.errors.startDate && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.startDate.message}
                </p>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="term-end">End date</Label>
              <Input id="term-end" type="date" {...form.register("endDate")} />
              {form.formState.errors.endDate && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.endDate.message}
                </p>
              )}
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting} className="flex-1">
              {form.formState.isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {form.formState.isSubmitting
                ? "Saving…"
                : existing
                  ? "Save changes"
                  : "Create term"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
