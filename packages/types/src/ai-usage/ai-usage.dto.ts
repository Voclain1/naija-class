import { z } from "zod";

// AI usage + spend visibility — Phase 5, closing the `ai-usage.read` gap.
//
// The permission has existed since slice 1 and nothing has ever exposed it, so
// a school has had no way to see what the AI features cost or how close to the
// cap they are. Four AI features now write to that ledger; this is the read.
//
// WHAT THIS DELIBERATELY IS NOT: a billing surface. AI cost is
// platform-subsidised (D6) — there is no plan/tier concept in the product, no
// school is invoiced for tokens, and nothing here should imply otherwise. It
// answers "are we near the cap, and what is using it", which is an operational
// question, not a financial one.

// GET /ai-usage?months=
export const getAiUsageSchema = z
  .object({
    // How many months of history to include, current month first. Small by
    // default: the interesting question is almost always "this month".
    months: z.coerce.number().int().min(1).max(12).default(3),
  })
  .strict();

export type GetAiUsageInput = z.infer<typeof getAiUsageSchema>;

export interface AiUsagePeriodDto {
  periodStart: string | Date; // first day of the UTC month
  // The enforcement number (input estimate + max_tokens per call, settled down
  // to actuals as calls complete). This is what the budget check compares
  // against, so it is the one to show against the cap — NOT tokensActual,
  // which would understate how close a school really is mid-flight.
  tokensReserved: number;
  tokensActual: number;
  callCount: number;
  // Integer micro-USD (D2). Formatted at the display layer only — and shown as
  // USD, never converted to naira, because no FX rate exists in this system
  // and inventing one would make the historical series meaningless.
  costMicroUsd: number;
}

export interface AiUsageByPromptDto {
  promptName: string;
  callCount: number;
  totalTokens: number;
  costMicroUsd: number;
  // Failed calls still cost money and still appear here — a prompt with a high
  // failure count is the signal this breakdown exists to surface.
  failureCount: number;
}

export interface AiUsageDto {
  // The effective cap for this school: its own aiMonthlyTokenBudget when set,
  // otherwise the platform default. Which one is in force is not distinguished
  // here on purpose — from the school's side it is simply "the cap".
  monthlyTokenBudget: number;
  aiEnabled: boolean;
  aiConfigured: boolean;
  // Current month first.
  periods: AiUsagePeriodDto[];
  // Current month only. Answers "what is using the budget", which is the
  // actionable half — a school near its cap needs to know whether that is
  // report comments or weekly parent summaries.
  byPrompt: AiUsageByPromptDto[];
}
