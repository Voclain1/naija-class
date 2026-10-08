// The register-scan accuracy pass: `pnpm ai:eval:registers`.
// docs/deferred.md item 5, docs/modules/smart-student-import.md §8.
//
// Sends each photographed register page through `student-list-extraction`
// with exactly the request the API makes (same system prompt, schema, model,
// max tokens, image-then-text order), scores the answer against hand-checked
// ground truth (./score.ts), times each call, and prints a per-field report
// and a yes/no against the switch-on bar.
//
// THE PHOTOS AND THE GROUND TRUTH ARE CHILDREN'S PERSONAL DATA. They never go
// in this repository:
//   - The default folder, packages/ai/evals/register-scans/data/, is in
//     .gitignore. REGISTER_EVAL_DIR points anywhere else.
//   - The report prints counts and field names only. `--show-values` prints
//     the actual mismatches for the person fixing the prompt, on their own
//     screen; never paste that output into a PR, an issue or a log.
//   - Nothing is written to disk.
//
// Like ../cases/live-generation.ts, this calls the model through the port
// directly rather than AiGenerationService, so it writes no ai_generations
// row and spends no school's budget: it is a developer tool, run by hand,
// on the operator's own key.
//
// Folder layout, one pair per page:
//   jss1a-page1.jpg              (or .jpeg / .png / .webp)
//   jss1a-page1.expected.json    { "knownClassArms"?: [...], "rows": [TruthRow, ...] }

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { createAnthropicClient, type AiImageInput } from "../../src/client.js";
import {
  STUDENT_LIST_EXTRACTION_PROMPT,
  STUDENT_LIST_EXTRACTION_SCHEMA,
  STUDENT_LIST_EXTRACTION_SYSTEM,
  renderStudentListExtractionPrompt,
} from "../../src/prompts/student-list-extraction.js";
import {
  SCORED_FIELDS,
  addScores,
  alignRows,
  emptyPageScore,
  scoreField,
  scorePage,
  scoredCells,
  silentErrors,
  verdicts,
  type ExtractedRow,
  type TruthRow,
} from "./score.js";

const DEFAULT_DIR = path.join(__dirname, "data");
const MEDIA_TYPES: Record<string, AiImageInput["mediaType"]> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
// The scan is synchronous (D3): the admin's request stays open for the whole
// call. Past this, the route needs a longer timeout or a progress state.
const SYNC_BUDGET_MS = 60_000;

interface Page {
  readonly name: string;
  readonly imagePath: string;
  readonly mediaType: AiImageInput["mediaType"];
  readonly knownClassArms: string[];
  readonly truth: TruthRow[];
}

function loadPages(dir: string): Page[] {
  const pages: Page[] = [];
  for (const file of readdirSync(dir).sort()) {
    const ext = path.extname(file).toLowerCase();
    const mediaType = MEDIA_TYPES[ext];
    if (!mediaType) continue;
    const name = file.slice(0, -ext.length);
    const truthPath = path.join(dir, `${name}.expected.json`);
    if (!existsSync(truthPath)) {
      console.warn(`  skipping ${file}: no ${name}.expected.json beside it`);
      continue;
    }
    const parsed = JSON.parse(readFileSync(truthPath, "utf8")) as { knownClassArms?: string[]; rows: TruthRow[] };
    if (!Array.isArray(parsed.rows)) throw new Error(`${name}.expected.json has no "rows" array`);
    pages.push({
      name,
      imagePath: path.join(dir, file),
      mediaType,
      knownClassArms: parsed.knownClassArms ?? [],
      truth: parsed.rows.map((r) => ({
        ...Object.fromEntries(SCORED_FIELDS.map((f) => [f, r[f] ?? null])),
        illegible: r.illegible ?? [],
      })) as TruthRow[],
    });
  }
  return pages;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}

