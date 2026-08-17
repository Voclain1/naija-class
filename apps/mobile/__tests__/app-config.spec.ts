import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

// apps/mobile — app configuration and asset integrity.
//
// WHY THIS SPEC EXISTS
//
// From Phase 0 until 2026-08-15, app.json referenced ./assets/icon.png,
// ./assets/splash.png and ./assets/adaptive-icon.png, and none of those files
// were ever committed — there was no assets/ directory at all. Nothing caught
// it: typecheck does not read app.json, `lint` and `test` were both `echo`
// placeholders, and no build had been attempted since the scaffold landed.
// The first thing to discover it would have been an EAS build failure, i.e.
// the most expensive and slowest possible feedback loop.
//
// So this spec is not ceremony to justify wiring up Vitest. It is the
// regression gate for the exact bug that was there, plus the store rules that
// are equally invisible to every other gate in this repo:
//
//   - iOS rejects app icons that carry an alpha channel. This is an App Store
//     Connect validation failure at UPLOAD time, after a full build.
//   - Android masks the adaptive icon foreground to an OEM-chosen shape
//     (circle, squircle, teardrop, ...), so only the centre ~66% is
//     guaranteed visible. Artwork outside it is silently cropped — there is
//     no error, the icon just looks wrong on some devices and not others.
//
// Both are cheap to assert here and expensive to discover anywhere else.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, "..");

type SplashPluginOptions = {
  image?: string;
  resizeMode?: string;
  backgroundColor?: string;
};

/** A plugin entry is either "name" or ["name", options]. */
type PluginEntry = string | [string, Record<string, unknown>?];

type ExpoConfig = {
  expo: {
    name: string;
    slug: string;
    scheme?: string;
    icon?: string;
    /**
     * Removed in Expo SDK 54+. Present here ONLY so the spec can assert its
     * absence — see "does not use the removed top-level splash key" below.
     */
    splash?: unknown;
    plugins?: PluginEntry[];
    ios?: { bundleIdentifier?: string };
    android?: {
      package?: string;
      adaptiveIcon?: { foregroundImage?: string; backgroundColor?: string };
    };
    web?: { favicon?: string };
  };
};

const appConfig = JSON.parse(
  readFileSync(path.join(MOBILE_ROOT, "app.json"), "utf8"),
) as ExpoConfig;

const { expo } = appConfig;

/**
 * Splash configuration moved from a top-level `splash` key into the
 * expo-splash-screen config plugin in SDK 54+. `expo config` hard-fails on the
 * old key ("should NOT have additional property 'splash'"), so this reads the
 * plugin form and the spec below asserts the legacy key is gone.
 */
function splashPluginOptions(): SplashPluginOptions | undefined {
  const entry = (expo.plugins ?? []).find(
    (plugin): plugin is [string, Record<string, unknown>?] =>
      Array.isArray(plugin) && plugin[0] === "expo-splash-screen",
  );
  return entry?.[1] as SplashPluginOptions | undefined;
}

/** Every asset path app.json points at, as [configKey, relativePath]. */
function declaredAssetPaths(): Array<[string, string]> {
  const entries: Array<[string, string | undefined]> = [
    ["expo.icon", expo.icon],
    ["plugins[expo-splash-screen].image", splashPluginOptions()?.image],
    [
      "expo.android.adaptiveIcon.foregroundImage",
      expo.android?.adaptiveIcon?.foregroundImage,
    ],
    ["expo.web.favicon", expo.web?.favicon],
  ];
  return entries.filter((entry): entry is [string, string] =>
    Boolean(entry[1]),
  );
}

describe("app.json — declared assets exist on disk", () => {
  // This is the assertion that would have caught the original bug.
  it.each(declaredAssetPaths())(
    "%s -> %s exists",
    (_configKey, relativePath) => {
      const absolute = path.resolve(MOBILE_ROOT, relativePath);
      expect(
        existsSync(absolute),
        `app.json references "${relativePath}" but no file exists at ${absolute}. ` +
          `Run: pnpm --filter @school-kit/mobile assets`,
      ).toBe(true);
    },
  );

  it("declares at least the three store-required assets", () => {
    const keys = declaredAssetPaths().map(([key]) => key);
    expect(keys).toContain("expo.icon");
    expect(keys).toContain("plugins[expo-splash-screen].image");
    expect(keys).toContain("expo.android.adaptiveIcon.foregroundImage");
  });

  it("does not use the removed top-level `splash` key", () => {
    // Expo SDK 54 removed it in favour of the expo-splash-screen config
    // plugin. `expo config` fails outright on the old key rather than
    // ignoring it, so a reintroduction breaks every build — including EAS.
    expect(
      expo.splash,
      "app.json still has a top-level `splash` key. Move it into the " +
        "expo-splash-screen plugin entry in `plugins`.",
    ).toBeUndefined();
  });
});

describe("icon.png — iOS App Store rules", () => {
  it("is 1024x1024", async () => {
    const meta = await sharp(path.join(MOBILE_ROOT, "assets/icon.png")).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1024);
  });

  it("has NO alpha channel (App Store Connect rejects transparency)", async () => {
    const meta = await sharp(path.join(MOBILE_ROOT, "assets/icon.png")).metadata();
    expect(
      meta.hasAlpha,
      "App Store Connect rejects app icons containing an alpha channel. " +
        "generate-assets.mjs must flatten() the source mark, not merely fill its background.",
    ).toBe(false);
  });
});

