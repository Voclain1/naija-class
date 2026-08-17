// Display formatters for Int-hundredths values.
//
// The API sends percentages as Int hundredths (8500 = 85.00%) for the same
// reason money travels as Int kobo: a float acquires a tail of digits that is
// pure noise, and two of them stop comparing equal. The conversion to a human
// string happens here, at the display layer, and nowhere else.
//
// Its own react-native-free module so it can be unit-tested — apps/mobile's
// Vitest runs node-env with no React Native transform, so a helper defined
// inside a screen is unreachable from a spec.

/**
 * 7350 → "73.50%", null → "—".
 *
 * Deliberately NOT `(n / 100).toFixed(2)`: that routes an exact integer
 * through binary floating point to get a string back, which is a needless
 * chance to be wrong about a number the server already computed exactly.
 * Integer division and a padded remainder cannot drift.
 */
export function formatHundredths(hundredths: number | null): string {
  if (hundredths === null) return "—";
  const whole = Math.trunc(hundredths / 100);
  const frac = Math.abs(hundredths % 100)
    .toString()
    .padStart(2, "0");
  return `${whole}.${frac}%`;
}