async function main(): Promise<void> {
  const showValues = process.argv.includes("--show-values");
  const dir = process.env.REGISTER_EVAL_DIR ?? DEFAULT_DIR;
  const key = process.env.ANTHROPIC_API_KEY;
  const port = createAnthropicClient(key && !key.includes("placeholder") ? key : null);
  if (!port) {
    console.error("ANTHROPIC_API_KEY is not set. This pass calls the real model; there is nothing to run without it.");
    process.exit(2);
  }
  if (!existsSync(dir)) {
    console.error(`No register folder at ${dir}. Put photos and .expected.json files there, or set REGISTER_EVAL_DIR.`);
    process.exit(2);
  }
  const pages = loadPages(dir);
  if (pages.length === 0) {
    console.error(`No photo with a matching .expected.json in ${dir}.`);
    process.exit(2);
  }

  console.log(
    `\nstudent-list-extraction v${STUDENT_LIST_EXTRACTION_PROMPT.version} on ${STUDENT_LIST_EXTRACTION_PROMPT.model}, ${pages.length} page(s)\n`,
  );

  let total = emptyPageScore();
  const latencies: number[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let failures = 0;

  for (const page of pages) {
    const started = Date.now();
    let rows: ExtractedRow[];
    try {
      const result = await port.create({
        model: STUDENT_LIST_EXTRACTION_PROMPT.model,
        system: STUDENT_LIST_EXTRACTION_SYSTEM,
        userContent: renderStudentListExtractionPrompt({ knownClassArms: page.knownClassArms }),
        // Dimensions only price the budget reservation, which this tool does
        // not make; the port never sends them.
        images: [
          { mediaType: page.mediaType, base64: readFileSync(page.imagePath).toString("base64"), widthPx: 0, heightPx: 0 },
        ],
        maxTokens: STUDENT_LIST_EXTRACTION_PROMPT.maxTokens,
        jsonSchema: STUDENT_LIST_EXTRACTION_SCHEMA,
      });
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      if (result.stopReason !== "end_turn") throw new Error(`stop reason ${result.stopReason}`);
      rows = (JSON.parse(result.text) as { rows: ExtractedRow[] }).rows;
    } catch (e) {
      failures += 1;
      console.log(`  ✗ ${page.name}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    } finally {
      latencies.push(Date.now() - started);
    }

    const score = scorePage(page.truth, rows);
    total = addScores(total, score);
    const cells = SCORED_FIELDS.reduce((n, f) => n + scoredCells(score.fields[f]), 0);
    const silent = SCORED_FIELDS.reduce((n, f) => n + silentErrors(score.fields[f]), 0);
    console.log(
      `  ${page.name}: ${score.truthRows} rows on page, ${score.extractedRows} read, ` +
        `${score.droppedRows} dropped, ${score.extraRows} extra, ${silent} silent error(s) in ${cells} cells, ` +
        `${((latencies.at(-1) ?? 0) / 1000).toFixed(1)}s`,
    );

    if (showValues) {
      for (const [t, g] of alignRows(page.truth, rows)) {
        for (const field of SCORED_FIELDS) {
          const outcome = scoreField(field, page.truth[t]!, rows[g]!);
          if (outcome === "correct" || outcome === "flagged") continue;
          console.log(
            `      row ${t + 1} ${field} [${outcome}]: page ${JSON.stringify(page.truth[t]![field])}, model ${JSON.stringify(rows[g]![field])}`,
          );
        }
      }
    }
  }

  console.log("\n  field              correct  flagged  missed  WRONG  INVENTED");
  for (const field of SCORED_FIELDS) {
    const t = total.fields[field];
    console.log(
      `  ${field.padEnd(18)} ${String(t.correct).padStart(7)}  ${String(t.flagged).padStart(7)}  ${String(t.missed).padStart(6)}  ${String(t.wrong).padStart(5)}  ${String(t.invented).padStart(8)}`,
    );
  }

  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const max = sorted.at(-1) ?? 0;
  console.log(
    `\n  latency: median ${(p50 / 1000).toFixed(1)}s, slowest ${(max / 1000).toFixed(1)}s ` +
      `(synchronous budget ${SYNC_BUDGET_MS / 1000}s)`,
  );
  console.log(`  tokens: ${inputTokens} in, ${outputTokens} out across ${pages.length} page(s)`);

  const results = [
    ...verdicts(total),
    {
      name: `every scan finishes inside ${SYNC_BUDGET_MS / 1000}s`,
      passed: max <= SYNC_BUDGET_MS,
      detail: `slowest ${(max / 1000).toFixed(1)}s`,
    },
    { name: "every call returned a usable answer", passed: failures === 0, detail: `${failures} failed` },
  ];
  console.log("\n  Switch-on bar:");
  for (const v of results) console.log(`  ${v.passed ? "✓" : "✗"} ${v.name} — ${v.detail}`);
  process.exit(results.every((v) => v.passed) ? 0 : 1);
}

main().catch((e) => {
  console.error("\nregister eval crashed:\n", e);
  process.exit(1);
});
