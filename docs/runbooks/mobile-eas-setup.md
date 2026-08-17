# Mobile builds — EAS setup

Run these steps once to produce the first installable build of `apps/mobile`.
Commands run from `apps/mobile` unless stated otherwise.

**Nothing in Phase 6 has ever run on a physical device.** Every screen has
been verified through `expo start --web` (react-native-web), which is real
evidence but has a proven blind spot: the bare-string crash fixed in #185 was
invisible on web and would have crashed every device on first open. The first
build is what closes that gap, and it should be treated as a verification
step, not a formality.

---

## 0. What is already done

No code changes are needed to start. Already in the repo:

| Piece | Where | State |
|---|---|---|
| Build profiles (`development`, `preview`, `production`) | `apps/mobile/eas.json` | Committed since #181 |
| App identity — name, slug, `ng.schoolkit.app` for both platforms, `schoolkit` scheme | `apps/mobile/app.json` | Committed, asserted by `__tests__/app-config.spec.ts` |
| Store-rule assets — 1024×1024 icon with no alpha, adaptive icon inside the 66% safe zone | `apps/mobile/assets/` | Committed, asserted by the same spec |
| `eas-cli` | `apps/mobile` devDependency | Added with this runbook |
| `build:dev` / `build:preview` / `build:production` scripts | `apps/mobile/package.json` | Added with this runbook |

What is **not** done, and cannot be done from this repo, is everything below:
it all needs an Expo account.

---

## 1. Expo account and login

Create an account at https://expo.dev, then:

```bash
pnpm exec eas login
```

Confirm with `pnpm exec eas whoami`.

For CI, use a token instead of an interactive login — create one at
https://expo.dev/accounts/[account]/settings/access-tokens and expose it as
the `EXPO_TOKEN` environment variable. Do not commit it.

---

## 2. Link the repo to an EAS project

```bash
pnpm exec eas init
```

This writes two fields into `app.json`: `expo.owner` and
`expo.extra.eas.projectId`. **Commit them.** They are not secrets — the
project id is an identifier, not a credential — and without them every build
command has to guess which project it belongs to.

Until this runs, `eas config`, `eas build` and every other project-scoped
command fail with *"An Expo user account is required to proceed"*. That is
the expected state of a fresh clone, not a misconfiguration.

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
