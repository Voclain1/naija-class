"use client";

import { LibraryHeader } from "@/components/library/library-shared";
import { ResourcesPanel } from "@/components/library/resources-panel";

// Phase 9 / CP6.3 — the library's digital resources (docs/modules/phase-9.md
// §14 CP6-D7), for the Librarian, owner and admin.
export default function LibraryResourcesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <LibraryHeader
        title="Resources"
        intro="PDFs and web links for a subject. Students in the classes you choose read them in their app."
      />
      <ResourcesPanel />
    </div>
  );
}
