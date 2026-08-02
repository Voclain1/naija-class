// Sub-nav shell for /finance/* (Dashboard, Invoices, Debtors, Expenses,
// Payroll). Mirrors /settings/grading and /settings/academic's layout in
// spirit, but — unlike those two — every finance page already carries its
// own outer padding/max-width wrapper (pre-existing, not introduced here).
// This layout deliberately adds no competing box-model styling of its own;
// it only stacks the sub-nav above whatever each page already renders,
// inside the (admin) layout's existing `<main className="p-6">`.
import { FinanceSubNav } from "@/components/finance/sub-nav";

export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="print:hidden">
        <FinanceSubNav />
      </div>
      {children}
    </div>
  );
}
