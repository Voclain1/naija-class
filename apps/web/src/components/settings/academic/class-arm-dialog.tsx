"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, X } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  type ClassArmDto,
  type ClassLevelDto,
  type CreateClassArmInput,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createClassArm,
  updateClassArm,
} from "@/lib/class-arms/class-arms-api";

interface Props {
  open: boolean;
  /** Available levels for the level select. Required even when editing
   *  (just for the disabled-display value). */
  levels: ClassLevelDto[];
  /** Pre-selected level for create. Ignored when `existing` is set. */
  defaultLevelId?: string;
  existing?: ClassArmDto;
  onClose: () => void;
  onSaved: (arm: ClassArmDto) => void;
}

interface FormValues {
  classLevelId: string;
  name: string;
  code: string;
  capacity: number | "";
  isActive: boolean;
}

// Form-specific schema. createClassArmSchema is the API BODY (validated
// server-side via the strict() guard); the form additionally tracks
// classLevelId for the nested URL and accepts capacity as "" from a
// blank <input type="number">. onSubmit below coerces "" → null before
// constructing the CreateClassArmInput body.
const classArmFormSchema = z.object({
  classLevelId: z.string().uuid(),
  name: z.string().trim().min(1).max(40),
  code: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(
      /^[a-z0-9-]+$/,
      "Code must be lowercase letters, digits, and hyphens only",
    ),
  capacity: z
    .union([z.literal(""), z.coerce.number().int().min(0).max(10_000)])
    .optional(),
  isActive: z.boolean().optional(),
});

// Class-teacher dropdown is intentionally NOT populated in cp3 — there is
// no /users?role=teacher endpoint yet, and signup seeds only the owner.
// The empty state below tells the admin to invite a teacher first; the
// link goes to /settings/users (the existing Phase 0 invitation flow) —
// teachers are Users, so the route is real. Slice 10/13 will replace the
// stub with a populated <select>.
export function ClassArmDialog({
  open,
  levels,
  defaultLevelId,
  existing,
  onClose,
  onSaved,
}: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(classArmFormSchema) as never,
    defaultValues: {
      classLevelId: defaultLevelId ?? levels[0]?.id ?? "",
      name: "",
      code: "",
      capacity: "",
      isActive: true,
    },
    mode: "onSubmit",
  });

  useEffect(() => {
    if (!open) return;
    if (existing) {
      form.reset({
        classLevelId: existing.classLevelId,
        name: existing.name,
        code: existing.code,
        capacity: existing.capacity ?? "",
        isActive: existing.isActive,
      });
    } else {
      form.reset({
        classLevelId: defaultLevelId ?? levels[0]?.id ?? "",
        name: "",
        code: "",
        capacity: "",
        isActive: true,
      });
    }
  }, [open, existing, defaultLevelId, levels, form]);

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
    const capacity =
      values.capacity === "" ? null : Number(values.capacity);
    try {
      const input: CreateClassArmInput = {
        name: values.name,
        code: values.code,
        capacity,
        isActive: values.isActive,
      };
      const saved = existing
        ? await updateClassArm(existing.id, input)
        : await createClassArm(values.classLevelId, input);
      toast.success(existing ? "Class arm updated." : "Class arm created.");
      onSaved(saved);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "CODE_TAKEN") {
          form.setError("code", {
            type: "manual",
            message: "This code is already in use for this class level.",
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
      aria-labelledby="arm-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-lg border bg-card p-6 shadow-lg">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 id="arm-dialog-title" className="text-lg font-semibold">
              {existing ? "Edit class arm" : "Add class arm"}
            </h2>
            <p className="text-sm text-muted-foreground">
              An arm is a specific class (e.g. JSS 1A). Multiple arms can sit
              under one level.
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
            <Label htmlFor="arm-level">Class level</Label>
            <select
              id="arm-level"
              className="h-9 rounded-md border bg-background px-2 text-sm disabled:opacity-50"
              disabled={Boolean(existing)}
              {...form.register("classLevelId")}
            >
              {levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {existing && (
              <p className="text-xs text-muted-foreground">
                Moving an arm between levels isn&apos;t supported. Create a new
                arm under the target level instead.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="arm-name">Name</Label>
            <Input
              id="arm-name"
              autoFocus
              placeholder="JSS 1A"
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
            <Label htmlFor="arm-code">Code</Label>
            <Input
              id="arm-code"
              placeholder="jss1-a"
              {...form.register("code")}
              aria-invalid={Boolean(form.formState.errors.code)}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits, and hyphens. Unique within this level.
            </p>
            {form.formState.errors.code && (
              <p className="text-sm text-destructive">
                {form.formState.errors.code.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="arm-capacity">Capacity (optional)</Label>
            <Input
              id="arm-capacity"
              type="number"
              min={0}
              max={10000}
              placeholder="40"
              {...form.register("capacity")}
            />
            <p className="text-xs text-muted-foreground">
              Leave blank if you don&apos;t track a hard cap.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            <Label>Class teacher</Label>
            <div className="rounded-md border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
              <p>No teachers have been invited yet.</p>
              <Link
                href="/settings/users"
                className="mt-1 inline-block text-foreground underline"
                onClick={onClose}
              >
                Invite a teacher →
              </Link>
            </div>
          </div>

          {existing && (
            <div className="flex items-center gap-2">
              <input
                id="arm-active"
                type="checkbox"
                className="h-4 w-4"
                {...form.register("isActive")}
              />
              <Label htmlFor="arm-active" className="text-sm font-normal">
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
                  : "Create arm"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
