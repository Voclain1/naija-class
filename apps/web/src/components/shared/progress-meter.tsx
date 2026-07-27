// Extracted from the dashboard rebuild's inline "collection by class level"
// progress rows (dashboard/page.tsx). Generic label+percent meter — Finance
// (collection %), Grading/Report Cards (% approved, % scored), Enrollments
// (roster completeness) all share this same shape.
export function ProgressMeter({ label, percent }: { label: string; percent: number }) {
  const clamped = Math.min(100, Math.max(0, percent));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{percent}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
