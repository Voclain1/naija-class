// Dynamic Expo config layered on top of app.json.
//
// app.json remains the source of truth for everything static. Expo passes it
// in as `config`; this file's ONLY job is one narrowly-scoped, opt-in change
// for the BrowserStack Android smoke build.
//
// Why this exists at all:
//   The `smoke` EAS profile points the app at the BrowserStack Local tunnel
//   (`http://bs-local.com:4000/api/v1`) so a cloud device can reach a
//   developer's LOCAL API instead of production. That URL is cleartext HTTP,
//   and Android has blocked cleartext by default since API 28 — a release APK
//   pointed at it fails with a network error and no useful message. The
//   official fix is `expo-build-properties`' `android.usesCleartextTraffic`.
//
// Why it is gated on an env var rather than just set:
//   Allowing cleartext weakens the app. It must never reach a production or
//   preview build, both of which talk to `https://school-kit-api.fly.dev`
//   and have no reason to permit plain HTTP. `SMOKE_CLEARTEXT` is set by
//   exactly one EAS profile (`smoke`) and by nothing else, so every other
//   build resolves to the untouched app.json config — verifiable with:
//
//     npx expo config --type public                  # no build-properties
//     SMOKE_CLEARTEXT=1 npx expo config --type public # plugin present
//
// If you are reading this because a smoke build cannot reach the API, check
// in this order: is BrowserStack Local actually running; is the API listening
// on 4000; was the build made with the `smoke` profile (not `preview`).

module.exports = ({ config }) => {
  if (process.env.SMOKE_CLEARTEXT !== "1") return config;

  return {
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      [
        "expo-build-properties",
        {
          android: {
            // Scoped to this build only. See the header comment.
            usesCleartextTraffic: true,
          },
        },
      ],
    ],
  };
};
