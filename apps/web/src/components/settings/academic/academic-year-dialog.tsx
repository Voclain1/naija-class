"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, X } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createAcademicYearSchema,
  type AcademicYearDto,
  type CreateAcademicYearInput,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createAcademicYear,
  updateAcademicYear,
} from "@/lib/academic-years/academic-years-api";

// Create-OR-edit dialog: when `existing` is undefined we POST, otherwise we
// PATCH. Shape matches InviteAdminDialog (inline overlay, Escape closes,
// backdrop click closes). The same pattern will be reused by Slice 2's
// ClassLevel dialog and Slice 9's Enrollment dialog — keep behaviours
// aligned across phase 1.
//
// Date inputs are HTML5 <input type="date">, which sends "YYYY-MM-DD"
// strings. The Zod schema's z.coerce.date() converts to a Date at validate
// time; the API serializes back to ISO. (See CLAUDE.md "@db.Date" — these
// are calendar dates, no time of day.)
interface Props {
  open: boolean;
  existing?: AcademicYearDto;
  onClose: () => void;
  onSaved: (year: AcademicYearDto) => void;
}

interface FormValues {
  label: string;
  startDate: string;
  endDate: string;
}

function toIsoDate(value: string | Date): string {
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

export function AcademicYearDialog({ open, existing, onClose, onSaved }: Props) {
  const form = useForm<FormValues>({
    // We use the *create* schema even in edit mode — for required fields
    // it gives us the same validation; for PATCH we just forward whatever
    // changed. The cross-field date check in the schema handles invariant
    // checking on edit too.
    resolver: zodResolver(createAcademicYearSchema) as never,
    defaultValues: { label: "", startDate: "", endDate: "" },
    mode: "onSubmit",
  });

  useEffect(() => {
    if (!open) return;
    if (existing) {
      form.reset({
        label: existing.label,
        startDate: toIsoDate(existing.startDate),
        endDate: toIsoDate(existing.endDate),
      });
    } else {
      form.reset({ label: "", startDate: "", endDate: "" });
    }
  }, [open, existing, form]);

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
      const input: CreateAcademicYearInput = {
        label: values.label,
        startDate: new Date(values.startDate),
        endDate: new Date(values.endDate),
      };
      const saved = existing
        ? await updateAcademicYear(existing.id, input)
        : await createAcademicYear(input);
      toast.success(existing ? "Academic year updated." : "Academic year created.");
      onSaved(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "LABEL_TAKEN") {
          form.setError("label", {
            type: "manual",
            message: "This label is already in use for this school.",
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
      aria-labelledby="ay-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="ay-dialog-title" className="text-lg font-semibold">
              {existing ? "Edit academic year" : "Add academic year"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Examples: <span className="font-mono">2025/2026</span>,{" "}
              <span className="font-mono">2025-26</span>.
            </p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ay-label">Label</Label>
            <Input
              id="ay-label"
              autoFocus
              placeholder="2025/2026"
              {...form.register("label")}
              aria-invalid={Boolean(form.formState.errors.label)}
            />
            {form.formState.errors.label && (
              <p className="text-sm text-destructive">
                {form.formState.errors.label.message}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="ay-start">Start date</Label>
              <Input id="ay-start" type="date" {...form.register("startDate")} />
              {form.formState.errors.startDate && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.startDate.message}
                </p>
              )}
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="ay-end">End date</Label>
              <Input id="ay-end" type="date" {...form.register("endDate")} />
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
                  : "Create year"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
