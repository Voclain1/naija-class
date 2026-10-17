"use client";

import { ResourcesPanel } from "@/components/library/resources-panel";

// Phase 9 / CP6.3 — a teacher's digital resources (docs/modules/phase-9.md §14
// CP6-D7): PDFs and links for the subjects they teach, at the classes they
// teach them. They see every resource and remove only their own.
export default function TeacherResourcesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">Library resources</h1>
        <p className="text-sm text-muted-foreground">
          PDFs and web links for the subjects you teach. Students in the classes you choose read them in their app.
        </p>
      </div>
      <ResourcesPanel />
    </div>
  );
}
