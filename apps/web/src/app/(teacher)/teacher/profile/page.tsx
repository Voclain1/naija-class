"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  QUALIFICATIONS_MAX,
  SPECIALTY_MAX,
  type TeacherProfileDto,
  type UpdateMyTeacherProfileInput,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  getMyTeacherProfile,
  updateMyTeacherProfile,
} from "@/lib/staff/staff-api";

// /teacher/profile — Slice 10 cp3 teacher self-service.
//
// Two states:
//   - No profile yet (GET /teacher-profiles/me → 404): empty state telling
//     the teacher their administrator hasn't set up their profile.
//   - Profile exists: read-only staff number, NUT number, and joined date;
//     editable specialty + qualifications.
//
// DIVERGENCE FROM cp3 PLAN (deliberate, API-driven): the plan listed
// nutNumber as teacher-editable, but the locked cp1 API
// (updateMyTeacherProfileSchema is .strict()) accepts ONLY specialty +
// qualifications — staffNumber and nutNumber are admin-only and a teacher who
// sends them gets a 400. So nutNumber is READ-ONLY here; only an admin edits
// it on /staff/[userId]/edit. Noted in the journal + deferred.md.
//
// FORM-CLASS PROTECTION: local `selfProfileFormSchema` matches FormValues
// exactly (two string fields) → no `as never` cast. Root + per-field errors
// render; "" → null on submit.

const selfProfileFormSchema = z.object({
  specialty: z
    .string()
    .trim()
    .max(SPECIALTY_MAX, `Specialty must be ${SPECIALTY_MAX} characters or fewer.`),
  qualifications: z
    .string()
    .trim()
    .max(
      QUALIFICATIONS_MAX,
      `Qualifications must be ${QUALIFICATIONS_MAX} characters or fewer.`,
    ),
});

type FormValues = z.infer<typeof selfProfileFormSchema>;

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function blankToNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

export default function TeacherProfilePage() {
  const [profile, setProfile] = useState<TeacherProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(selfProfileFormSchema),
    defaultValues: { specialty: "", qualifications: "" },
    mode: "onSubmit",
  });
  const { reset } = form;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNoProfile(false);
    try {
      const p = await getMyTeacherProfile();
      setProfile(p);
      reset({
        specialty: p.specialty ?? "",
        qualifications: p.qualifications ?? "",
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setNoProfile(true);
      } else {
        setLoadError(
          e instanceof ApiError ? e.message : "Could not load your profile.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [reset]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const payload: UpdateMyTeacherProfileInput = {
        specialty: blankToNull(values.specialty),
        qualifications: blankToNull(values.qualifications),
      };
      const updated = await updateMyTeacherProfile(payload);
      setProfile(updated);
      reset({
        specialty: updated.specialty ?? "",
        qualifications: updated.qualifications ?? "",
      });
      toast.success("Profile updated.");
    } catch (error) {
      if (error instanceof ApiError) {
        form.setError("root", { type: "manual", message: error.message });
      } else {
        form.setError("root", {
          type: "manual",
          message: "Could not reach the server. Try again.",
        });
      }
    }
  });

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-2xl items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading…
      </div>
    );
  }

  if (noProfile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        </header>
        <div className="flex flex-col items-start gap-2 rounded-md border border-dashed bg-muted/30 p-8 text-sm">
          <p className="font-medium">Your profile isn&apos;t set up yet.</p>
          <p className="text-muted-foreground">
            Your administrator hasn&apos;t created your teacher profile yet.
            Once they add your staff number and details, you&apos;ll be able to
            view and edit your specialty and qualifications here.
          </p>
        </div>
      </div>
    );
  }

  if (loadError || !profile) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {loadError ?? "Could not load your profile."}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">My profile</h1>
        <p className="text-sm text-muted-foreground">
          Keep your specialty and qualifications up to date. Your staff number
          and NUT number are managed by your administrator.
        </p>
      </header>

      {/* Read-only, admin-managed fields */}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-md border bg-card p-4 sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Staff number
          </dt>
          <dd className="text-sm">{profile.staffNumber}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            NUT number
          </dt>
          <dd className="text-sm">{profile.nutNumber || "—"}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs uppercase tracking-wide text-muted-foreground">
            Joined
          </dt>
          <dd className="text-sm">{formatDate(profile.joinedAt)}</dd>
        </div>
      </dl>

      {/* Editable bio fields */}
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formState.errors.root && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {form.formState.errors.root.message}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor="specialty">Specialty (optional)</Label>
          <Input
            id="specialty"
            placeholder="Mathematics"
            {...form.register("specialty")}
            aria-invalid={Boolean(form.formState.errors.specialty)}
          />
          {form.formState.errors.specialty && (
            <p className="text-sm text-destructive">
              {form.formState.errors.specialty.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <Label htmlFor="qualifications">Qualifications (optional)</Label>
          <textarea
            id="qualifications"
            rows={3}
            placeholder="B.Ed Mathematics (UNILAG), PGDE"
            className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            {...form.register("qualifications")}
            aria-invalid={Boolean(form.formState.errors.qualifications)}
          />
          {form.formState.errors.qualifications && (
            <p className="text-sm text-destructive">
              {form.formState.errors.qualifications.message}
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {form.formState.isSubmitting ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
