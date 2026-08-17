# apps/mobile — build and release notes

`eas.json` cannot carry comments, so the reasoning behind each profile lives
here.

## Profiles

| Profile | Purpose | Distribution | API it points at |
|---|---|---|---|
| `development` | Dev client for day-to-day work against a local API | internal | `http://localhost:4000/api/v1` |
| `preview` | Installable build for real-device testing (APK on Android) | internal | `https://school-kit-api.fly.dev/api/v1` |
| `production` | Store submission | store | `https://school-kit-api.fly.dev/api/v1` |

### Why `preview` and `production` share an API URL

**There is no isolated staging environment.** CLAUDE.md's "Environment
variables" section is explicit: `deploy-staging.yml` and the `STAGING_*`
secret names are a naming convention, not a separate tier — one Neon project,
one `school-kit-api` Fly app. Pointing `preview` at a "staging" URL would
invent a boundary that does not exist and would imply test data is safely
isolated when it is not.

Consequence to keep in mind: **a preview build on a tester's phone writes to
the same database real schools use.** Treat test accounts accordingly.

### `EXPO_PUBLIC_API_URL`

Expo inlines only `EXPO_PUBLIC_*` variables into the bundle — the same role
`NEXT_PUBLIC_*` plays in the web apps. It is baked in at BUILD time, not read
at runtime, so changing the API URL requires a rebuild, not a restart.

`src/lib/api/client.ts` falls back to `http://localhost:4000/api/v1` when the
variable is unset, which keeps `expo start` working with no configuration.

