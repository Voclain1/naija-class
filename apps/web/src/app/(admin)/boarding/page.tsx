"use client";

import { BoardingPanel } from "@/components/hostels/boarding-panel";

// Phase 9 / CP6b.2 — the House master's page, and admin's view of any hostel's
// boarders and visitor log (docs/modules/phase-9.md §15 CP6b-D4, D5, D7).
export default function BoardingPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">Boarding</h1>
        <p className="text-sm text-muted-foreground">The boarders in your hostel this term, and who has come to visit them.</p>
      </div>
      <BoardingPanel />
    </div>
  );
}
