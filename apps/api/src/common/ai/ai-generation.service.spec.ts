import type { ConfigService } from "@nestjs/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { MODELS, type AiCallRequest, type AiCallResult, type AnthropicPort, type PromptDefinition } from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, RateLimitError } from "@school-kit/types";

import { AiGenerationService, estimateInputTokens } from "./ai-generation.service.js";
import { AI_ERROR_CODES, currentPeriodStart } from "./ai.constants.js";

// Integration suite against the real Postgres in docker-compose, deliberately
// NOT a mocked DB — the behaviour under test is a conditional atomic UPDATE
// whose whole purpose is correctness under concurrent access. A mock would
// assert that the code calls a function, which is precisely not the question.
//
// The Anthropic side IS faked (via AnthropicPort), for three reasons: no live
// API key is needed for CI, no real tokens are spent, and — most importantly —
// "the call never happened" is the assertion that makes budget enforcement
// meaningful. CLAUDE.md's hard rule is that the budget is checked BEFORE the
// call; a test that only checks an error was thrown would still pass if the
// call had been made and the error raised afterwards.

class FakePort implements AnthropicPort {
  calls: AiCallRequest[] = [];
  behaviour: "ok" | "throw" | "refuse" = "ok";
  inputTokens = 100;
  outputTokens = 50;

  async create(req: AiCallRequest): Promise<AiCallResult> {
    this.calls.push(req);
    if (this.behaviour === "throw") throw new Error("simulated upstream failure");
    return {
      text: this.behaviour === "refuse" ? "" : "ok",
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      stopReason: this.behaviour === "refuse" ? "refusal" : "end_turn",
    };
  }
}

const configStub = (overrides: Record<string, string> = {}) =>
  ({ get: (key: string) => overrides[key] }) as unknown as ConfigService;

// Local prompt definition rather than the registry's, so the token arithmetic
// under test is fixed and readable instead of moving whenever a real prompt
// is retuned.
const TEST_PROMPT: PromptDefinition = {
  name: "spec-fixture",
  version: "1",
  model: MODELS.HAIKU_4_5,
  maxTokens: 100,
};

const USER_CONTENT = "generate something";
const RESERVATION = estimateInputTokens(undefined, USER_CONTENT) + TEST_PROMPT.maxTokens;
const ACTUAL_TOKENS = 150; // FakePort defaults: 100 in + 50 out

const runId = Math.random().toString(36).slice(2, 8);
const createdSchoolIds: string[] = [];

async function makeSchool(opts: { budget?: number | null; aiEnabled?: boolean } = {}) {
  const school = await basePrisma.school.create({
    data: {
      name: `AI Budget ${runId}`,
      slug: `ai-budget-${runId}-${createdSchoolIds.length}`,
      aiEnabled: opts.aiEnabled ?? true,
      aiMonthlyTokenBudget: opts.budget === undefined ? 1_000_000 : opts.budget,
    },
    select: { id: true },
  });
  createdSchoolIds.push(school.id);
  return school.id;
}

async function readPeriod(schoolId: string) {
  return withTenant(schoolId, (db) =>
    db.aIBudgetPeriod.findUnique({
      where: { schoolId_periodStart: { schoolId, periodStart: currentPeriodStart() } },
    }),
  );
}

async function readLedger(schoolId: string) {
  return withTenant(schoolId, (db) => db.aIGeneration.findMany({ where: { schoolId } }));
}

