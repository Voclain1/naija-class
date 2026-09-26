// Month-grid maths now lives in @school-kit/types, shared with the website's
// calendar (2026-09-23). Re-exported so the app's existing imports — and its
// own spec — keep working unchanged.
export {
  WEEKDAY_INITIALS,
  addDays,
  buildMonthGrid,
  entriesOnDate,
  entryCoversDate,
  formatMonth,
  monthBounds,
  monthOf,
  shiftMonth,
  type MonthCell,
} from "@school-kit/types";
