"use client";

import { AdmissionsList } from "@/components/admissions/admissions-list";

// Phase 9 / CP7.1 — applicants, apart from students until admitted
// (docs/modules/phase-9.md §16.8).
export default function AdmissionsPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">Admissions</h1>
        <p className="text-sm text-muted-foreground">Applications from your online form. Applicants become students only when you admit them.</p>
      </div>
      <AdmissionsList basePath="/admissions" />
    </div>
  );
}
