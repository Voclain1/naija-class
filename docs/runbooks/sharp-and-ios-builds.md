# Why `sharp`'s install script is disabled

`package.json` carries:

```json
"pnpm": { "neverBuiltDependencies": ["sharp"] }
```

JSON cannot hold a comment, so the reasoning lives here.

## What broke

The first iOS build (EAS, `ios-simulator` profile, 2026-09-27) failed in the
**Install dependencies** phase:

```
sharp@0.34.5 install$ node install/check.js || npm run build
sharp: Attempting to build from source via node-gyp
sharp: Found node-addon-api 8.7.0
sharp: Please add node-gyp to your dependencies
sharp install: Failed
ELIFECYCLE  Command failed with exit code 1.
pnpm install --frozen-lockfile exited with non-zero code: 1
```

Android builds from the same lockfile succeed, because the Linux worker finds
its prebuilt binary. On the macOS worker `install/check.js` did not, fell back
to compiling from source, and `node-gyp` is not a dependency of this repo —
so the whole install died and the build never reached the native phase.

## Why skipping the script is the right fix, not a workaround

`sharp` is in `apps/mobile`'s dependencies but **nothing in the app imports
it**. Its two consumers are development-time only:

- `apps/mobile/scripts/generate-assets.mjs` — regenerates icons and splash art
- `apps/mobile/__tests__/app-config.spec.ts` — asserts those assets are sane

Neither runs on an EAS builder. And the install script itself does not produce
the binary: it *checks* for the platform package (`@img/sharp-darwin-arm64` and
friends, all present in the lockfile) and only compiles when that check fails.
Skipping the script therefore leaves a working `sharp` wherever the prebuilt
binary exists — which is every machine that actually runs those two files — and
stops a build that does not use `sharp` at all from dying over it.

The alternative, adding `node-gyp`, would make every install on every platform
carry a native toolchain to compile something no build output needs.

## What to check if this resurfaces

1. If `generate-assets.mjs` starts failing locally with "cannot find module
   @img/sharp-…", the prebuilt package is genuinely missing for your platform:
   `pnpm add -w -D @img/sharp-<your-platform>` rather than re-enabling the
   script.
2. If a FUTURE dependency needs a genuine native build, add it to
   `onlyBuiltDependencies` rather than removing this entry — the list is an
   allowlist of things worth compiling, not a blanket setting.
