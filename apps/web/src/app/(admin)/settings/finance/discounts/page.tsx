import { redirect } from "next/navigation";

// Moved to /finance/discounts alongside the Fee Catalog — see the sibling
// fees/page.tsx redirect stub and components/finance/sub-nav.tsx.
export default function DiscountsSettingsRedirect() {
  redirect("/finance/discounts");
}
