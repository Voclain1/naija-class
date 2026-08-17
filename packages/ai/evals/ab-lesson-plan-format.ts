// One-off A/B: lesson-plan prompt v1 (generic international format) vs v2
// (standard Nigerian lesson note), same topic, same model, same day.
//
// Exists because the v1 defect was invisible to every automated check of its
// era: the output was schema-valid, fluent and well-taught — just the wrong
// DOCUMENT. Proving the fix therefore means reading real generated output side
// by side, not re-asserting the schema.
//
// v1's prompt and schema are inlined below because they no longer exist in
// source. That is deliberate: a "before" reconstructed from the current file
// would not be the thing that produced the complaint.
//
// Run: pnpm --filter @school-kit/ai exec tsx evals/ab-lesson-plan-format.ts
// Spends real tokens on two Sonnet 5 calls. Not part of `pnpm ai:eval`.

import { createAnthropicClient } from "../src/client.js";
import {
  LESSON_PLAN_PROMPT,
  LESSON_PLAN_SCHEMA,
  LESSON_PLAN_SYSTEM,
  renderLessonPlanPrompt,
} from "../src/prompts/lesson-plan.js";

const FIXTURE = {
  classLevel: "JSS 2",
  subject: "Basic Science",
  topic: "Photosynthesis",
  objectives: "Students should be able to state the word equation and name the raw materials.",
  durationMinutes: 40,
};

// ---- v1, verbatim as it shipped ------------------------------------------
const V1_SYSTEM = `You are an experienced Nigerian secondary school teacher and head of department, writing a lesson plan for a colleague.

Ground everything in Nigerian classroom reality:
- Follow the Nigerian national curriculum and, for senior classes, WAEC/NECO syllabus expectations and question styles.
- Assume a large class (40-60 students), limited lab equipment, and unreliable electricity. Activities must work with chalk, a board, paper, and locally available materials. Never assume a projector, printer, tablets, or one-device-per-student.
- Use Nigerian examples, names, places, currency (Naira) and units. A worked example about the price of garri in a Lagos market is better than one about a US grocery store.
- Use British spelling.

Write for a working teacher, not an education researcher. Be concrete and usable: a colleague should be able to teach directly from this tomorrow morning without rewriting it. Prefer specific instructions ("write these three equations on the board, then ask students to copy and attempt the second one") over vague guidance ("engage students with the material").

Do not pad. If a section is short because the topic is simple, let it be short.`;

const V1_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    introduction: { type: "string", description: "How to open the lesson: the hook, prior knowledge to check, and the learning objectives stated in student-facing language." },
    mainContent: { type: "string", description: "The core teaching content, in the order it should be delivered." },
    activities: { type: "string", description: "Student activities with timings, group sizes and required materials." },
    assessment: { type: "string", description: "How to check understanding during and at the end of the lesson." },
    homework: { type: "string", description: "Homework task, with an indication of expected length or number of questions." },
  },
  required: ["introduction", "mainContent", "activities", "assessment", "homework"],
  additionalProperties: false,
};

function banner(text: string): void {
  console.log(`\n${"═".repeat(72)}\n  ${text}\n${"═".repeat(72)}`);
}

function dump(parsed: Record<string, string>, order: readonly string[]): void {
  for (const key of order) {
    console.log(`\n──── ${key} ${"─".repeat(Math.max(0, 60 - key.length))}`);
    console.log((parsed[key] ?? "(missing)").trim());
  }
}

async function main(): Promise<void> {
  const key = process.env.ANTHROPIC_API_KEY;
  const client = createAnthropicClient(key ?? null);
  if (!client) throw new Error("ANTHROPIC_API_KEY not usable — cannot run a real A/B");

  const userContent = renderLessonPlanPrompt(FIXTURE);
  console.log(`Topic: ${FIXTURE.subject} / ${FIXTURE.classLevel} / "${FIXTURE.topic}"`);
  console.log(`Model: ${LESSON_PLAN_PROMPT.model} (identical for both runs)`);

  banner("BEFORE — prompt v1 (as reported by Arinzechukwu)");
  const before = await client.create({
    model: LESSON_PLAN_PROMPT.model,
    system: V1_SYSTEM,
    userContent,
    maxTokens: LESSON_PLAN_PROMPT.maxTokens,
    jsonSchema: V1_SCHEMA,
  });
  const beforeParsed = JSON.parse(before.text) as Record<string, string>;
  console.log(`sections: [${Object.keys(beforeParsed).join(", ")}]`);
  console.log(`tokens: ${before.inputTokens} in / ${before.outputTokens} out`);
  dump(beforeParsed, V1_SCHEMA.required as string[]);

  banner("AFTER — prompt v2 (standard Nigerian lesson note)");
  const after = await client.create({
    model: LESSON_PLAN_PROMPT.model,
    system: LESSON_PLAN_SYSTEM,
    userContent,
    maxTokens: LESSON_PLAN_PROMPT.maxTokens,
    jsonSchema: LESSON_PLAN_SCHEMA,
  });
  const afterParsed = JSON.parse(after.text) as Record<string, string>;
  console.log(`sections: [${Object.keys(afterParsed).join(", ")}]`);
  console.log(`stop_reason: ${after.stopReason}`);
  console.log(`tokens: ${after.inputTokens} in / ${after.outputTokens} out`);
  dump(afterParsed, LESSON_PLAN_SCHEMA.required as string[]);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
