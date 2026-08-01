import Image from "next/image";

// Real brand assets (2026-08-01), replacing the plain-text "School Kit"
// placeholder used everywhere up to this point. Source: the SchoolKit brand
// sheet at apps/web/public/brand/schoolkit-brand-sheet.png.
//
// Two icon files, not one: "primary" (green squircle badge) reads fine on
// Paper; "on dark" (Ink squircle badge with a hairline border) exists
// specifically because the primary badge's white glyph still contrasts, but
// a badge with NO border would visually vanish into a dark-mode surface
// that's the same near-black family as the badge itself. Both variants are
// self-contained squircle badges (they carry their own background), so
// either reads correctly regardless of what's directly behind it — that's
// why this is a light/dark swap, not a transparent-icon-on-any-background
// approach (the transparent/knockout variant's Deep Emerald stroke has poor
// contrast against the dark-mode background specifically, confirmed by
// sampling its pixels against --background's dark value).
const ICON_LIGHT = "/brand/schoolkit-icon.png";
const ICON_DARK = "/brand/schoolkit-icon-dark.png";

export function SchoolKitIcon({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <>
      <Image
        src={ICON_LIGHT}
        alt=""
        width={size}
        height={size}
        className={`dark:hidden ${className ?? ""}`}
      />
      <Image
        src={ICON_DARK}
        alt=""
        width={size}
        height={size}
        className={`hidden dark:block ${className ?? ""}`}
      />
    </>
  );
}

// Icon + wordmark lockup. The wordmark is real text, NOT the baked-in
// lockup PNGs (schoolkit-lockup.png / -dark.png) — the brand sheet's own
// footnote flags its wordmark font as "a placeholder" and calls for a
// production geometric sans "compatible with Hanken Grotesk", which this
// app already loads as --font-sans. Recreating it as text means it inherits
// the app's real typography (and stays crisp at any size) instead of
// shipping a second, slightly-mismatched typeface baked into a raster image.
// "school" uses the ambient foreground color (Ink light / Paper dark, same
// as every other heading); "kit" uses --brand-accent (see globals.css) —
// fixed Bright Emerald in both themes, matching the reference lockup art,
// which is why it's not `text-primary` (that token flips Deep/Bright by theme).
export function SchoolKitWordmark({
  iconSize = 28,
  textClassName = "text-lg",
  className,
}: {
  iconSize?: number;
  textClassName?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <SchoolKitIcon size={iconSize} />
      <span className={`font-sans font-semibold tracking-tight ${textClassName}`}>
        <span className="text-foreground">school</span>
        <span className="text-brandAccent">kit</span>
      </span>
    </span>
  );
}
