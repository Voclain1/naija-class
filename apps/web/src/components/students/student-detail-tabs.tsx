"use client";

import { useState } from "react";

import type { StudentDetailDto } from "@school-kit/types";

import { cn } from "@/lib/utils";

interface Props {
  student: StudentDetailDto;
}

type TabKey = "bio" | "guardians" | "enrollments";

const TABS: { key: TabKey; label: string }[] = [
  { key: "bio", label: "Bio" },
  { key: "guardians", label: "Guardians" },
  { key: "enrollments", label: "Enrollments" },
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

// Tabbed view. Guardians + Enrollments render empty-state cards in cp3 —
// slice 5 populates guardians via StudentGuardian, slice 9 populates
// enrollments. The shape (detail returns `guardians: []` today) means this
// tab will swap in real rows without a v2 endpoint.
export function StudentDetailTabs({ student }: Props) {
  const [tab, setTab] = useState<TabKey>("bio");

  return (
    <div className="flex flex-col gap-4">
      <nav
        className="flex gap-1 border-b"
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
                "border-b-2 px-3 py-2 text-sm font-medium",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {tab === "bio" && <BioPanel student={student} />}
      {tab === "guardians" && (
        <EmptyPanel
          title="No guardians yet"
          body="Guardian capture arrives in slice 5. You'll be able to add and link guardians from this tab."
        />
      )}
      {tab === "enrollments" && (
        <EmptyPanel
          title="No enrollments yet"
          body="Per-term enrollment arrives in slice 9. You'll be able to enrol this student into a class arm and term from this tab."
        />
      )}
    </div>
  );
}

function BioPanel({ student }: { student: StudentDetailDto }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 rounded-md border bg-card p-4 text-sm sm:grid-cols-2">
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
      <Field label="Blood group">{student.bloodGroup ?? "—"}</Field>
      <Field label="Medical notes" full>
        {student.medicalNotes ?? "—"}
      </Field>
      <Field label="Notes" full>
        {student.notes ?? "—"}
      </Field>
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
    <div className={cn("flex flex-col gap-0.5", full && "sm:col-span-2")}>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-dashed bg-muted/30 p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
