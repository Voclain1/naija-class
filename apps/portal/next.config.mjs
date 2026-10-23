import { fileURLToPath } from "node:url";

// Self-hosted image (infra/vps/Dockerfile.next) builds with NEXT_OUTPUT=standalone:
// a minimal server traced from the monorepo root, so workspace packages are
// included. Unset on Vercel, so its builds are unchanged.
const standalone =
  process.env.NEXT_OUTPUT === "standalone"
    ? { output: "standalone", outputFileTracingRoot: fileURLToPath(new URL("../../", import.meta.url)) }
    : {};

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...standalone,
  reactStrictMode: true,
  // Same trade-off as apps/web (see that app's next.config.mjs for the full
  // note): let Next transpile workspace packages straight from TS source
  // rather than requiring a "build packages first" step in the portal dev
  // loop.
  transpilePackages: ["@school-kit/ui", "@school-kit/types"],
};

export default nextConfig;
