# Android smoke test on BrowserStack (no physical device)

Runs the outstanding mobile password-recovery smoke checks on a real Android
handset in BrowserStack's cloud, against a **local** API — so no production
school data is touched.

This exists because the recovery work (PR #239) shipped with real
Postgres/HTTP lifecycle evidence but **no device evidence**, and no Android
hardware is available on the dev machine. See `docs/deferred.md` → "Mobile
password recovery — physical Android smoke outstanding".

---

## The safety property this design gives you

The `smoke` build profile points at `http://bs-local.com:4000/api/v1`.
`bs-local.com` only resolves to anything while the BrowserStack Local tunnel
is running on your machine.

**This fails closed.** If you forget to start the tunnel, the app gets a
network error. It cannot silently fall through to production, because the
production hostname is not in the build at all. Do not "fix" a connection
failure by rebuilding with the `preview` profile — that profile targets
`https://school-kit-api.fly.dev`, i.e. the database real schools use.

---

## Prerequisites

1. **A BrowserStack account.** The free trial (30 minutes of App Live, no
   credit card) is enough for both flows if you set up first and test second.
2. **The BrowserStack Local binary** for Windows, from their dashboard.
   Note it is a freshly-downloaded executable, so expect Smart App Control to
   block it the same way it blocks `flyctl` — see `docs/CODEX_HANDOFF.md` →
   "Environment quirks". If it is blocked, BrowserStack's browser-extension
   Local option is the fallback.
3. **Local stack running**: `pnpm db:up`, `pnpm dev:api` (:4000), and
   `pnpm --filter @school-kit/portal dev` (:3002) for the reset pages.
4. **A disposable inbox** you can actually open — the guardian flow emails a
   real link. `RESEND_API_KEY` must be set locally or no mail is sent.

---

## 1. Point the API's outbound links at the tunnel

The API builds recovery links from `PORTAL_BASE_URL`. Left at its default it
emits `http://localhost:3002/...`, and on a cloud handset `localhost` is the
handset itself — the link will not open.

In your local `.env`:

```
PORTAL_BASE_URL=http://bs-local.com:3002
WEB_BASE_URL=http://bs-local.com:3001
```

Restart the API after changing these. If you would rather do the browser half
of the flow on your laptop instead of on the device, you can skip this — but
then you are not testing the link as a parent would receive it.

## 2. Start the tunnel

```bash
BrowserStackLocal.exe --key <YOUR_ACCESS_KEY>
```

Leave it running. Everything below assumes it is up.

## 3. Build the smoke APK

```bash
pnpm --filter @school-kit/mobile build:smoke
```

This uses the `smoke` profile in `apps/mobile/eas.json`, which differs from
`preview` in exactly two ways: the API URL points at the tunnel, and
`SMOKE_CLEARTEXT=1` is set.

That second flag matters. Android has blocked cleartext HTTP by default since
API 28, so a release APK aimed at an `http://` tunnel fails with an unhelpful
network error. `apps/mobile/app.config.js` adds
`expo-build-properties`' `android.usesCleartextTraffic` **only** when that flag
is present, so preview and production builds are byte-for-byte unaffected.
Verify that claim yourself any time:

```bash
cd apps/mobile
npx expo config --type public | grep -c expo-build-properties                  # 0
SMOKE_CLEARTEXT=1 npx expo config --type public | grep -c expo-build-properties # non-zero
```

EAS prints a download URL when the build finishes.

## 4. Upload and test

In **App Live**, upload the `.apk` (BrowserStack accepts APKs directly — no
resigning, no store account, unlike the iOS path). Pick a device on a recent
Android version, and enable **Local Testing** for the session.

---

## What to actually verify

Both flows come from `docs/deferred.md`. Use disposable identities — a throwaway
school created through the local API, not a real one.

**Flow A — guardian email recovery**

1. In the app, request a password reset for a guardian.
2. Open the emailed link, set a new password in the portal.
3. Return to the app and sign in with the new password.
4. Confirm the OLD password is refused.

**Flow B — guardian-mediated student recovery**

1. As a guardian in the portal, issue a password reset for a linked student.
2. Confirm the student's OLD credentials are refused **immediately** — the
   reset revokes the password, sessions and device tokens up front rather than
   waiting for the link to be used. This is the half most worth watching on a
   real device, because a stale session surviving on the handset is exactly
   what the lifecycle test could not observe.
3. Accept the one-time link, set a new password.
4. Sign in with the new password.
5. Confirm the link cannot be used a second time.

---

## Recording the result

Update `docs/deferred.md`'s Android smoke entry with the device model and
Android version, which flows passed, and anything that behaved differently
from the local lifecycle tests. **Do not** mark mobile auth hardening
device-verified unless both flows passed end to end.

If a flow fails, that is a real finding — the whole reason this check was kept
open rather than assumed.

---

## What this does NOT cover

- **iOS.** Every real-device cloud needs a signed `.ipa`, which needs the paid
  Apple Developer account this project does not have. BrowserStack resigns
  uploaded apps, but it cannot resign an `.ipa` that was never built. That
  blocker is Apple's, not BrowserStack's.
- **Push notifications.** Android push needs the FCM key; and on iOS,
  BrowserStack's resigning strips the Push Notifications entitlement anyway.
- **Production behaviour.** By design — this build cannot reach production.
