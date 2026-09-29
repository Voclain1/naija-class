import type { ColorScheme } from "./tokens";

// Which theme this install uses (docs/modules/look-and-feel.md Part 3).
//
// DELIBERATELY react-native-free: no AsyncStorage import here, so a spec can
// reach it. apps/mobile's Vitest runs node-env with no React Native transform,
// and a rule that imports a native module cannot be collected — the homework
// grouping was written inside a .tsx first and ran ZERO tests until it moved.
// The storage half lives in ./preference-store, the React half in
// ./theme-provider.

/**
 * D7 — THREE options, not two.
 *
 * A plain light/dark toggle takes away "follow my phone", which is what the
 * app did before this and what most people actually want: someone who has set
 * their handset to switch at sunset has already expressed a preference, and an
 * app that ignores it is the one out of step. System stays the default, so
 * nothing changes for anyone who never opens this setting.
 */
export type ThemePreference = "system" | "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = ["system", "light", "dark"];

/** What the menu shows. Short, because these sit in a row of three. */
export const THEME_LABELS: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/**
 * The scheme to actually render.
 *
 * `system` defers to the OS, and an OS that reports nothing resolves to LIGHT
 * rather than dark — `useColorScheme()` returns null when the platform has no
 * answer, and guessing dark there would flip the whole app on a device that
 * never asked for it.
 */
export function resolveScheme(
  preference: ThemePreference | null,
  /**
   * Whatever the platform reports. Typed loosely on purpose: React Native's
   * `ColorSchemeName` is "light" | "dark" | null on iOS and Android but can be
   * "unspecified" elsewhere, and a theme should never fail to resolve because
   * an OS offered a word we had not enumerated. Anything that is not exactly
   * "dark" is treated as light below.
   */
  systemScheme: ColorScheme | string | null | undefined,
): ColorScheme {
  if (preference === "light") return "light";
  if (preference === "dark") return "dark";
  // "system", or nothing stored yet — both mean follow the phone.
  return systemScheme === "dark" ? "dark" : "light";
}

/** Anything unrecognised from storage means "system", never a crash. */
export function parsePreference(raw: string | null | undefined): ThemePreference {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}
