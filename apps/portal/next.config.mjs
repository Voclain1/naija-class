/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Same trade-off as apps/web (see that app's next.config.mjs for the full
  // note): let Next transpile workspace packages straight from TS source
  // rather than requiring a "build packages first" step in the portal dev
  // loop.
  transpilePackages: ["@school-kit/ui", "@school-kit/types"],
};

export default nextConfig;
