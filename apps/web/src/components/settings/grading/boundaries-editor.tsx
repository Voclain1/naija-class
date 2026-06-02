"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  findBoundaryTilingError,
  type GradeBoundaryDto,
  type ReplaceGradeBoundariesInput,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { replaceBoundaries } from "@/lib/grading/grading-api";
import { cn } from "@/lib/utils";

// FORM-CLASS DISCIPLINE (fix/empty-optional-forms, numeric grid): minScore and
// maxScore are held as STRINGS in FormValues (the "nullable-number-from-blank-
// input" combo) and coerced only at submit. The tiling issue binds to a
// per-row path (["boundaries", i, "maxScore"]); the resolver output type ===
// FormValues so there is no `as never`. The live "tile 0–100" indicator is
// client-side UX only — the server re-validates on PUT.

const intString = (fieldLabel: string) =>
  z
    .string()
    .trim()
    .min(1, `${fieldLabel} is required.`)
    .refine((v) => /^\d+$/.test(v), `${fieldLabel} must be a whole number.`)
    .refine((v) => Number(v) <= 100, `${fieldLabel} must be 100 or less.`);

const boundaryRow = z.object({
  letter: z.string().trim().min(1, "Grade is required.").max(8),
  minScore: intString("Minimum"),
  maxScore: intString("Maximum"),
  remark: z.string().trim().max(80),
});

const boundariesFormSchema = z
  .object({
    boundaries: z.array(boundaryRow).min(1, "A scale needs at least one band."),
  })
  .superRefine((value, ctx) => {
    value.boundaries.forEach((band, index) => {
      if (/^\d+$/.test(band.minScore) && /^\d+$/.test(band.maxScore)) {
        if (Number(band.minScore) > Number(band.maxScore)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Minimum cannot exceed maximum.",
            path: ["boundaries", index, "maxScore"],
          });
        }
      }
    });

    const tilingError = findBoundaryTilingError(
      value.boundaries.map((b) => ({ minScore: Number(b.minScore), maxScore: Number(b.maxScore) })),
    );
    if (tilingError) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: tilingError,
        path: ["boundaries", value.boundaries.length - 1, "maxScore"],
      });
    }

    const seen = new Map<string, number>();
    value.boundaries.forEach((band, index) => {
      const letter = band.letter.trim().toUpperCase();
      if (seen.has(letter)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate grade "${band.letter}".`,
          path: ["boundaries", index, "letter"],
        });
      } else {
        seen.set(letter, index);
      }
    });
  });

type FormValues = z.infer<typeof boundariesFormSchema>;

function toFormValues(bands: GradeBoundaryDto[]): FormValues {
  return {
    boundaries: bands.map((b) => ({
      letter: b.letter,
      minScore: String(b.minScore),
      maxScore: String(b.maxScore),
      remark: b.remark ?? "",
    })),
  };
}

interface Props {
  boundaries: GradeBoundaryDto[];
}

export function BoundariesEditor({ boundaries }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(boundariesFormSchema),
    defaultValues: toFormValues(boundaries),
    mode: "onSubmit",
  });
  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "boundaries",
  });

  const watched = form.watch("boundaries") ?? [];
  const allNumeric =
    watched.length > 0 &&
    watched.every((b) => /^\d+$/.test(b.minScore.trim()) && /^\d+$/.test(b.maxScore.trim()));
  const tilingError = allNumeric
    ? findBoundaryTilingError(
        watched.map((b) => ({ minScore: Number(b.minScore), maxScore: Number(b.maxScore) })),
      )
    : "Fill in every score range.";
  const tilingOk = tilingError === null;

  const onSubmit = form.handleSubmit(async (values) => {
    const payload: ReplaceGradeBoundariesInput = {
      boundaries: values.boundaries.map((b, index) => ({
        letter: b.letter.trim(),
        minScore: Number(b.minScore),
        maxScore: Number(b.maxScore),
        remark: b.remark.trim() === "" ? undefined : b.remark.trim(),
        orderIndex: index + 1,
      })),
    };

    try {
      const saved = await replaceBoundaries(payload);
      form.reset(toFormValues(saved));
      toast.success("Grade boundaries saved.");
    } catch (error) {
      if (error instanceof ApiError) {
        const issues = (error.details as { issues?: { message?: string }[] } | undefined)?.issues;
        form.setError("root", {
          type: "server",
          message:
            issues && issues.length > 0
              ? issues.map((i) => i.message).filter(Boolean).join(" ")
              : error.message,
        });
      } else {
        form.setError("root", {
          type: "server",
          message: "Could not reach the server. Try again.",
        });
      }
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {form.formState.errors.root && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {form.formState.errors.root.message}
        </div>
      )}

      <div className="overflow-hidden rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Grade</th>
              <th className="px-3 py-2 font-medium">Min</th>
              <th className="px-3 py-2 font-medium">Max</th>
              <th className="px-3 py-2 font-medium">Remark</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => {
              const rowErrors = form.formState.errors.boundaries?.[index];
              return (
                <tr key={field.id} className="border-t align-top">
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Band ${index + 1} grade`}
                      className="w-20"
                      placeholder="A1"
                      {...form.register(`boundaries.${index}.letter` as const)}
                      aria-invalid={Boolean(rowErrors?.letter)}
                    />
                    {rowErrors?.letter && (
                      <p className="mt-1 text-xs text-destructive">{rowErrors.letter.message}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Band ${index + 1} minimum`}
                      inputMode="numeric"
                      className="w-20"
                      placeholder="75"
                      {...form.register(`boundaries.${index}.minScore` as const)}
                      aria-invalid={Boolean(rowErrors?.minScore)}
                    />
                    {rowErrors?.minScore && (
                      <p className="mt-1 text-xs text-destructive">{rowErrors.minScore.message}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Band ${index + 1} maximum`}
                      inputMode="numeric"
                      className="w-20"
                      placeholder="100"
                      {...form.register(`boundaries.${index}.maxScore` as const)}
                      aria-invalid={Boolean(rowErrors?.maxScore)}
                    />
                    {rowErrors?.maxScore && (
                      <p className="mt-1 text-xs text-destructive">{rowErrors.maxScore.message}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Band ${index + 1} remark`}
                      placeholder="Excellent"
                      {...form.register(`boundaries.${index}.remark` as const)}
                      aria-invalid={Boolean(rowErrors?.remark)}
                    />
                    {rowErrors?.remark && (
                      <p className="mt-1 text-xs text-destructive">{rowErrors.remark.message}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      aria-label={`Remove band ${index + 1}`}
                      disabled={fields.length === 1}
                      onClick={() => remove(index)}
                      className="rounded p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ letter: "", minScore: "", maxScore: "", remark: "" })}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add band
          </Button>

          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium",
              tilingOk ? "bg-emerald-50 text-emerald-700" : "bg-destructive/10 text-destructive",
            )}
            aria-live="polite"
          >
            {tilingOk ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            {tilingOk ? "Ranges tile 0–100" : `Ranges don't tile 0–100${tilingError ? ` — ${tilingError}` : ""}`}
          </span>
        </div>

        <Button type="submit" disabled={!tilingOk || form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {form.formState.isSubmitting ? "Saving…" : "Save boundaries"}
        </Button>
      </div>
    </form>
  );
}
