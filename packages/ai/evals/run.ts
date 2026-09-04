// `pnpm ai:eval` entry point.
//
// CLAUDE.md: "run prompt eval suite (required before any prompt PR merges)".
// Until Phase 5 / Slice 2 this was `echo 'eval placeholder'` — it exited 0 and
// asserted nothing, so the documented gate passed vacuously. This makes it
// real.
//
// Design constraint that shapes everything here: the suite must be a genuine
// gate WITHOUT an API key, because CI has none and most developer machines
// will not have one either. So the offline cases (PII safety, registry and
// schema integrity, prompt quality) do the gating, and the live case skips
// loudly rather than silently passing.
//
// Exit code is 1 if any error-severity check fails. Warnings do not fail the
// run — they are tripwires for judgement calls (cost profile, pressure
// phrasing), not correctness.

import { runSuites } from "./harness.js";
import { curriculumGroundingCase } from "./cases/curriculum-grounding.js";
import { liveGenerationCase } from "./cases/live-generation.js";
import { piiSafetyCase } from "./cases/pii-safety.js";
import { promptQualityCase } from "./cases/prompt-quality.js";
import { registryIntegrityCase } from "./cases/registry-integrity.js";

// Wrapped in main() rather than using top-level await: packages/ai has no
// "type": "module", so tsx transforms this to CJS, where top-level await is a
// build error. Changing the package's module type would ripple into the
// dist/ layout that apps/api consumes — not worth it for an entry point.
async function main(): Promise<void> {
  const exitCode = await runSuites([
    piiSafetyCase,
    registryIntegrityCase,
    promptQualityCase,
    curriculumGroundingCase,
    liveGenerationCase,
  ]);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("\nai:eval crashed:\n", e);
  process.exit(1);
});
