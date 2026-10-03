import { PROMOTION_STATUS_LABELS, type ReleasedResultDetailDto } from "@school-kit/types";

// Phase 8 / CP6a — the lines a released card gained: attendance, promotion
// status, position (when the school shows it) and the principal's remark.
// Pure so the wording is specified by a test, and shared by the guardian and
// the student screens so the two cannot drift.
//
// Every reader takes the field as possibly UNDEFINED, not just null: released
// cards are persisted to disk (D32), so a card fetched before this change is
// read back without these keys. Undefined means "not on this card", exactly
// like null.

/** 3 → "3rd", 11 → "11th", 22 → "22nd". */
export function ordinal(value: number): string {
  const mod100 = value % 100;
  const mod10 = value % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

/** "Present 58 of 60 days · absent 2", or null when the arm was never marked. */
export function attendanceLine(result: Pick<Partial<ReleasedResultDetailDto>, "attendance">): string | null {
  const a = result.attendance;
  if (!a) return null;
  return `Present ${a.present} of ${a.daysOpened} days · absent ${a.absent}`;
}

/** "Promoted on trial", or null on any term but the final one. */
export function promotionLabel(result: Pick<Partial<ReleasedResultDetailDto>, "promotionStatus">): string | null {
  return result.promotionStatus ? PROMOTION_STATUS_LABELS[result.promotionStatus] : null;
}

/** "3rd", or null when the school keeps position off screens. */
export function positionLabel(position: number | null | undefined): string | null {
  return typeof position === "number" ? ordinal(position) : null;
}
