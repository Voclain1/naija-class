"use client";

import { BoardingPanel } from "@/components/hostels/boarding-panel";

// Phase 9 / CP6b.2 — a teacher who is house master of a hostel keeps its
// boarders and visitor log here (docs/modules/phase-9.md §15 CP6b-D4, D5).
export default function TeacherBoardingPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-semibold">Boarding</h1>
        <p className="text-sm text-muted-foreground">The boarders in the hostel you keep this term, and who has come to visit them.</p>
      </div>
      <BoardingPanel />
    </div>
  );
}
