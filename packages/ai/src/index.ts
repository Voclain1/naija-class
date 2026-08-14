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
//
// Populated in Phase 5 / Slice 1 CP2. Relative imports carry `.js` extensions
// per the note above — TypeScript preserves them and Node ESM requires them.

export {
  MODELS,
  MODEL_PRICING,
  PRICE_TABLE_VERSION,
  estimateCostMicroUsd,
  type ModelId,
} from "./models.js";

export {
  createAnthropicClient,
  type AiCallRequest,
  type AiCallResult,
  type AnthropicPort,
} from "./client.js";

export {
  PROMPTS,
  promptRef,
  type PromptDefinition,
  type PromptKey,
  type PromptName,
} from "./prompts/registry.js";

export {
  LESSON_PLAN_PROMPT,
  LESSON_PLAN_SCHEMA,
  LESSON_PLAN_SYSTEM,
  LESSON_QUIZ_PROMPT,
  LESSON_QUIZ_SYSTEM,
  renderLessonPlanPrompt,
  renderLessonQuizPrompt,
  type LessonPlanInput,
} from "./prompts/lesson-plan.js";

export {
  REPORT_CARD_COMMENT_PROMPT,
  REPORT_CARD_COMMENT_SCHEMA,
  REPORT_CARD_COMMENT_SYSTEM,
  renderReportCardCommentPrompt,
  type ReportCardCommentComponent,
  type ReportCardCommentInput,
} from "./prompts/report-card-comment.js";

export {
  INSIGHTS_NARRATION_PROMPT,
  INSIGHTS_NARRATION_SCHEMA,
  INSIGHTS_NARRATION_SYSTEM,
  INSIGHTS_ROUTER_PROMPT,
  INSIGHTS_ROUTER_SYSTEM,
  buildInsightsRouterSchema,
  renderInsightsNarrationPrompt,
  renderInsightsRouterPrompt,
  type InsightsNarrationInput,
  type InsightsRouterInput,
} from "./prompts/insights.js";

export {
  PARENT_WEEKLY_SUMMARY_PROMPT,
  PARENT_WEEKLY_SUMMARY_SCHEMA,
  PARENT_WEEKLY_SUMMARY_SYSTEM,
  renderParentWeeklySummaryPrompt,
  type ParentSummaryScore,
  type ParentWeeklySummaryInput,
} from "./prompts/parent-weekly-summary.js";

export {
  REPORT_CARD_FORM_COMMENT_PROMPT,
  REPORT_CARD_FORM_COMMENT_SCHEMA,
  REPORT_CARD_FORM_COMMENT_SYSTEM,
  renderReportCardFormCommentPrompt,
  type FormCommentSubjectResult,
  type ReportCardFormCommentInput,
} from "./prompts/report-card-form-comment.js";
