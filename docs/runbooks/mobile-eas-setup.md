# Mobile builds — EAS setup

Commands run from `apps/mobile` unless stated otherwise.

**Status: the first Android `preview` APK built successfully on 2026-08-17.**
Sections 0–4 are history — the one-time setup they describe is done. What is
still live is section 5 (what to check on a device) and section 6 (what is
not built yet), plus the failure modes in §2a and §4a, which are the ones
likely to bite again.

**No Phase 6 code had ever run on a physical device before that build.** Every
screen was verified through `expo start --web` (react-native-web) — real
evidence with a proven blind spot: the bare-string crash fixed in #185 was
invisible on web and would have crashed every device on first open. Treat the
device pass as a verification step, not a formality.

---

## 0. One-time setup — done

| Piece | Where | State |
|---|---|---|
| Build profiles (`development`, `preview`, `production`) | `apps/mobile/eas.json` | Committed since #181 |
| App identity — name, slug, `ng.schoolkit.app` for both platforms, `schoolkit` scheme | `apps/mobile/app.json` | Committed, asserted by `__tests__/app-config.spec.ts` |
| Store-rule assets — 1024×1024 icon with no alpha, adaptive icon inside the 66% safe zone | `apps/mobile/assets/` | Committed, asserted by the same spec |
| `eas-cli` | `apps/mobile` devDependency | Added with this runbook |
| `build:dev` / `build:preview` / `build:production` scripts | `apps/mobile/package.json` | Added with this runbook |
| Expo account + EAS project link | `apps/mobile/app.json` | **Done 2026-08-17** — `owner: voclains-team`, `extra.eas.projectId: 970ed906-d9a1-4110-b923-ae969dfdad09` |
| `babel-preset-expo` declared explicitly | `apps/mobile/package.json` | **Done 2026-08-17** — load-bearing, see §4a |
| `eas-build-post-install` hook | `apps/mobile/package.json` | **Done 2026-08-17** — load-bearing, see §4a |

---

## 1. Expo account and login

Already done for `voclains-team`. To log in on a new machine:

```bash
pnpm exec eas login      # confirm with: pnpm exec eas whoami
```

For CI, use a token rather than an interactive login — create one at
https://expo.dev/accounts/[account]/settings/access-tokens and expose it as
`EXPO_TOKEN`. Do not commit it.

---

## 2. Link the repo to an EAS project — already done

`pnpm exec eas init` was run on 2026-08-17 and wrote `expo.owner` and
`expo.extra.eas.projectId` into `app.json`. Both are committed. They are not
secrets — a project id is an identifier, not a credential.

**Do not run `eas init` again.** On a fresh clone the values are already
there; re-running it risks pointing the repo at a second, empty project.

### 2a. EAS builds your WORKING TREE, not the commit it reports

`eas build` prints a commit hash and `eas build:view` records one. **Neither
is what was built.** EAS uploads the working directory — uncommitted changes
included — then labels the build with whatever commit you were sitting on.

This already caused a real false conclusion. Two builds on 2026-08-17 report
the identical hash `5567e6f`: one failed at
`:app:createBundleReleaseJsAndAssets`, the next succeeded. The only difference
was an uncommitted `babel-preset-expo` declaration in the working tree, and
the successful build's `READ_PACKAGE_JSON` phase proves it was read. Commit
`5567e6f` on its own does not build.

So: **commit before building**, and when a result surprises you, read
`READ_PACKAGE_JSON` in the log rather than trusting the hash.

Pulling a log without the web UI:

```bash
pnpm exec eas build:list --limit 3 --json --non-interactive
pnpm exec eas build:view <build-id> --json      # .logFiles[0] is a signed URL
curl -sS --compressed <url>                     # NDJSON, one object per line
```

Every line carries a `phase`, so the distinct phase list alone shows how far a
build got. Without `--compressed`, curl returns gzip that looks like binary
noise.

---

## 3. Credentials

Let EAS manage them unless there is a reason not to — it generates and stores
the signing material, which is one less secret to lose.

- **Android** — a keystore is generated on the first Android build. Nothing
  to buy, no console account required for an internal APK.
- **iOS** — requires a **paid Apple Developer account** ($99/year). There is
  no way around this: unsigned iOS builds cannot be installed on a device.
  Android is therefore the cheaper first target, which is why `build:dev` and
  `build:preview` default to `--platform android`.

---

## 4. First build

```bash
pnpm build:preview     # android APK, internal distribution
```

`preview` is the right first profile: it produces a plain APK that installs
from a link, with no development client and no Metro server needed. EAS
prints an install URL when it finishes.

