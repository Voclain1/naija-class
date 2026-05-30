"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  NUT_NUMBER_MAX,
  QUALIFICATIONS_MAX,
  SPECIALTY_MAX,
  STAFF_NUMBER_MAX,
  type CreateTeacherProfileInput,
  type TeacherProfileDto,
  type UpdateTeacherProfileInput,
  type UserListItemDto,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createTeacherProfile,
  listStaff,
  listTeacherProfiles,
  updateTeacherProfile,
} from "@/lib/staff/staff-api";

// /staff/[userId]/edit — Slice 10 cp3. Create OR update a TeacherProfile,
// depending on whether one already exists for this user.
//
// FORM-CLASS PROTECTION (yesterday's class-arm lesson, applied deliberately):
//   (a) Local `teacherProfileFormSchema` matches FormValues EXACTLY — four
//       string fields. It is NOT the strict API body schema
//       (createTeacherProfileSchema needs `userId` from the URL and treats
//       optionals as nullable; FormValues carry them as "" from blank
//       inputs). Because the resolver's output type === FormValues, there is
//       NO `as never` cast — the type smell the deferred.md audit tracks for
//       the five academic dialogs is avoided here from the start.
//   (b) A root error block AND a per-field error render for every field. A
//       failed submit can never silently no-op.
//   (c) "" → null coercion for the optional fields happens on submit, since
//       the API stores them as nullable text, not empty string.
//
// Create requires the user to hold the teacher role (the API asserts it). We
// gate the create form on that so an admin/owner can't trip a confusing
// "not a teacher" 400 — they see an explanatory note instead.

const teacherProfileFormSchema = z.object({
  staffNumber: z
    .string()
    .trim()
    .min(1, "Staff number is required.")
    .max(STAFF_NUMBER_MAX, `Staff number must be ${STAFF_NUMBER_MAX} characters or fewer.`),
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
  nutNumber: z
    .string()
    .trim()
    .max(NUT_NUMBER_MAX, `NUT number must be ${NUT_NUMBER_MAX} characters or fewer.`),
});

type FormValues = z.infer<typeof teacherProfileFormSchema>;

function fullName(first: string | null, last: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim() || "(no name)";
}

function blankToNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

