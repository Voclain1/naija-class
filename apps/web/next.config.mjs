/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are TS-source — let Next transpile them.
  //
  // Divergence note: apps/api consumes @school-kit/* from each package's
  // compiled dist/ (the "ESM module resolution" rule in CLAUDE.md — Node
  // ESM's strict resolution requires .js extensions and built artifacts).
  // The web app instead lets Next transpile straight from TS source via
  // transpilePackages. Trade-off accepted for Phase 0:
  //   + No "build packages first" step in the web dev loop; Next picks up
  //     edits in packages/* on hot-reload immediately.
  //   - Web and API now have different import-resolution semantics; a
  //     package that builds clean and the API can import is not proof
  //     it works for the web app, and vice versa.
  // Revisit once a package change breaks one consumer but not the other,
  // or once we start shipping the web build to staging — at that point
  // align both consumers on dist/ and remove this flag.
  transpilePackages: ["@school-kit/ui", "@school-kit/types"],
  // /help/guide (apps/web/src/app/help/guide/page.tsx) imports
  // docs/onboarding-guide.md directly so there's exactly one copy of the
  // guide, not a duplicate synced by hand. `asset/source` is webpack 5's
  // built-in "inline this file's contents as a string" module type (no
  // extra loader package) — the markdown gets baked into the compiled JS
  // bundle at build time as a plain string constant. Deliberately NOT a
  // runtime `fs.readFileSync` of a path outside apps/web: that would depend
  // on Vercel's file-tracing including a sibling monorepo directory in the
  // deployed serverless bundle, which is the kind of thing that works in
  // dev and silently 404s/ENOENTs in prod. This way there's no separate file
  // dependency to trace at all — see also src/types/markdown.d.ts for the
  // corresponding `*.md` module declaration.
  webpack(config) {
    config.module.rules.push({ test: /\.md$/, type: "asset/source" });
    return config;
  },
};

export default nextConfig;
