// Minimal eval harness. No framework — the whole point is that `pnpm ai:eval`
// is a gate that runs anywhere, including CI with no API key, so it must not
// depend on a test runner or network access to be meaningful.

export type Severity = "error" | "warn";

export interface CheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly detail?: string;
  readonly severity: Severity;
  readonly skipped?: boolean;
  readonly skipReason?: string;
}

export interface EvalCase {
  readonly suite: string;
  run(): Promise<CheckResult[]> | CheckResult[];
}

export function check(name: string, passed: boolean, detail?: string): CheckResult {
  return { name, passed, detail, severity: "error" };
}

export function warn(name: string, passed: boolean, detail?: string): CheckResult {
  return { name, passed, detail, severity: "warn" };
}

export function skip(name: string, reason: string): CheckResult {
  return { name, passed: true, severity: "error", skipped: true, skipReason: reason };
}

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

export async function runSuites(cases: EvalCase[]): Promise<number> {
  let errors = 0;
  let warnings = 0;
  let passed = 0;
  let skipped = 0;

  for (const c of cases) {
    console.log(`\n${DIM}────────────────────────────────────────────────────────${RESET}`);
    console.log(`  ${c.suite}`);
    console.log(`${DIM}────────────────────────────────────────────────────────${RESET}`);

    const results = await c.run();
    for (const r of results) {
      if (r.skipped) {
        skipped += 1;
        console.log(`  ${YELLOW}○${RESET} ${r.name} ${DIM}— skipped: ${r.skipReason}${RESET}`);
        continue;
      }
      if (r.passed) {
        passed += 1;
        console.log(`  ${GREEN}✓${RESET} ${r.name}`);
        continue;
      }
      if (r.severity === "warn") {
        warnings += 1;
        console.log(`  ${YELLOW}!${RESET} ${r.name}`);
      } else {
        errors += 1;
        console.log(`  ${RED}✗${RESET} ${r.name}`);
      }
      if (r.detail) console.log(`    ${DIM}${r.detail}${RESET}`);
    }
  }

  console.log(`\n${DIM}════════════════════════════════════════════════════════${RESET}`);
  console.log(
    `  ${GREEN}${passed} passed${RESET}` +
      (warnings ? `  ${YELLOW}${warnings} warning${warnings === 1 ? "" : "s"}${RESET}` : "") +
      (skipped ? `  ${YELLOW}${skipped} skipped${RESET}` : "") +
      (errors ? `  ${RED}${errors} failed${RESET}` : ""),
  );
  console.log(`${DIM}════════════════════════════════════════════════════════${RESET}\n`);

  return errors > 0 ? 1 : 0;
}
