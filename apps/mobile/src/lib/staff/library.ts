import type { LibraryLoanResultDto } from "@school-kit/types";

// Phase 9 / CP11.2 — a lost book found again (docs/modules/phase-9.md §20),
// in the website's words.
export function foundNotice(charge: LibraryLoanResultDto["charge"]): string {
  if (charge === "voided") return "Back on the shelf. The replacement charge was cancelled.";
  if (charge === "billed") return "Back on the shelf. The replacement charge is already on an invoice; any refund is for the bursar.";
  return "Back on the shelf.";
}
