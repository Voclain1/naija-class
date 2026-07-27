"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createAcademicYearSchema,
  type AcademicYearDto,
  type CreateAcademicYearInput,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createAcademicYear,
  updateAcademicYear,
} from "@/lib/academic-years/academic-years-api";

// Create-OR-edit dialog: when `existing` is undefined we POST, otherwise we
// PATCH. Migrated onto the shared Dialog primitive (Phase 3 restyle) — was
// an inline overlay predating it, same family as the Students/Staff BVN
// modals migrated in Phase 2. ClassArm/ClassLevel/Subject/Term dialogs share
// this exact shape and move onto Dialog in the same pass.
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
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit academic year" : "Add academic year"}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Examples: <span className="font-mono">2025/2026</span>,{" "}
            <span className="font-mono">2025-26</span>.
          </p>
        </DialogHeader>

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
      </DialogContent>
    </Dialog>
  );
}
