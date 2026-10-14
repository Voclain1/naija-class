// Sub-nav shell for /reports/* (Phase 9 / CP1.2). A plain block, as the
// finance layout explains: each page sizes itself inside it.
import { ReportsSubNav } from "@/components/reports/reports-sub-nav";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <ReportsSubNav />
      </div>
      {children}
    </div>
  );
}
