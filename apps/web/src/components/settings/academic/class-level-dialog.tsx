"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, X } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createClassLevelSchema,
  type ClassLevelDto,
  type ClassStageDto,
  type CreateClassLevelInput,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createClassLevel,
  updateClassLevel,
} from "@/lib/class-levels/class-levels-api";

interface Props {
  open: boolean;
  existing?: ClassLevelDto;
  onClose: () => void;
  onSaved: (level: ClassLevelDto) => void;
}

interface FormValues {
  name: string;
  code: string;
  stage: ClassStageDto;
  orderIndex: number;
  isActive: boolean;
}

const STAGES: { value: ClassStageDto; label: string }[] = [
  { value: "NURSERY", label: "Nursery / Pre-Primary" },
  { value: "PRIMARY", label: "Primary" },
  { value: "JSS", label: "Junior Secondary (JSS)" },
  { value: "SSS", label: "Senior Secondary (SSS)" },
];

export function ClassLevelDialog({ open, existing, onClose, onSaved }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(createClassLevelSchema) as never,
    defaultValues: {
      name: "",
      code: "",
      stage: "NURSERY",
      orderIndex: 0,
      isActive: true,
    },
    mode: "onSubmit",
  });

  useEffect(() => {
    if (!open) return;
    if (existing) {
      form.reset({
        name: existing.name,
        code: existing.code,
        stage: existing.stage,
        orderIndex: existing.orderIndex,
        isActive: existing.isActive,
      });
    } else {
      form.reset({
        name: "",
        code: "",
        stage: "NURSERY",
        orderIndex: 0,
        isActive: true,
      });
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
      const input: CreateClassLevelInput = {
        name: values.name,
        code: values.code,
        stage: values.stage,
        orderIndex: Number(values.orderIndex),
        isActive: values.isActive,
      };
      const saved = existing
        ? await updateClassLevel(existing.id, input)
        : await createClassLevel(input);
      toast.success(existing ? "Class level updated." : "Class level created.");
      onSaved(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "CODE_TAKEN") {
          form.setError("code", {
            type: "manual",
            message: "This code is already in use for this school.",
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
      aria-labelledby="cl-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="cl-dialog-title" className="text-lg font-semibold">
              {existing ? "Edit class level" : "Add class level"}
            </h2>
            <p className="text-sm text-muted-foreground">
              Levels group your classes (e.g. JSS 1, Primary 4).
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor="cl-name">Name</Label>
            <Input
              id="cl-name"
              autoFocus
              placeholder="Primary 4"
              {...form.register("name")}
              aria-invalid={Boolean(form.formState.errors.name)}
            />
            {form.formState.errors.name && (
              <p className="text-sm text-destructive">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="cl-code">Code</Label>
            <Input
              id="cl-code"
              placeholder="pri4"
              {...form.register("code")}
              aria-invalid={Boolean(form.formState.errors.code)}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits, and hyphens. Stays the same even if
              you rename the level.
            </p>
            {form.formState.errors.code && (
              <p className="text-sm text-destructive">
                {form.formState.errors.code.message}
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="cl-stage">Stage</Label>
              <select
                id="cl-stage"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                {...form.register("stage")}
              >
                {STAGES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <Label htmlFor="cl-order">Order</Label>
              <Input
                id="cl-order"
                type="number"
                min={0}
                max={999}
                {...form.register("orderIndex", { valueAsNumber: true })}
              />
              {form.formState.errors.orderIndex && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.orderIndex.message}
                </p>
              )}
            </div>
          </div>

          {existing && (
            <div className="flex items-center gap-2">
              <input
                id="cl-active"
                type="checkbox"
                className="h-4 w-4"
                {...form.register("isActive")}
              />
              <Label htmlFor="cl-active" className="text-sm font-normal">
                Active (visible to teachers and admins)
              </Label>
            </div>
          )}

          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={form.formState.isSubmitting}
              className="flex-1"
            >
              {form.formState.isSubmitting && (
                <Loader2 className="h-4 w-4 animate-spin" />
              )}
              {form.formState.isSubmitting
                ? "Saving…"
                : existing
                  ? "Save changes"
                  : "Create level"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
