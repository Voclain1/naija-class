// Claude prompts, RAG helpers, eval harness. Populated in Phase 5.
//
// package.json's main/types/exports point at ./dist/, NOT ./src/ — do not
// "simplify" them back. Until 2026-08-09 this package pointed at src/, the
// one workspace package that did so while being destined for apps/api (a
// plain Node ESM runtime). See CLAUDE.md "ESM module resolution".
//
// Measured on Node v24.15.0, 2026-08-09, rather than assumed — the failure is
// conditional, not immediate, which is exactly what makes it a bad landmine:
//   - `import('./src/index.ts')` of THIS stub SUCCEEDS today, because Node
//     22.18+/24 strip erasable TypeScript syntax by default. So a src-pointing
//     exports map looks fine right up until it isn't.
//   - Add one `enum` — near-certain in a package holding model ids and prompt
//     names — and the same import dies with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX.
//     Same for namespaces and constructor parameter properties.
//   - Type stripping also never rewrites import specifiers, so every relative
//     import in here still needs its `.js` extension regardless.
// Net: the old config bought a silent dependency on an experimental Node
// feature, and would have broken on the first non-erasable line someone wrote,
// in production, after CI went green (Vitest+SWC never exercises this path).
//
// packages/ui still points at src/ deliberately — it is consumed only by the
// two Next apps, which list it in `transpilePackages` and bundle it from
// source. That never reaches Node's own resolver, so the rule doesn't apply.
export {};
