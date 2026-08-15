// School Kit mobile — app asset generation.
//
// WHY THIS SCRIPT EXISTS, rather than four hand-placed PNGs:
//
// `app.json` referenced ./assets/icon.png, ./assets/splash.png and
// ./assets/adaptive-icon.png from Phase 0 onward, but no assets/ directory
// was ever committed. Every asset below is DERIVED from the single shared
// brand kit at apps/web/public/brand/, so:
//
//   - provenance is explicit (mobile does not get its own divergent mark),
//   - a rebrand is `pnpm --filter @school-kit/mobile assets` , not a manual
//     redraw across platforms,
//   - the diff a reviewer reads is this file, not four opaque binaries.
//
// Run:  pnpm --filter @school-kit/mobile assets
//
// The generated PNGs ARE committed — EAS builds must not depend on this
// script having been run, and `expo prebuild` reads them directly.
//
// Platform requirements encoded below (all three are real store/OS rules,
// not preferences):
//
//   icon.png (iOS + the generic Expo icon)
//     1024x1024, and NO alpha channel. The App Store rejects icons with
//     transparency. The source mark has transparent rounded corners, so it
//     is flattened onto Deep Emerald — iOS applies its own corner mask, so
//     supplying a full-bleed square is correct and pre-rounding is not.
//
//   adaptive-icon.png (Android)
//     1024x1024 foreground layer WITH alpha. Android may mask this to a
//     circle, squircle, rounded square or teardrop depending on OEM, and
//     only the centre ~66% is guaranteed visible. The mark is therefore
//     scaled into that safe zone rather than filling the canvas, and the
//     emerald field is supplied by adaptiveIcon.backgroundColor in app.json
//     so the plate and the background are the same colour.
//
//   splash.png
//     Paired with resizeMode "contain", so the canvas aspect ratio decides
//     how large the logo renders. A 1200x1200 square with the lockup at
//     ~2/3 width puts the logo at a sane size on both phone and tablet;
//     a full-bleed portrait canvas would render it enormous on narrow
//     devices.
//
//   favicon.png
//     Expo web (`web.bundler: metro`) output only. Small, alpha kept.
//
// Colours are the design-system tokens from CLAUDE.md's "Design system"
// section. They are duplicated here as hex because this script runs outside
// the Tailwind/CSS pipeline that owns globals.css — if the brand changes,
// both move together.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(MOBILE_ROOT, "..", "..");
const BRAND = path.join(REPO_ROOT, "apps", "web", "public", "brand");
const OUT = path.join(MOBILE_ROOT, "assets");

/** Deep Emerald — --primary in light mode. */
const DEEP_EMERALD = { r: 0x0e, g: 0x5c, b: 0x43, alpha: 1 };
/** Paper — --background. Warm cream, deliberately not stark white. */
const PAPER = { r: 0xf7, g: 0xf5, b: 0xef, alpha: 1 };

// sharp's DEFAULT resize background is OPAQUE BLACK. Any `fit: "contain"`
// whose target aspect ratio does not exactly match the source therefore
// letterboxes with a black bar rather than transparency. This bit us on the
// splash: an 800x213 box for a 1200x320 source is 3.7559 vs 3.75, and that
// sub-pixel mismatch rendered a 1px black line down the right edge of the
// generated splash. Always pass a background explicitly.
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

const ICON_SRC = path.join(BRAND, "schoolkit-icon.png");
const LOCKUP_SRC = path.join(BRAND, "schoolkit-lockup.png");

/** Android adaptive-icon safe zone: centre 66% of the 1024 canvas. */
const ADAPTIVE_CANVAS = 1024;
const ADAPTIVE_SAFE = Math.round(ADAPTIVE_CANVAS * 0.64); // 655 — just inside 66%

async function generateIcon() {
  const out = path.join(OUT, "icon.png");
  await sharp(ICON_SRC)
    .resize(1024, 1024, { fit: "contain", background: DEEP_EMERALD })
    // flatten() removes the alpha channel entirely — this is the App Store
    // requirement, not merely a background fill.
    .flatten({ background: DEEP_EMERALD })
    .png()
    .toFile(out);
  return out;
}

async function generateAdaptiveIcon() {
  const out = path.join(OUT, "adaptive-icon.png");
  const mark = await sharp(ICON_SRC)
    .resize(ADAPTIVE_SAFE, ADAPTIVE_SAFE, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: ADAPTIVE_CANVAS,
      height: ADAPTIVE_CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png()
    .toFile(out);
  return out;
}

async function generateSplash() {
  const out = path.join(OUT, "splash.png");
  const CANVAS = 1200;
  const LOCKUP_W = 800;

  // Width only — sharp derives the height and preserves the source ratio
  // exactly. Passing both dimensions invites the rounding mismatch described
  // at TRANSPARENT above; there is no reason to pin a height we don't care
  // about, since the composite centres the result anyway.
  const lockup = await sharp(LOCKUP_SRC)
    .resize({ width: LOCKUP_W, fit: "inside", background: TRANSPARENT })
    .png()
    .toBuffer();

  await sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: PAPER,
    },
  })
    .composite([{ input: lockup, gravity: "centre" }])
    .flatten({ background: PAPER })
    .png()
    .toFile(out);
  return out;
}

async function generateFavicon() {
  const out = path.join(OUT, "favicon.png");
  await sharp(path.join(BRAND, "schoolkit-favicon-256.png"))
    .resize(64, 64, { fit: "contain" })
    .png()
    .toFile(out);
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const written = await Promise.all([
    generateIcon(),
    generateAdaptiveIcon(),
    generateSplash(),
    generateFavicon(),
  ]);

  for (const file of written) {
    const meta = await sharp(file).metadata();
    console.info(
      `  ${path.relative(MOBILE_ROOT, file)}  ${meta.width}x${meta.height}  ` +
        `${meta.hasAlpha ? "RGBA" : "RGB (no alpha)"}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
