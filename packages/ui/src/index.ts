// Shared React components for apps/web and apps/portal.
//
// Consumed as SOURCE (package.json `main` points at src, and both Next apps
// list this package in `transpilePackages`), so the re-export below is
// extensionless and resolved by the bundler, not by Node.
export * from "./page-primitives";
