// Dedicated release gate: unlike the general eval harness, skips are failures.
import { assistantOrchestratorLiveCase } from "./cases/assistant-orchestrator-live.js";

async function main(): Promise<void> {
  const results = await assistantOrchestratorLiveCase.run();
  let failed = 0;
  let passed = 0;
  for (const r of results) {
    if (r.skipped || !r.passed) {
      failed++;
      console.error(`FAIL ${r.name}: ${r.skipped ? r.skipReason : r.detail ?? "expectation failed"}`);
    } else {
      passed++;
      console.log(`PASS ${r.name}`);
    }
  }
  console.log(`Assistant live eval: ${passed} passed, ${failed} failed/skipped`);
  if (failed || passed === 0) process.exitCode = 1;
}
main().catch((e) => { console.error("Live evaluation failed:", e instanceof Error ? e.message : "unknown error"); process.exitCode = 1; });
