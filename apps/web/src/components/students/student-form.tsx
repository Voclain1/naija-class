"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import {
  type CreateStudentInput,
  type StudentDto,
  type UpdateStudentInput,
} from "@school-kit/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import {
  createStudent,
  updateStudent,
} from "@/lib/students/students-api";
import { StudentStatusBadge } from "@/components/students/student-status-badge";

interface Props {
  /** Existing student when editing; absent on create. */
  existing?: StudentDto;
}

// FORM-CLASS PROTECTION (slice-10 cp3 / slice-11 cp4 discipline, applied here
// in the slice-4-form empty-optional fix):
//   (a) A LOCAL schema that matches FormValues EXACTLY — all strings. It is NOT
//       the strict API body schema (`createStudentSchema`), whose optional
//       fields are `.min(1)…optional()` / `.email()` / `.url()` and therefore
//       REJECT the empty string a blank input carries. Reusing it as the
//       resolver silently blocked submit (most fields rendered no error). The
//       local schema lets optionals be "" and validates format only when
//       non-empty (deferred.md empty-optional pattern). Because the resolver's
//       output type === FormValues, there is NO `as never` cast.
//   (b) A root error block AND a per-field error render for every field — a
//       failed submit can never silently no-op.
//   (c) "" → undefined coercion for optional fields happens on submit; the API
//       stores them as nullable text, never empty string.

const GENDER_VALUES = ["MALE", "FEMALE", "OTHER"] as const;

// Validates an optional free-text field: "" is allowed; otherwise length-capped.
const optionalText = (max: number) => z.string().trim().max(max);

const studentFormSchema = z.object({
  admissionNumber: z
    .string()
    .trim()
    .min(1, "Admission number is required.")
    .max(40, "Admission number is too long."),
  firstName: z.string().trim().min(1, "First name is required.").max(60),
  middleName: optionalText(60),
  lastName: z.string().trim().min(1, "Last name is required.").max(60),
  dateOfBirth: z
    .string()
    .min(1, "Date of birth is required.")
    .refine(
      (v) => !Number.isNaN(new Date(v).getTime()),
      "Enter a valid date.",
    ),
  gender: z.string().min(1, "Select a gender."),
  photoUrl: z
    .string()
    .trim()
    .max(500)
    .refine(
      (v) => v === "" || z.string().url().safeParse(v).success,
      "Enter a valid URL (including https://).",
    ),
  address: optionalText(500),
  phone: optionalText(30),
  email: z
    .string()
    .trim()
    .max(254)
    .refine(
      (v) => v === "" || z.string().email().safeParse(v).success,
      "Enter a valid email address.",
    ),
  bloodGroup: optionalText(10),
  medicalNotes: optionalText(2000),
  religion: optionalText(40),
  stateOfOrigin: optionalText(40),
  nationality: optionalText(40),
  notes: optionalText(2000),
});

type FormValues = z.infer<typeof studentFormSchema>;

