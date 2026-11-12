"use client";

import { AdmissionsList } from "@/components/admissions/admissions-list";

// Phase 9 / CP7.1 — applicants, apart from students until admitted
// (docs/modules/phase-9.md §16.8).
export default function AdmissionsPage() {
  return (
    <div className="schoolkit-workspace mx-auto max-w-7xl space-y-6">
      <div className="workspace-hero space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">Admissions</h1>
        <p className="text-sm text-muted-foreground">Review applications, track decisions, and admit students with confidence. Applicants become students only after admission.</p>
      </div>
      <AdmissionsList basePath="/admissions" />
    </div>
  );
}
