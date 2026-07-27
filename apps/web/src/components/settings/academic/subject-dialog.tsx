"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createSubjectSchema,
  type CreateSubjectInput,
  type SubjectCategoryDto,
  type SubjectDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { createSubject, updateSubject } from "@/lib/subjects/subjects-api";

interface Props {
  open: boolean;
  existing?: SubjectDto;
  onClose: () => void;
  onSaved: (subject: SubjectDto) => void;
}

interface FormValues {
  name: string;
  code: string;
  category: SubjectCategoryDto;
  isActive: boolean;
}

const CATEGORIES: { value: SubjectCategoryDto; label: string }[] = [
  { value: "CORE", label: "Core" },
  { value: "ELECTIVE", label: "Elective" },
  { value: "VOCATIONAL", label: "Vocational" },
];

export function SubjectDialog({ open, existing, onClose, onSaved }: Props) {
  const form = useForm<FormValues>({
    resolver: zodResolver(createSubjectSchema) as never,
    defaultValues: {
      name: "",
      code: "",
      category: "CORE",
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
        category: existing.category,
        isActive: existing.isActive,
      });
    } else {
      form.reset({ name: "", code: "", category: "CORE", isActive: true });
    }
  }, [open, existing, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const input: CreateSubjectInput = {
        name: values.name,
        code: values.code,
        category: values.category,
        isActive: values.isActive,
      };
      const saved = existing
        ? await updateSubject(existing.id, input)
        : await createSubject(input);
      toast.success(existing ? "Subject updated." : "Subject created.");
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
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? "Edit subject" : "Add subject"}</DialogTitle>
          <p className="text-sm text-muted-foreground">
            School-wide catalogue. Link to class levels via the matrix.
          </p>
        </DialogHeader>

        <form onSubmit={onSubmit} className="flex flex-col gap-3" noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor="subj-name">Name</Label>
            <Input
              id="subj-name"
              autoFocus
              placeholder="Mathematics"
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
            <Label htmlFor="subj-code">Code</Label>
            <Input
              id="subj-code"
              placeholder="maths"
              {...form.register("code")}
              aria-invalid={Boolean(form.formState.errors.code)}
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, digits, and hyphens. Stays the same even if
              you rename the subject.
            </p>
            {form.formState.errors.code && (
              <p className="text-sm text-destructive">
                {form.formState.errors.code.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="subj-category">Category</Label>
            <select
              id="subj-category"
              className="h-9 rounded-md border bg-background px-2 text-sm"
              {...form.register("category")}
            >
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Default for new class-level links. You can flip core/elective
              per level in the matrix.
            </p>
          </div>

          {existing && (
            <div className="flex items-center gap-2">
              <input
                id="subj-active"
                type="checkbox"
                className="h-4 w-4"
                {...form.register("isActive")}
              />
              <Label htmlFor="subj-active" className="text-sm font-normal">
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
                  : "Create subject"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
