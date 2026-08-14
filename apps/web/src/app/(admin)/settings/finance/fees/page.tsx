import { redirect } from "next/navigation";

// The Fee Catalog page itself now lives at /finance/fees, inside the Finance
// sub-nav (Dashboard / Invoices / Debtors / Fee Catalog / Discounts /
// Expenses / Payroll) — see components/finance/sub-nav.tsx for why it moved.
//
// This stub stays because /settings/finance/fees is a URL that has been live
// since Phase 3 and is referenced by docs/onboarding-guide.md, docs/modules/
// phase-3.md, and any admin's bookmarks. Redirect rather than duplicate: one
// canonical page, two entry points. The Settings hub card still exists too —
// it just points straight at /finance/fees now.
export default function FeesSettingsRedirect() {
  redirect("/finance/fees");
}
