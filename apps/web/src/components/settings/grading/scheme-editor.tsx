"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDown, ArrowUp, Check, Loader2, Plus, Trash2, X } from "lucide-react";
import { useFieldArray, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  findWeightSumError,
  type GradingSchemeDto,
  type ReplaceGradingComponentsInput,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { replaceComponents } from "@/lib/grading/grading-api";
import { cn } from "@/lib/utils";

// FORM-CLASS DISCIPLINE (fix/empty-optional-forms, applied to a numeric grid):
//   (a) A LOCAL schema whose fields are all STRINGS — `weight` is the exact
//       "nullable-number-from-blank-input" combo that broke the class-arm
//       dialog, so it is held as a string and coerced to a number only at
//       submit. The resolver's output type === FormValues, so there is NO
//       `as never` cast.
//   (b) The sum-to-100 issue binds to a REAL path (["components"]) — never a
//       bare object-level refine with empty path:[] that RHF cannot surface.
//       Per-row issues bind to ["components", i, field].
//   (c) A root error block AND a per-cell error render — a failed submit can
//       never silently no-op. The live "total / 100" indicator is client-side
//       UX only; the server re-validates on PUT.

const intString = (fieldLabel: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${fieldLabel} is required.`)
    .refine((v) => /^\d+$/.test(v), `${fieldLabel} must be a whole number.`)
    .refine((v) => Number(v) <= max, `${fieldLabel} must be ${max} or less.`);

const componentRow = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Key is required.")
    .max(40)
    .refine((v) => /^[a-z0-9_-]+$/i.test(v), "Use letters, numbers, - or _ only."),
  label: z.string().trim().min(1, "Label is required.").max(80),
  weight: intString("Weight", 100),
});

const schemeFormSchema = z
  .object({
    components: z.array(componentRow).min(1, "A scheme needs at least one component."),
  })
  .superRefine((value, ctx) => {
    const sumError = findWeightSumError(value.components.map((c) => Number(c.weight)));
    if (sumError) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: sumError, path: ["components"] });
    }
    const seen = new Map<string, number>();
    value.components.forEach((component, index) => {
      const key = component.key.trim().toLowerCase();
      if (seen.has(key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate component key "${component.key}".`,
          path: ["components", index, "key"],
        });
      } else {
        seen.set(key, index);
      }
    });
  });

type FormValues = z.infer<typeof schemeFormSchema>;

function toFormValues(scheme: GradingSchemeDto): FormValues {
  return {
    components: scheme.components.map((c) => ({
      key: c.key,
      label: c.label,
      weight: String(c.weight),
    })),
  };
}

function parseWeight(raw: string): number {
  const v = raw.trim();
  return /^\d+$/.test(v) ? Number(v) : 0;
}

interface Props {
  scheme: GradingSchemeDto;
}

export function SchemeEditor({ scheme }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schemeFormSchema),
    defaultValues: toFormValues(scheme),
    mode: "onSubmit",
  });
  const { fields, append, remove, move } = useFieldArray({
    control: form.control,
    name: "components",
  });

  const watched = form.watch("components");
  const liveTotal = (watched ?? []).reduce((sum, c) => sum + parseWeight(c.weight), 0);
  const totalOk = liveTotal === 100;

  // Best-effort surface of the array-level Zod issue (path ["components"]).
  const componentsError = form.formState.errors.components as
    | { root?: { message?: string }; message?: string }
    | undefined;
  const componentsMessage = componentsError?.root?.message ?? componentsError?.message;

  const onSubmit = form.handleSubmit(async (values) => {
    const payload: ReplaceGradingComponentsInput = {
      components: values.components.map((c, index) => ({
        key: c.key.trim(),
        label: c.label.trim(),
        weight: Number(c.weight),
        orderIndex: index + 1,
      })),
    };

    try {
      const saved = await replaceComponents(payload);
      form.reset(toFormValues(saved));
      toast.success("Grading scheme saved.");
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
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Key</th>
              <th className="px-3 py-2 font-medium">Label</th>
              <th className="px-3 py-2 font-medium">Weight</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {fields.map((field, index) => {
              const rowErrors = form.formState.errors.components?.[index];
              return (
                <tr key={field.id} className="border-t align-top">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 pt-2">
                      <span className="w-4 text-xs text-muted-foreground">{index + 1}</span>
                      <button
                        type="button"
                        aria-label="Move up"
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        disabled={index === fields.length - 1}
                        onClick={() => move(index, index + 1)}
                        className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Component ${index + 1} key`}
                      placeholder="ca1"
                      {...form.register(`components.${index}.key` as const)}
                      aria-invalid={Boolean(rowErrors?.key)}
                    />
                    {rowErrors?.key && (
                      <p className="mt-1 text-xs text-destructive">{rowErrors.key.message}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Component ${index + 1} label`}
                      placeholder="First CA"
                      {...form.register(`components.${index}.label` as const)}
                      aria-invalid={Boolean(rowErrors?.label)}
                    />
                    {rowErrors?.label && (
                      <p className="mt-1 text-xs text-destructive">{rowErrors.label.message}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Input
                      aria-label={`Component ${index + 1} weight`}
                      inputMode="numeric"
                      className="w-24"
                      placeholder="20"
                      {...form.register(`components.${index}.weight` as const)}
                      aria-invalid={Boolean(rowErrors?.weight)}
                    />
                    {rowErrors?.weight && (
                      <p className="mt-1 text-xs text-destructive">{rowErrors.weight.message}</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      aria-label={`Remove component ${index + 1}`}
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

      {componentsMessage && <p className="text-sm text-destructive">{componentsMessage}</p>}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append({ key: "", label: "", weight: "0" })}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add component
          </Button>

          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm font-medium",
              totalOk
                ? "bg-emerald-50 text-emerald-700"
                : "bg-destructive/10 text-destructive",
            )}
            aria-live="polite"
          >
            {totalOk ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}
            Weights total: {liveTotal} / 100
          </span>
        </div>

        <Button type="submit" disabled={!totalOk || form.formState.isSubmitting}>
          {form.formState.isSubmitting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          {form.formState.isSubmitting ? "Saving…" : "Save scheme"}
        </Button>
      </div>
    </form>
  );
}
