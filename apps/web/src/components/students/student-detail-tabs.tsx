"use client";

import { useState } from "react";

import type { StudentDetailDto, StudentGuardianRefDto } from "@school-kit/types";

import { HealthProfilePanel } from "@/components/health/health-profile-panel";
import { BehaviourTab } from "@/components/students/behaviour-tab";
import { EnrollmentsTab } from "@/components/students/enrollments-tab";
import { GuardiansTab } from "@/components/students/guardians-tab";
import { StudentFeeRiskField } from "@/components/finance/fee-risk";
import { StudentAdmissionDocumentsField } from "@/components/admissions/student-admission-documents";
import { StudentHostelField } from "@/components/hostels/student-hostel";
import { BooksOutField } from "@/components/library/books-out";
import { StudentTransportField } from "@/components/transport/student-transport";
import { PhotoField } from "@/components/photos/photo-field";
import { hasPermission } from "@/lib/auth/has-permission";
import { useAuth } from "@/lib/auth/use-auth";
import { cn } from "@/lib/utils";

interface Props {
  student: StudentDetailDto;
  onGuardiansChanged: (next: StudentGuardianRefDto[]) => void;
  onPhotoChanged?: (hasPhoto: boolean) => void;
}

type TabKey = "bio" | "guardians" | "enrollments" | "health" | "behaviour";

const TABS: { key: TabKey; label: string }[] = [
  { key: "bio", label: "Bio" },
  { key: "guardians", label: "Guardians" },
  { key: "enrollments", label: "Enrollments" },
  // Phase 9 / CP3.1 — the health record (docs/modules/phase-9.md §10). Opens
  // its own audited read only when chosen.
  { key: "health", label: "Health" },
  // Last, after the practical business of who this child is and where they
  // sit: behaviour is the tab you open deliberately (the-school-day.md Part C).
  { key: "behaviour", label: "Behaviour" },
];

function formatDate(value: string | Date | null): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().slice(0, 10);
}

function formatDateTime(value: string | Date | null): string {
  if (!value) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

// Tabbed view. Guardians populated in slice 5 cp2; Enrollments still empty
// in slice 4 — slice 9 fills it. The shape (detail returns guardians: [])
// means the enrollments tab will swap in real rows without a v2 endpoint.
export function StudentDetailTabs({ student, onGuardiansChanged, onPhotoChanged }: Props) {
  const [tab, setTab] = useState<TabKey>("bio");

  return (
    <div className="flex flex-col gap-4">
      {/* Below `sm` the five tabs wrap into rows of rounded buttons, the
          SectionTabs pattern (components/shared/section-tabs.tsx): as a
          single underlined row they were wider than a phone, so Health and
          Behaviour sat past the edge of the screen (owner, 2026-10-19). */}
      <nav
        className="flex flex-wrap gap-2 sm:gap-1 sm:border-b"
        role="tablist"
        aria-label="Student detail sections"
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium",
                "sm:-mb-px sm:rounded-none sm:border-0 sm:border-b-2 sm:py-2",
                active
                  ? "border-primary/40 bg-primary/10 text-primary sm:border-primary sm:bg-transparent sm:text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground sm:border-transparent",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "bio" && <BioPanel student={student} onPhotoChanged={onPhotoChanged} />}
      {tab === "guardians" && (
        <GuardiansTab
          studentId={student.id}
          guardians={student.guardians}
          onGuardiansChanged={onGuardiansChanged}
        />
      )}
      {tab === "enrollments" && <EnrollmentsTab studentId={student.id} />}
      {tab === "health" && <HealthProfilePanel studentId={student.id} />}
      {tab === "behaviour" && <BehaviourTab studentId={student.id} />}
    </div>
  );
}

function BioPanel({
  student,
  onPhotoChanged,
}: {
  student: StudentDetailDto;
  onPhotoChanged?: (hasPhoto: boolean) => void;
}) {
  const { permissions } = useAuth();
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 rounded-md border bg-card p-4 text-sm sm:grid-cols-2">
      <Field label="Passport photo" full>
        <PhotoField
          kind="student"
          id={student.id}
          name={`${student.firstName} ${student.lastName}`}
          hasPhoto={student.hasPhoto}
          canEdit={hasPermission(permissions, "student.update")}
          onChange={onPhotoChanged}
        />
      </Field>
      <Field label="Admission number">
        <span className="font-mono">{student.admissionNumber}</span>
      </Field>
      <Field label="Gender">{student.gender}</Field>
      <Field label="Date of birth">{formatDate(student.dateOfBirth)}</Field>
      <Field label="Admitted">{formatDate(student.admittedAt)}</Field>
      <Field label="Phone">{student.phone ?? "—"}</Field>
      <Field label="Email">{student.email ?? "—"}</Field>
      <Field label="Address" full>
        {student.address ?? "—"}
      </Field>
      <Field label="Nationality">{student.nationality}</Field>
      <Field label="State of origin">{student.stateOfOrigin ?? "—"}</Field>
      <Field label="Religion">{student.religion ?? "—"}</Field>
      <Field label="Notes" full>
        {student.notes ?? "—"}
      </Field>
      <StudentTransportField studentId={student.id} />
      <BooksOutField kind="STUDENT" id={student.id} />
      <StudentHostelField studentId={student.id} />
      <StudentAdmissionDocumentsField studentId={student.id} />
      <StudentFeeRiskField studentId={student.id} />
      {student.status === "WITHDRAWN" && (
        <Field label="Withdrawn at">{formatDateTime(student.withdrawnAt)}</Field>
      )}
      {student.status === "GRADUATED" && (
        <Field label="Graduated at">{formatDateTime(student.graduatedAt)}</Field>
      )}
    </dl>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", full && "sm:col-span-2")}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

// EmptyPanel removed — the slice-9 EnrollmentsTab owns its own empty
// state now. Re-added if the Enrollments tab is ever replaced with a
// placeholder again.
