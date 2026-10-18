"use client";

import { useParams } from "next/navigation";

import { AdmissionDetail } from "@/components/admissions/admission-detail";

// Phase 9 / CP7.1 — one application (docs/modules/phase-9.md §16.8).
export default function AdmissionPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="mx-auto max-w-3xl">
      <AdmissionDetail id={id} backHref="/teacher/admissions" />
    </div>
  );
}
