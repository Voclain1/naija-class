/** @type {import('next').NextConfig} */
const nextConfig = {
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