export default function EditStaffProfilePage() {
  const router = useRouter();
  const params = useParams<{ userId: string }>();
  const userId = params.userId;

  const [user, setUser] = useState<UserListItemDto | null>(null);
  const [existing, setExisting] = useState<TeacherProfileDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(teacherProfileFormSchema),
    defaultValues: {
      staffNumber: "",
      specialty: "",
      qualifications: "",
      nutNumber: "",
    },
    mode: "onSubmit",
  });

  const { reset } = form;

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const [staff, profiles] = await Promise.all([
        listStaff(),
        listTeacherProfiles({ limit: 200 }),
      ]);
      const found = staff.find((u) => u.id === userId) ?? null;
      if (!found) {
        setNotFound(true);
        return;
      }
      setUser(found);
      const prof = profiles.data.find((p) => p.userId === userId) ?? null;
      setExisting(prof);
      if (prof) {
        reset({
          staffNumber: prof.staffNumber,
          specialty: prof.specialty ?? "",
          qualifications: prof.qualifications ?? "",
          nutNumber: prof.nutNumber ?? "",
        });
      }
    } catch (e) {
      setLoadError(
        e instanceof ApiError ? e.message : "Could not load this staff member.",
      );
    } finally {
      setLoading(false);
    }
  }, [userId, reset]);

  useEffect(() => {
    void load();
  }, [load]);

  const isTeacher = Boolean(user?.roles.some((r) => r.key === "teacher"));
  const canCreate = isTeacher; // existing profiles can always be edited

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (existing) {
        const payload: UpdateTeacherProfileInput = {
          staffNumber: values.staffNumber.trim(),
          specialty: blankToNull(values.specialty),
          qualifications: blankToNull(values.qualifications),
          nutNumber: blankToNull(values.nutNumber),
        };
        await updateTeacherProfile(existing.id, payload);
        toast.success("Profile updated.");
      } else {
        const payload: CreateTeacherProfileInput = {
          userId,
          staffNumber: values.staffNumber.trim(),
          specialty: blankToNull(values.specialty),
          qualifications: blankToNull(values.qualifications),
          nutNumber: blankToNull(values.nutNumber),
        };
        await createTeacherProfile(payload);
        toast.success("Profile created.");
      }
      router.push(`/staff/${userId}`);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "STAFF_NUMBER_TAKEN") {
          form.setError("staffNumber", {
            type: "manual",
            message: "That staff number is already in use at this school.",
          });
        } else if (error.code === "PROFILE_ALREADY_EXISTS") {
          form.setError("root", {
            type: "manual",
            message:
              "A profile already exists for this user. Reload the page to edit it.",
          });
        } else {
          form.setError("root", { type: "manual", message: error.message });
        }
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

  if (notFound) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm">
          We couldn&apos;t find that staff member.
        </div>
        <Button asChild variant="outline">
          <Link href="/staff">
            <ArrowLeft className="h-4 w-4" />
            Back to staff
          </Link>
        </Button>
      </div>
    );
  }

  if (loadError || !user) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
          {loadError ?? "Could not load this staff member."}
        </div>
        <Button asChild variant="outline">
          <Link href="/staff">
            <ArrowLeft className="h-4 w-4" />
            Back to staff
          </Link>
        </Button>
      </div>
    );
  }

  // Creating a profile for a non-teacher would 400 server-side
  // (assertUserIsTeacher). Show an explanatory note rather than a form that
  // can only fail.
  if (!existing && !canCreate) {
    return (
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <div>
          <Link
            href={`/staff/${userId}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to {fullName(user.firstName, user.lastName)}
          </Link>
        </div>
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Teacher profiles are for teachers.</p>
          <p className="mt-1 text-xs">
            {fullName(user.firstName, user.lastName)} holds the{" "}
            <strong>{user.roles.map((r) => r.name).join(", ") || "—"}</strong>{" "}
            role, not the teacher role, so an HR profile (staff number,
            specialty) doesn&apos;t apply.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <div>
        <Link
          href={`/staff/${userId}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-2 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {fullName(user.firstName, user.lastName)}
        </Link>
      </div>

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {existing ? "Edit teacher profile" : "Create teacher profile"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {fullName(user.firstName, user.lastName)} · {user.email ?? "—"}
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {form.formState.errors.root && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {form.formState.errors.root.message}
          </div>
        )}

        <div className="flex flex-col gap-1">
          <Label htmlFor="staffNumber">Staff number</Label>
          <Input
            id="staffNumber"
            autoFocus
            placeholder="SK/2026/014"
            {...form.register("staffNumber")}
            aria-invalid={Boolean(form.formState.errors.staffNumber)}
          />
          <p className="text-xs text-muted-foreground">
            Required. Unique within your school.
          </p>
          {form.formState.errors.staffNumber && (
            <p className="text-sm text-destructive">
              {form.formState.errors.staffNumber.message}
            </p>
          )}
        </div>

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

        <div className="flex flex-col gap-1">
          <Label htmlFor="nutNumber">NUT number (optional)</Label>
          <Input
            id="nutNumber"
            placeholder="NUT membership number"
            {...form.register("nutNumber")}
            aria-invalid={Boolean(form.formState.errors.nutNumber)}
          />
          <p className="text-xs text-muted-foreground">
            Nigeria Union of Teachers membership number, if applicable.
          </p>
          {form.formState.errors.nutNumber && (
            <p className="text-sm text-destructive">
              {form.formState.errors.nutNumber.message}
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" asChild>
            <Link href={`/staff/${userId}`}>Cancel</Link>
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && (
              <Loader2 className="h-4 w-4 animate-spin" />
            )}
            {form.formState.isSubmitting
              ? "Saving…"
              : existing
                ? "Save changes"
                : "Create profile"}
          </Button>
        </div>
      </form>
    </div>
  );
}
