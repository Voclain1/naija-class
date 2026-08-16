// School Kit mobile — design tokens.
//
// These are the SAME source hexes CLAUDE.md's "Design system" table defines,
// and the same ones apps/web/src/app/globals.css converts to shadcn's
// `hsl(var(--x))` form. globals.css is the source of truth for WEB; this file
// is the source of truth for MOBILE. They are two renderings of one palette,
// not two palettes — if a colour changes, both move together.
//
// Why not import from packages/ui: that package ships web components built on
// Tailwind class names, which React Native cannot consume. Sharing the raw
// values through a tiny shared package would be reasonable later; it is not
// worth a new workspace for five hex codes today.

/** Raw brand palette. Named exactly as CLAUDE.md names them. */
export const palette = {
  /** Warm cream. Deliberately not stark white. */
  paper: "#F7F5EF",
  /** Body text on Paper. */
  ink: "#13262E",
  /** Primary in light mode — progress bars, links, active nav. */
  deepEmerald: "#0E5C43",
  /** Primary in DARK mode only: better contrast on a dark surface. */
  brightEmerald: "#3FB68B",
  /** Used sparingly — one metric's bar, a summary row. Not a second primary. */
  goldSpark: "#E0A52E",
} as const;

/**
 * Semantic colours per scheme.
 *
 * The light scheme is taken directly from CLAUDE.md. The DARK scheme is
 * derived here, because CLAUDE.md specifies only one dark value
 * (Bright Emerald as `--primary`). The derivation rule is: darken Ink for
 * surfaces rather than using pure black, so the dark theme stays as warm as
 * the light one. If web's dark mode later pins exact values in globals.css,
 * reconcile toward those rather than re-deriving.
 */
export const colors = {
  light: {
    background: palette.paper,
    card: palette.paper,
    foreground: palette.ink,
    /** De-emphasised text — captions, "as of" timestamps. */
    mutedForeground: "#5B6B72",
    primary: palette.deepEmerald,
    primaryForeground: palette.paper,
    secondary: palette.goldSpark,
    secondaryForeground: palette.ink,
    border: "#E2DED3",
    /** Offline / stale indicators. Amber, deliberately not red: stale data is
     *  a caution, not an error. */
    warning: palette.goldSpark,
    danger: "#B3261E",
  },
  dark: {
    background: "#0B1519",
    card: "#132228",
    foreground: "#E8EDEE",
    mutedForeground: "#9AAAB0",
    primary: palette.brightEmerald,
    primaryForeground: "#06231A",
    secondary: palette.goldSpark,
    secondaryForeground: "#1A1405",
    border: "#243238",
    warning: palette.goldSpark,
    danger: "#F2B8B5",
  },
} as const;

export type ColorScheme = keyof typeof colors;
export type ThemeColors = (typeof colors)[ColorScheme];

/**
 * Font FAMILY names as registered with expo-font in app/_layout.tsx.
 *
 * On web, next/font/google self-hosts these at build time. On mobile the
 * equivalent is @expo-google-fonts/*, which ships the .ttf files as npm
 * packages — so neither platform makes a runtime request to Google's CDN.
 * Same guarantee, different mechanism.
 */
export const fonts = {
  /** Hanken Grotesk — body text, labels, nav. */
  sans: "HankenGrotesk_400Regular",
  sansMedium: "HankenGrotesk_500Medium",
  sansSemibold: "HankenGrotesk_600SemiBold",
  /** Fraunces — large numerals, page headings, greeting lines. */
  serif: "Fraunces_600SemiBold",
} as const;

/** 4px base scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  pill: 999,
} as const;

export const fontSizes = {
  caption: 12,
  body: 15,
  bodyLarge: 17,
  title: 22,
  display: 32,
} as const;