> **The failure mode this project has already hit three times** — config added
> to the repo but never set on the actual deployed environment (`STORAGE_DRIVER`,
> `PORTAL_BASE_URL`, the recreated Vercel project's vanished env vars) — applies
> here too. Verify with `eas env:list` after the first real build rather than
> assuming the profile above took effect.

## `eas-build-post-install` — why a build hook exists at all

`package.json` carries an `eas-build-post-install` script:

```
pnpm --filter "@school-kit/mobile^..." build
```

It looks removable. It is not — without it, **every** EAS build fails at
`EAGER_BUNDLE`, because a clean EAS environment does not have
`packages/types/dist/`.

The chain:

- `packages/types/package.json` points `main`/`types`/`exports` at
  `./dist/index.js`. That is a repo-wide convention, not a local choice —
  CLAUDE.md → *ESM module resolution*: compiled output, "never at `src/`".
- `dist/` is gitignored (`.gitignore:6`).
- **EAS builds from the Git archive**, so a gitignored directory is never
  uploaded.
- EAS's lifecycle is install → prebuild → bundle. Nothing in it runs
  `pnpm build`, so nothing regenerates `dist/`.
- Metro then reads the `exports` map, finds the target missing, warns that the
  package "contains an invalid package.json configuration", falls back to
  file-based resolution, finds nothing there either, and fails on the first
  file that imports `@school-kit/types` — which is a dozen of them, so the
  filename in the error is incidental.

`eas-build-post-install` runs after dependencies are installed (so `tsc` is
present) and before JS bundling. Unlike a plain `postinstall`, it is invoked
only by EAS and has no effect on a local `pnpm install`.

### Why the filter is `@school-kit/mobile^...` and not `./packages/*`

`^...` selects exactly mobile's workspace dependency **closure** —
`@school-kit/config` (no build script, skipped) and `@school-kit/types`. It
also stays correct on its own if mobile ever gains another workspace
dependency.

CI uses `pnpm -r --filter "./packages/*" build` instead
(`.github/workflows/ci.yml`), and that is deliberately **not** copied here:
it also builds `packages/db`, whose `tsc` fails unless `prisma generate` has
run first — an ordering hazard that workflow documents in its own comment.
`packages/db` is not in mobile's closure and has no business being pulled
into a mobile build.

## `babel-preset-expo` is an explicit devDependency on purpose

`babel.config.js` names `babel-preset-expo`, and `package.json` declares it
even though it ships as a transitive dependency of `expo`. Removing the
declaration "because expo already brings it" breaks Android release builds
at `:app:createBundleReleaseJsAndAssets` with
`Error: Cannot find module 'babel-preset-expo'`.

The root `.npmrc` sets `node-linker=isolated` with `shamefully-hoist=false`.
That is a deliberate strictness: a transitive dependency is NOT resolvable by
name from a workspace that did not declare it.

What makes this one nasty is that it stays invisible almost everywhere. Metro's
transformer resolves the preset from **its own** package directory, where pnpm
has correctly linked it, so `expo start`, `expo export` and even
`expo export:embed --eager` all bundle fine. Gradle's release bundle task
resolves from `apps/mobile` instead, where — undeclared — it is not linked.
Verified: before the declaration,
`require.resolve('babel-preset-expo', { paths: ['./apps/mobile'] })` threw
`MODULE_NOT_FOUND` on a fully-installed local tree while eager bundling passed
in the same tree.

Pin it to the SDK-matching version (`~57.0.7` for SDK 57) and move it with the
SDK, the same as every other `expo-*` entry.

### The general lesson

This is the third environment to hit the same trap. Local passes prove
nothing about it: `expo export`, `expo export:embed --eager` and
`pnpm typecheck` all read a `dist/` left on disk by an earlier `pnpm build`
or `pnpm dev` (turbo's `build` and `dev` tasks both `dependsOn: ["^build"]`).
The artifact is stale-but-present locally and absent on EAS. CI needed the
same explicit step, twice. Nothing caught it for `apps/mobile` because
`ci.yml` has no mobile job.

## Why `web.output` is `"single"`, not `"static"`

The Phase 0 scaffold set `output: "static"`, which runs a Node prerender pass
and emits HTML per route. That is wrong for this app and was actively
misleading: the root layout holds rendering until fonts and the session token
are ready, and that readiness is set in an effect — effects do not run during
prerendering, so **every prerendered page came out with an empty body**
(`<div id="root">` containing nothing). It looked like a successful export and
produced blank HTML.

`"single"` emits a single-page shell, which is what an authenticated app
actually is. Static prerendering buys SEO and first-paint for content pages;
this app has neither — every screen is behind a login.

Note the web target is a **preview surface only** (`expo start --web`, and the
export smoke check). The real web products are `apps/web` and `apps/portal`.
`src/lib/auth/token-store.ts` documents the related consequence: SecureStore is
native-only, so on web the token is held in memory and a reload signs you out —
deliberately, rather than falling back to localStorage.

## `appVersionSource: "remote"`

Build numbers are owned by EAS rather than by `app.json`. This avoids the
version-bump merge conflicts that come from committing an incrementing integer,
and means a rebuild of the same commit gets a fresh build number — which the
stores require.

`version` in `app.json` (currently `0.0.0`) is the user-facing marketing
version and stays hand-managed.

## EAS builds your WORKING TREE, not the commit it reports

`eas build` prints a commit hash, and `eas build:view` records one. **Neither
is what was built.** EAS uploads the working directory, uncommitted changes
included, then labels the build with whatever commit you happened to be on.

This is not theoretical — it happened on the first green Android build
(2026-08-17). Two builds report the identical hash `5567e6f`: one failed at
`:app:createBundleReleaseJsAndAssets`, the next succeeded. The only difference
was an uncommitted `babel-preset-expo` declaration sitting in the working tree.
The successful build's `READ_PACKAGE_JSON` phase shows it, so `5567e6f` itself
does not build — a fresh clone of that commit fails.

Two habits follow:

- **Commit before building**, so the reported hash is the truth.
- When a build's result surprises you, read `READ_PACKAGE_JSON` in its log
  rather than trusting the hash. It contains the `package.json` EAS actually
  read.

Retrieving a log without the web UI:

```bash
pnpm exec eas build:view <build-id> --json     # .logFiles[0] is a signed URL
curl -sS --compressed <url>                    # NDJSON, one object per line
```

Each line carries a `phase` field, so the phase list alone tells you how far a
build got. `curl` without `--compressed` returns gzip and looks like binary
noise.

## Prerequisites not yet done

- Apple Developer Program and Google Play Console accounts (1–3 week external
  latency; being started in parallel with slice 1).
- Store listing metadata, privacy nutrition labels, and NDPR disclosures.
  These are not a formality here: the app handles children's data, which
  triggers additional declarations on both stores.

Done since this list was written: `eas init` (2026-08-17) — `expo.owner`
(`voclains-team`) and `expo.extra.eas.projectId` are committed in `app.json`,
and the first Android `preview` APK built successfully the same day.
