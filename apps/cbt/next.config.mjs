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
  // Same trade-off as apps/web and apps/portal: Next transpiles the shared
  // types straight from TS source.
  transpilePackages: ["@school-kit/types"],
  // The service worker must be fetched fresh, or a lab machine could keep an
  // old one (and with it an old app) for a whole term.
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] }];
  },
};

export default nextConfig;
