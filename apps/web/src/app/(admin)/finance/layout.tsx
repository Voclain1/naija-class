// Sub-nav shell for /finance/* (Dashboard, Invoices, Debtors, Expenses,
// Payroll). Mirrors /settings/grading and /settings/academic's layout in
// spirit, but — unlike those two — every finance page already carries its
// own outer padding/max-width wrapper (pre-existing, not introduced here).
// This layout deliberately adds no competing box-model styling of its own;
// it only stacks the sub-nav above whatever each page already renders,
// inside the (admin) layout's existing `<main className="p-6">`.
//
// A plain block, NOT a flex column (2026-10-12). Each page centres itself
// with `mx-auto max-w-*`, and auto margins on an item of a flex column turn
// off stretching: the page sized itself to its content's intrinsic width
// (407px measured in a 380px phone column), and the admin shell's
// overflow-x-hidden <main> cut the right edge off every card. In a block,
// the same page takes the column's width and its content wraps inside it.
import { FinanceSubNav } from "@/components/finance/sub-nav";

export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <FinanceSubNav />
      </div>
      {children}
    </div>
  );
}
