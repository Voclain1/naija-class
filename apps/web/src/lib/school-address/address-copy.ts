import type { SchoolAddressAvailability } from "@school-kit/types";

/** The line under the new-address box, as the owner types. */
export function availabilityCopy(status: SchoolAddressAvailability): { text: string; ok: boolean } {
  switch (status) {
    case "AVAILABLE":
      return { text: "Available.", ok: true };
    case "CURRENT":
      return { text: "That is already your address.", ok: false };
    case "TAKEN":
      return { text: "Another school uses this address.", ok: false };
    case "RESERVED":
      return { text: "This address is kept for SchoolKit.", ok: false };
    case "INVALID":
      return { text: "Use 3 to 30 letters, numbers and hyphens, starting and ending with a letter or number.", ok: false };
  }
}

/** "22 November 2026" — the day a blocked change becomes possible. */
export function formatAddressDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