function toIsoDate(value: string | Date): string {
  // API returns dateOfBirth as "YYYY-MM-DDT00:00:00.000Z" (Prisma DATE → Date).
  // For <input type="date"> we need a bare YYYY-MM-DD.
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function emptyToUndefined(v: string): string | undefined {
  const t = v.trim();
  return t === "" ? undefined : t;
}

function defaultValues(existing?: StudentDto): FormValues {
  return {
    admissionNumber: existing?.admissionNumber ?? "",
    firstName: existing?.firstName ?? "",
    middleName: existing?.middleName ?? "",
    lastName: existing?.lastName ?? "",
    dateOfBirth: existing ? toIsoDate(existing.dateOfBirth) : "",
    gender: existing?.gender ?? "",
    photoUrl: existing?.photoUrl ?? "",
    address: existing?.address ?? "",
    phone: existing?.phone ?? "",
    email: existing?.email ?? "",
    bloodGroup: existing?.bloodGroup ?? "",
    medicalNotes: existing?.medicalNotes ?? "",
    religion: existing?.religion ?? "",
    stateOfOrigin: existing?.stateOfOrigin ?? "",
    nationality: existing?.nationality ?? "Nigerian",
    notes: existing?.notes ?? "",
  };
}

export function StudentForm({ existing }: Props) {
  const router = useRouter();
  const form = useForm<FormValues>({
    resolver: zodResolver(studentFormSchema),
    defaultValues: defaultValues(existing),
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    // Optional blanks map to `undefined` (absent from the JSON body) rather
    // than null — matches the existing slice patterns. The local schema has
    // already guaranteed required fields are present and formats are valid.
    const payload: CreateStudentInput = {
      admissionNumber: values.admissionNumber.trim(),
      firstName: values.firstName.trim(),
      middleName: emptyToUndefined(values.middleName),
      lastName: values.lastName.trim(),
      dateOfBirth: new Date(values.dateOfBirth),
      gender: values.gender as CreateStudentInput["gender"],
      photoUrl: emptyToUndefined(values.photoUrl),
      address: emptyToUndefined(values.address),
      phone: emptyToUndefined(values.phone),
      email: emptyToUndefined(values.email),
      bloodGroup: emptyToUndefined(values.bloodGroup),
      medicalNotes: emptyToUndefined(values.medicalNotes),
      religion: emptyToUndefined(values.religion),
      stateOfOrigin: emptyToUndefined(values.stateOfOrigin),
      nationality: emptyToUndefined(values.nationality) ?? "Nigerian",
      notes: emptyToUndefined(values.notes),
    };

    try {
      if (existing) {
        // PATCH accepts the same field shape; UpdateStudentInput is a
        // structural subset of CreateStudentInput.
        const saved = await updateStudent(existing.id, payload as UpdateStudentInput);
        toast.success("Student updated.");
        router.push(`/students/${saved.id}`);
        router.refresh();
      } else {
        const created = await createStudent(payload);
        toast.success("Student created.");
        router.push(`/students/${created.id}`);
        router.refresh();
      }
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.code === "ADMISSION_NUMBER_TAKEN") {
          form.setError("admissionNumber", {
            type: "manual",
            message: "A student with that admission number already exists.",
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

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {form.formState.errors.root && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {form.formState.errors.root.message}
        </div>
      )}

      {existing && (
        <section className="flex items-center justify-between rounded-md border bg-muted/30 px-4 py-3">
          <div className="flex flex-col gap-0.5 text-sm">
            <span className="font-medium">Current status</span>
            <span className="text-xs text-muted-foreground">
              Use the actions on the detail page to withdraw, graduate, or
              reactivate this student.
            </span>
          </div>
          <StudentStatusBadge status={existing.status} />
        </section>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Required
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="student-admissionNumber">Admission number</Label>
            <Input
              id="student-admissionNumber"
              autoFocus={!existing}
              placeholder="2025/JSS1/001"
              {...form.register("admissionNumber")}
              aria-invalid={Boolean(form.formState.errors.admissionNumber)}
            />
            {form.formState.errors.admissionNumber && (
              <p className="text-sm text-destructive">
                {form.formState.errors.admissionNumber.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-dateOfBirth">Date of birth</Label>
            <Input
              id="student-dateOfBirth"
              type="date"
              {...form.register("dateOfBirth")}
              aria-invalid={Boolean(form.formState.errors.dateOfBirth)}
            />
            {form.formState.errors.dateOfBirth && (
              <p className="text-sm text-destructive">
                {form.formState.errors.dateOfBirth.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-firstName">First name</Label>
            <Input
              id="student-firstName"
              {...form.register("firstName")}
              aria-invalid={Boolean(form.formState.errors.firstName)}
            />
            {form.formState.errors.firstName && (
              <p className="text-sm text-destructive">
                {form.formState.errors.firstName.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-lastName">Last name</Label>
            <Input
              id="student-lastName"
              {...form.register("lastName")}
              aria-invalid={Boolean(form.formState.errors.lastName)}
            />
            {form.formState.errors.lastName && (
              <p className="text-sm text-destructive">
                {form.formState.errors.lastName.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-middleName">Middle name (optional)</Label>
            <Input
              id="student-middleName"
              {...form.register("middleName")}
              aria-invalid={Boolean(form.formState.errors.middleName)}
            />
            {form.formState.errors.middleName && (
              <p className="text-sm text-destructive">
                {form.formState.errors.middleName.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-gender">Gender</Label>
            <select
              id="student-gender"
              className="h-10 rounded-md border border-input bg-background px-3 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              {...form.register("gender")}
              aria-invalid={Boolean(form.formState.errors.gender)}
            >
              <option value="">Select…</option>
              {GENDER_VALUES.map((g) => (
                <option key={g} value={g}>
                  {g.charAt(0) + g.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
            {form.formState.errors.gender && (
              <p className="text-sm text-destructive">
                {form.formState.errors.gender.message}
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Contact & bio
        </h2>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="student-phone">Phone (optional)</Label>
            <Input
              id="student-phone"
              type="tel"
              {...form.register("phone")}
              aria-invalid={Boolean(form.formState.errors.phone)}
            />
            {form.formState.errors.phone && (
              <p className="text-sm text-destructive">
                {form.formState.errors.phone.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-email">Email (optional)</Label>
            <Input
              id="student-email"
              type="email"
              {...form.register("email")}
              aria-invalid={Boolean(form.formState.errors.email)}
            />
            {form.formState.errors.email && (
              <p className="text-sm text-destructive">
                {form.formState.errors.email.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="student-address">Address (optional)</Label>
            <Input
              id="student-address"
              {...form.register("address")}
              aria-invalid={Boolean(form.formState.errors.address)}
            />
            {form.formState.errors.address && (
              <p className="text-sm text-destructive">
                {form.formState.errors.address.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-stateOfOrigin">State of origin (optional)</Label>
            <Input
              id="student-stateOfOrigin"
              placeholder="Lagos"
              {...form.register("stateOfOrigin")}
              aria-invalid={Boolean(form.formState.errors.stateOfOrigin)}
            />
            {form.formState.errors.stateOfOrigin && (
              <p className="text-sm text-destructive">
                {form.formState.errors.stateOfOrigin.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-nationality">Nationality</Label>
            <Input
              id="student-nationality"
              {...form.register("nationality")}
              aria-invalid={Boolean(form.formState.errors.nationality)}
            />
            {form.formState.errors.nationality && (
              <p className="text-sm text-destructive">
                {form.formState.errors.nationality.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-religion">Religion (optional)</Label>
            <Input
              id="student-religion"
              {...form.register("religion")}
              aria-invalid={Boolean(form.formState.errors.religion)}
            />
            {form.formState.errors.religion && (
              <p className="text-sm text-destructive">
                {form.formState.errors.religion.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-bloodGroup">Blood group (optional)</Label>
            <Input
              id="student-bloodGroup"
              placeholder="O+"
              {...form.register("bloodGroup")}
              aria-invalid={Boolean(form.formState.errors.bloodGroup)}
            />
            {form.formState.errors.bloodGroup && (
              <p className="text-sm text-destructive">
                {form.formState.errors.bloodGroup.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="student-photoUrl">Photo URL (optional)</Label>
            <Input
              id="student-photoUrl"
              type="url"
              placeholder="https://…"
              {...form.register("photoUrl")}
              aria-invalid={Boolean(form.formState.errors.photoUrl)}
            />
            <p className="text-xs text-muted-foreground">
              Paste an image URL — direct upload is arriving in a later phase.
            </p>
            {form.formState.errors.photoUrl && (
              <p className="text-sm text-destructive">
                {form.formState.errors.photoUrl.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="student-medicalNotes">Medical notes (optional)</Label>
            <textarea
              id="student-medicalNotes"
              rows={3}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              {...form.register("medicalNotes")}
              aria-invalid={Boolean(form.formState.errors.medicalNotes)}
            />
            {form.formState.errors.medicalNotes && (
              <p className="text-sm text-destructive">
                {form.formState.errors.medicalNotes.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="student-notes">Notes (optional)</Label>
            <textarea
              id="student-notes"
              rows={3}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              {...form.register("notes")}
              aria-invalid={Boolean(form.formState.errors.notes)}
            />
            {form.formState.errors.notes && (
              <p className="text-sm text-destructive">
                {form.formState.errors.notes.message}
              </p>
            )}
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={form.formState.isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          {form.formState.isSubmitting
            ? "Saving…"
            : existing
              ? "Save changes"
              : "Create student"}
        </Button>
      </div>
    </form>
  );
}
