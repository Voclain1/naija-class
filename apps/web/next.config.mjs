/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages are TS-source — let Next transpile them.
  transpilePackages: ["@school-kit/ui", "@school-kit/types"],
};

export default nextConfig;