`build:dev` produces a development-client build instead — useful for
attaching a debugger, but it needs a Metro server running on the same
network, and its API URL points at `localhost`, which on a real handset means
the handset itself. Use it second, not first.

### 4a. Two things the first build broke on — do not "clean these up"

Both are in `apps/mobile/package.json`, both look redundant, and removing
either breaks every EAS build while leaving all local commands green.
`apps/mobile/BUILD.md` carries the full reasoning; the short version:

**`eas-build-post-install`** runs `pnpm --filter "@school-kit/mobile^..." build`.
Workspace packages compile to `dist/`, `dist/` is gitignored, and EAS builds
from the Git archive — so `packages/types/dist/` does not exist there and
Metro fails to resolve `@school-kit/types`. This is the same "Build workspace
packages" step CI needs in two jobs (CLAUDE.md → *ESM module resolution*),
in a third environment. The hook's placement is confirmed, not assumed: the
build log's phase order is `POST_INSTALL_HOOK` → `EAGER_BUNDLE`.

**`babel-preset-expo": "~57.0.7"`** is declared even though `expo` already
brings it transitively. The root `.npmrc` sets `node-linker=isolated` with
`shamefully-hoist=false`, so an undeclared transitive is not resolvable by
name from `apps/mobile`. Metro's transformer resolves it from its own package
directory, so `expo start`, `expo export` and `expo export:embed --eager` all
pass; Gradle's release bundle task resolves from `apps/mobile` and fails with
`Cannot find module 'babel-preset-expo'`. Keep the version in step with the
SDK.

The pattern behind both: **a local pass is not evidence about EAS.** Each
survived typecheck, lint, 84 unit tests and a successful local eager bundle.

### 4b. `expo doctor` fails, and the build continues

Two checks fail today. Neither blocks a build, both are worth clearing before
store submission:

- **`eas-cli` should not be a project dependency.** Doctor wants it global or
  via `pnpx`. It is a devDependency here so `pnpm build:preview` works with no
  extra setup; changing it means rewriting the three `build:*` scripts.
- **Five packages behind SDK 57 patch versions** (`expo`, `expo-router`,
  `expo-constants`, `expo-splash-screen`, `@expo/metro-runtime`). Fix with
  `npx expo install --check` as its own change, not folded into a build fix.

---

## 5. Things to know before handing a build to anyone

### The preview build talks to production

`preview` and `production` both point `EXPO_PUBLIC_API_URL` at
`https://school-kit-api.fly.dev/api/v1`. That is deliberate but load-bearing:
**there is no isolated staging environment** (see `CLAUDE.md` — the
`STAGING_*` names are a convention, not a tier). A preview build therefore
reads and writes real schools' data. Test with a school created for the
purpose, not with Virgo Fidelis.

### The API URL is frozen at build time

`EXPO_PUBLIC_*` values are compiled into the JS bundle. A build pointed at the
wrong host cannot be corrected by changing an environment variable afterwards
— it needs a new build. `__tests__/app-config.spec.ts` asserts the profile
URLs for exactly this reason.

### Links will not open the app yet

`app.json` declares the `schoolkit` scheme, so `schoolkit://…` opens the app.
But an ordinary `https://` link — what a parent actually sends over WhatsApp —
needs **Universal Links** (iOS `associatedDomains`) and **App Links** (Android
`intentFilters` plus a hosted `assetlinks.json`). Neither is configured, and
both need a signed build to set up, so they belong with store submission.

This is why student activation has a paste-the-code screen
(`app/activate/index.tsx`) rather than link-only. Verify that path on the
first build; it is the only one that works today.

### What to check on the first device build

The things web could not answer:

- A cold start with a valid session — `expo-secure-store` persisting the token
  **and** the principal (web keeps both in memory only, by design, so a reload
  signs you out; on device it must not).
- The **Share code** action on the parent's portal card — a no-op on web.
- `KeyboardAvoidingView` on the login and set-password screens against a real
  on-screen keyboard.
- Any bare string rendered into a `<View>`. #187 made this a compile error, so
  it should be impossible now — the first build is the check that it is.

---

## 6. Not done yet

- **No CI build workflow.** Builds are manual. Adding one needs `EXPO_TOKEN`
  as a repository secret; worth doing once builds are known-good, not before.
- **No store submission.** `eas.json` has an empty `submit.production` block.
  Apple and Google accounts, privacy nutrition labels and NDPR disclosures are
  slice 6 — and the labels are not a formality here, because this app handles
  children's data.
