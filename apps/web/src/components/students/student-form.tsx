"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  createStudentSchema,
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

// All form fields are strings — react-hook-form + HTMLInput give strings, and
// we coerce/normalise to the API DTO shape on submit. The Zod resolver runs
// against `createStudentSchema` (which mirrors the API contract) even on
// edit; UpdateStudentInput is a structural subset, so values that validate
// for create also validate for update.
interface FormValues {
  admissionNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dateOfBirth: string; // YYYY-MM-DD from <input type="date">
  gender: "MALE" | "FEMALE" | "OTHER" | "";
  photoUrl: string;
  address: string;
  phone: string;
  email: string;
  bloodGroup: string;
  medicalNotes: string;
  religion: string;
  stateOfOrigin: string;
  nationality: string;
  notes: string;
}

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
    resolver: zodResolver(createStudentSchema) as never,
    defaultValues: defaultValues(existing),
    mode: "onSubmit",
  });

  const onSubmit = form.handleSubmit(async (values) => {
    // `createStudentSchema` accepts `null` on nullable-optional fields. We
    // map blank strings to `undefined` (so they're absent from the JSON
    // payload) rather than null — matches the existing slice patterns.
    const payload: CreateStudentInput = {
      admissionNumber: values.admissionNumber.trim(),
      firstName: values.firstName.trim(),
      middleName: emptyToUndefined(values.middleName),
      lastName: values.lastName.trim(),
      dateOfBirth: new Date(values.dateOfBirth),
      gender: values.gender as "MALE" | "FEMALE" | "OTHER",
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
          toast.error(error.message);
        }
      } else {
        toast.error("Could not reach the server. Try again.");
      }
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
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
            />
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
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
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
            />
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
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-stateOfOrigin">State of origin (optional)</Label>
            <Input
              id="student-stateOfOrigin"
              placeholder="Lagos"
              {...form.register("stateOfOrigin")}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-nationality">Nationality</Label>
            <Input
              id="student-nationality"
              {...form.register("nationality")}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-religion">Religion (optional)</Label>
            <Input
              id="student-religion"
              {...form.register("religion")}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="student-bloodGroup">Blood group (optional)</Label>
            <Input
              id="student-bloodGroup"
              placeholder="O+"
              {...form.register("bloodGroup")}
            />
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
            />
          </div>

          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="student-notes">Notes (optional)</Label>
            <textarea
              id="student-notes"
              rows={3}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              {...form.register("notes")}
            />
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
