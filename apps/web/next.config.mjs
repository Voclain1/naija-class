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
};

export default nextConfig;