describe("AiGenerationService — budget enforcement and reserve/settle", () => {
  let port: FakePort;

  beforeEach(() => {
    port = new FakePort();
  });

  afterAll(async () => {
    for (const id of createdSchoolIds) {
      await withTenant(id, async (db) => {
        await db.aIGeneration.deleteMany({ where: { schoolId: id } });
        await db.aIBudgetPeriod.deleteMany({ where: { schoolId: id } });
      });
      await basePrisma.school.delete({ where: { id } });
    }
  });

  // -----------------------------------------------------------------------
  // The hard rule: budget is enforced BEFORE the call.
  // -----------------------------------------------------------------------
  it("blocks the call when the school's monthly budget is already exhausted — and the LLM is never invoked", async () => {
    // Budget smaller than a single reservation, so the very first call
    // cannot fit.
    const schoolId = await makeSchool({ budget: 10 });
    const service = new AiGenerationService(configStub(), port);

    await expect(
      service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT }),
    ).rejects.toMatchObject({ code: AI_ERROR_CODES.BUDGET_EXCEEDED });

    // THE assertion that makes this test worth writing: the upstream call was
    // never made. "Threw an error" alone would also pass if we had called
    // Claude first and rejected afterwards — which is the exact failure the
    // hard rule exists to prevent.
    expect(port.calls).toHaveLength(0);

    // And nothing was written to the ledger, because nothing was spent.
    expect(await readLedger(schoolId)).toHaveLength(0);
  });

  it("blocks the call when the school-level kill switch is off, without invoking the LLM", async () => {
    const schoolId = await makeSchool({ aiEnabled: false });
    const service = new AiGenerationService(configStub(), port);

    await expect(
      service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(port.calls).toHaveLength(0);
  });

  it("blocks the call when the platform-wide kill switch is off", async () => {
    const schoolId = await makeSchool();
    const service = new AiGenerationService(configStub({ AI_ENABLED: "false" }), port);

    await expect(
      service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT }),
    ).rejects.toMatchObject({ code: AI_ERROR_CODES.DISABLED_PLATFORM });
    expect(port.calls).toHaveLength(0);
  });

  // -----------------------------------------------------------------------
  // Success path: reservation reconciles to the true token count.
  // -----------------------------------------------------------------------
  it("on success, writes the ledger row and reconciles the reservation down to actual usage", async () => {
    const schoolId = await makeSchool();
    const service = new AiGenerationService(configStub(), port);

    await service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT });

    expect(port.calls).toHaveLength(1);

    const ledger = await readLedger(schoolId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({
      success: true,
      model: MODELS.HAIKU_4_5,
      promptName: "spec-fixture",
      promptVersion: "1",
      inputTokens: 100,
      outputTokens: 50,
      errorMessage: null,
    });
    // Haiku 4.5: 100 input x 1 uUSD + 50 output x 5 uUSD = 350 uUSD.
    expect(ledger[0].costMicroUsd).toBe(350);
    expect(ledger[0].latencyMs).toBeGreaterThanOrEqual(0);

    const period = await readPeriod(schoolId);
    // The pessimistic reservation is gone; only true usage remains held.
    expect(period?.tokensReserved).toBe(ACTUAL_TOKENS);
    expect(period?.tokensActual).toBe(ACTUAL_TOKENS);
    expect(period?.callCount).toBe(1);
    expect(period?.costMicroUsd).toBe(350);
  });

  // -----------------------------------------------------------------------
  // Failure path: no permanently-held budget.
  // -----------------------------------------------------------------------
  it("on upstream failure, releases the ENTIRE reservation and still records the failed call", async () => {
    const schoolId = await makeSchool();
    port.behaviour = "throw";
    const service = new AiGenerationService(configStub(), port);

    await expect(
      service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT }),
    ).rejects.toThrow();

    expect(port.calls).toHaveLength(1);

    // A failed call must not silently consume budget forever — this is the
    // "reserved hole" regression this test exists to catch.
    const period = await readPeriod(schoolId);
    expect(period?.tokensReserved).toBe(0);
    expect(period?.tokensActual).toBe(0);
    // call_count still counts the attempt: it is an attempt counter, not a
    // success counter.
    expect(period?.callCount).toBe(1);

    // The failure is still on the ledger. An unlogged call — even a failed
    // one — would violate the "every call is logged" hard rule.
    const ledger = await readLedger(schoolId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0].success).toBe(false);
    expect(ledger[0].inputTokens).toBe(0);
    expect(ledger[0].errorMessage).toContain("simulated upstream failure");
  });

  it("a failed call leaves the budget fully usable by the next call", async () => {
    const schoolId = await makeSchool();
    port.behaviour = "throw";
    const service = new AiGenerationService(configStub(), port);
    await expect(
      service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT }),
    ).rejects.toThrow();

    port.behaviour = "ok";
    await service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT });

    const period = await readPeriod(schoolId);
    expect(period?.tokensReserved).toBe(ACTUAL_TOKENS);
    expect(period?.tokensActual).toBe(ACTUAL_TOKENS);
  });

  it("records a refusal as an unsuccessful call, but still counts its real tokens", async () => {
    const schoolId = await makeSchool();
    port.behaviour = "refuse";
    const service = new AiGenerationService(configStub(), port);

    await service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT });

    const ledger = await readLedger(schoolId);
    expect(ledger[0].success).toBe(false);
    expect(ledger[0].errorMessage).toBe("stop_reason=refusal");
    // A refusal is billable: the tokens were really spent.
    expect(ledger[0].inputTokens).toBe(100);
    const period = await readPeriod(schoolId);
    expect(period?.tokensActual).toBe(ACTUAL_TOKENS);
  });

  // -----------------------------------------------------------------------
  // The reason the enforcement is one conditional UPDATE and not a
  // read-then-write.
  // -----------------------------------------------------------------------
  it("enforces the cap exactly under concurrency — no overshoot from racing callers", async () => {
    // Budget admits exactly 3 reservations.
    const capacity = 3;
    const schoolId = await makeSchool({ budget: RESERVATION * capacity });
    const service = new AiGenerationService(configStub(), port);

    const attempts = 12;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT }),
      ),
    );

    const fulfilled = results.filter((r) => r.status === "fulfilled").length;
    const rejected = results.filter(
      (r) => r.status === "rejected" && (r.reason as RateLimitError)?.code === AI_ERROR_CODES.BUDGET_EXCEEDED,
    ).length;

    // A read-then-write implementation would let several racing callers all
    // observe "under budget" and overshoot here.
    expect(fulfilled).toBe(capacity);
    expect(rejected).toBe(attempts - capacity);
    expect(port.calls).toHaveLength(capacity);
  });

  it("does not apply the per-user daily cap to system-driven calls (no userId)", async () => {
    const schoolId = await makeSchool();
    const service = new AiGenerationService(configStub(), port);
    await service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT });
    await service.generate({ schoolId, prompt: TEST_PROMPT, userContent: USER_CONTENT });
    expect(port.calls).toHaveLength(2);
  });

  it("reports itself unconfigured when no API key is present, instead of throwing at construction", () => {
    // Fail-soft (phase-5.md D11): a missing key must degrade the feature, not
    // crash-loop the API for every school.
    const service = new AiGenerationService(configStub({ ANTHROPIC_API_KEY: "" }));
    expect(service.isConfigured()).toBe(false);
  });
});