describe("adaptive-icon.png — Android masking rules", () => {
  const ADAPTIVE = () => path.join(MOBILE_ROOT, "assets/adaptive-icon.png");

  it("is 1024x1024 and keeps its alpha channel", async () => {
    const meta = await sharp(ADAPTIVE()).metadata();
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(1024);
    expect(
      meta.hasAlpha,
      "The adaptive icon is a foreground LAYER — it must be transparent " +
        "outside the mark so adaptiveIcon.backgroundColor shows through.",
    ).toBe(true);
  });

  it("keeps all artwork inside the centre 66% safe zone", async () => {
    // Android guarantees only the centre 66% of the foreground layer is
    // visible; the rest may be masked off by an OEM-chosen shape. So every
    // pixel OUTSIDE that region must be fully transparent, or artwork is
    // being silently cropped on some devices.
    const size = 1024;
    const safeFraction = 0.66;
    const margin = Math.floor((size * (1 - safeFraction)) / 2);

    const { data, info } = await sharp(ADAPTIVE())
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    expect(info.channels).toBe(4);

    let opaqueOutsideSafeZone = 0;
    for (let y = 0; y < size; y += 1) {
      const insideRows = y >= margin && y < size - margin;
      for (let x = 0; x < size; x += 1) {
        const insideSafeZone = insideRows && x >= margin && x < size - margin;
        if (insideSafeZone) continue;
        const alpha = data[(y * size + x) * 4 + 3];
        if (alpha !== undefined && alpha > 0) opaqueOutsideSafeZone += 1;
      }
    }

    expect(
      opaqueOutsideSafeZone,
      `${opaqueOutsideSafeZone} non-transparent pixels fall outside the ` +
        `centre ${safeFraction * 100}% safe zone and will be cropped on some ` +
        `Android launchers. Scale the mark down in generate-assets.mjs.`,
    ).toBe(0);
  });
});

describe("app.json — identity and linking", () => {
  it("uses matching iOS and Android application identifiers", () => {
    expect(expo.ios?.bundleIdentifier).toBe("ng.schoolkit.app");
    expect(expo.android?.package).toBe("ng.schoolkit.app");
  });

  it("declares a URL scheme", () => {
    // expo-router deep links and any OAuth/invite-accept callback need this.
    // It is also the value store listings register, so changing it after
    // release breaks existing links.
    expect(expo.scheme).toBe("schoolkit");
  });

  it("uses the Paper brand colour for launch surfaces, not stark white", () => {
    // CLAUDE.md's design system is explicit that the background is warm cream
    // (#F7F5EF), not #ffffff. The Phase 0 scaffold shipped the Expo default.
    expect(splashPluginOptions()?.backgroundColor?.toLowerCase()).toBe(
      "#f7f5ef",
    );
    expect(
      expo.android?.adaptiveIcon?.backgroundColor?.toLowerCase(),
    ).toBe("#0e5c43");
  });
});

// ---------------------------------------------------------------------------
// eas.json — build profiles
//
// Same reasoning as the asset gate above: nothing else in this repo reads
// eas.json. typecheck does not, lint does not, and the only thing that would
// catch a wrong value is a build — or, worse, a tester holding a phone that
// silently talks to the wrong server.
//
// EXPO_PUBLIC_API_URL is baked into the JS bundle at build time (that is what
// the EXPO_PUBLIC_ prefix means), so it cannot be corrected after the fact by
// changing an env var. A preview APK built against localhost is not a
// misconfiguration a tester can work around; it is an app that reaches nothing
// and cannot be fixed without a new build.
describe("eas.json — build profiles", () => {
  const eas = JSON.parse(
    readFileSync(path.join(MOBILE_ROOT, "eas.json"), "utf8"),
  ) as {
    cli?: { appVersionSource?: string };
    build: Record<string, { env?: Record<string, string>; distribution?: string }>;
  };

  const PRODUCTION_API = "https://school-kit-api.fly.dev/api/v1";

  it("defines the three profiles the build scripts invoke", () => {
    // package.json's build:dev / build:preview / build:production name these
    // by string. A renamed profile fails at build time with a message that
    // does not obviously point back at package.json.
    for (const profile of ["development", "preview", "production"]) {
      expect(eas.build[profile], `missing profile: ${profile}`).toBeDefined();
    }
  });

  it("points preview and production at the real API, never localhost", () => {
    for (const profile of ["preview", "production"]) {
      expect(eas.build[profile]?.env?.EXPO_PUBLIC_API_URL).toBe(PRODUCTION_API);
    }
  });

  it("keeps the development profile off the production API", () => {
    // A development build is the one handed round on a laptop with a debugger
    // attached. Pointing it at production means every experiment writes to
    // real schools' data — and there is no staging tier to fall back on
    // (CLAUDE.md: "There is no isolated staging environment").
    const devUrl = eas.build.development?.env?.EXPO_PUBLIC_API_URL ?? "";
    expect(devUrl).not.toBe(PRODUCTION_API);
    expect(devUrl).toMatch(/localhost|127\.0\.0\.1|10\.0\.2\.2/);
  });

  it("keeps development and preview off the public stores", () => {
    // `internal` is what makes a build installable from a link. Dropping it
    // routes the artifact at TestFlight/Play review instead, which is both
    // slow and the wrong audience for a build meant for one tester.
    expect(eas.build.development?.distribution).toBe("internal");
    expect(eas.build.preview?.distribution).toBe("internal");
  });

  it("uses remote app version management", () => {
    // With appVersionSource: "remote" EAS owns the build number, so two
    // builds cannot collide on one version — which both stores reject at
    // upload, after the build has already run.
    expect(eas.cli?.appVersionSource).toBe("remote");
  });
});
