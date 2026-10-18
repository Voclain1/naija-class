"use client";

import { OfficeStart } from "@/components/messages/office-start";

// Phase 9 / CP8.1 — the school office writes to one parent (docs/modules/phase-9.md §17.8).
export default function NewMessagePage() {
  return (
    <div className="mx-auto max-w-2xl">
      <OfficeStart basePath="/teacher/messages" />
    </div>
  );
}
