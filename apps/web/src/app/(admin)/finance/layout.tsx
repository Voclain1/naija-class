"use client";

import { usePathname } from "next/navigation";

import { FinanceSubNav } from "@/components/finance/sub-nav";

import "./finance-pages.css";

export default function FinanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isDashboard = pathname === "/finance/dashboard";

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <FinanceSubNav />
      </div>
      <div className={isDashboard ? undefined : "finance-pages"}>{children}</div>
    </div>
  );
}
