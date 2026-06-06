// Display-layer formatters for report-card numbers. The API stores averages as
// Int hundredths (7350 = 73.50%) and positions as plain ints; we only divide /
// ordinalise at render time. null → an em-dash placeholder, never "null".

const DASH = "—";

// 7350 → "73.50%". null → "—".
export function formatAverage(hundredths: number | null): string {
  if (hundredths === null) return DASH;
  const whole = Math.trunc(hundredths / 100);
  const frac = Math.abs(hundredths % 100).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

export function formatInt(value: number | null): string {
  return value === null ? DASH : String(value);
}

// 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th". null → "—".
export function formatOrdinal(value: number | null): string {
  if (value === null) return DASH;
  const mod100 = value % 100;
  const mod10 = value % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13
      ? "th"
      : mod10 === 1
        ? "st"
        : mod10 === 2
          ? "nd"
          : mod10 === 3
            ? "rd"
            : "th";
  return `${value}${suffix}`;
}

// "DD Mon YYYY HH:MM" for last-built / generated timestamps. Accepts Date | ISO
// string | null. null → "".
export function formatStamp(value: string | Date | null): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${String(d.getDate()).padStart(2, "0")} ${months[d.getMonth()]} ${d.getFullYear()} ${hh}:${mm}`;
}

export function fullStudentName(s: { firstName: string; middleName: string | null; lastName: string }): string {
  return [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" ");
}
