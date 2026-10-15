"use client";

import { IncidentsPanel } from "@/components/behaviour/incidents-panel";

// Behaviour incidents (docs/modules/phase-9.md §9 CP2-D2). The same panel
// serves the admin and teacher shells; the API narrows what each one sees.
export default function BehaviourPage() {
  return (
    <div className="flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground">Behaviour</h1>
        <p className="text-sm text-muted-foreground">
          Incidents involving more than one student. A single student&apos;s record is on their own page.
        </p>
      </header>
      <IncidentsPanel />
    </div>
  );
}
