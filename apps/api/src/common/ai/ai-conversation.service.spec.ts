import { Logger } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MODELS,
  type AiAssistantTurn,
  type AiCallRequest,
  type AiCallResult,
  type AiConversationRequest,
  type AiConversationResult,
  type AiToolCall,
  type AiToolDefinition,
  type AnthropicPort,
  type PromptDefinition,
} from "@school-kit/ai";
import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, InternalError } from "@school-kit/types";

import {
  AiGenerationService,
  TOOL_FAILED_TEXT,
  estimateConversationInput,
  type ConversationTurnParams,
} from "./ai-generation.service.js";
import { AI_ERROR_CODES, DEFAULT_USER_DAILY_CALL_CAP, TOOL_USE_OVERHEAD_TOKENS, currentPeriodStart } from "./ai.constants.js";

// FD-2b — runConversationTurn(), the budgeted, ledgered conversation loop
// (docs/reviews/agentic-implementation-plan.md §3.3, §4.3). Real Postgres for
// the budget and the ledger, as in ai-generation.service.spec.ts; a scripted
// fake port for the model, so "the call was never made" is observable.

type Step = Partial<AiConversationResult> & { stopReason: string | null } | Error;

class ScriptedPort implements AnthropicPort {
  readonly requests: AiConversationRequest[] = [];
  constructor(private readonly script: Step[]) {}

  async create(_req: AiCallRequest): Promise<AiCallResult> {
    throw new Error("create() must not be used by a conversation");
  }

  async converse(req: AiConversationRequest): Promise<AiConversationResult> {
    // Snapshot the messages: the service appends to its array after the call.
    this.requests.push({ ...req, messages: [...req.messages] });
    const next = this.script.shift();
    if (!next) throw new Error("script exhausted");
    if (next instanceof Error) throw next;
    const turn: AiAssistantTurn = Object.freeze({ kind: "ai-assistant-turn" as const });
    return {
      text: "",
      toolCalls: [],
      assistantTurn: turn,
      inputTokens: 100,
      outputTokens: 20,
      ...next,
    };
  }
}

const configStub = (overrides: Record<string, string> = {}) =>
  ({ get: (key: string) => overrides[key] }) as unknown as ConfigService;

const PROMPT: PromptDefinition = { name: "spec-conversation", version: "1", model: MODELS.HAIKU_4_5, maxTokens: 100 };

const TOOL: AiToolDefinition = {
  name: "lookup",
  description: "Looks something up.",
  inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
};

const call = (id: string): AiToolCall => ({ id, name: "lookup", input: {} });
const toolStep = (...ids: string[]): Step => ({ stopReason: "tool_use", toolCalls: ids.map(call) });
const answer = (text: string): Step => ({ stopReason: "end_turn", text });

const runId = Math.random().toString(36).slice(2, 8);
const schoolIds: string[] = [];

async function makeSchool(budget = 1_000_000) {
  const s = await basePrisma.school.create({
    data: { name: `AI Turn ${runId}`, slug: `ai-turn-${runId}-${schoolIds.length}`, aiEnabled: true, aiMonthlyTokenBudget: budget },
    select: { id: true },
  });
  schoolIds.push(s.id);
  return s.id;
}

const ledger = (schoolId: string) =>
  withTenant(schoolId, (db) => db.aIGeneration.findMany({ where: { schoolId }, orderBy: { createdAt: "asc" } }));

const period = (schoolId: string) =>
  withTenant(schoolId, (db) =>
    db.aIBudgetPeriod.findUnique({ where: { schoolId_periodStart: { schoolId, periodStart: currentPeriodStart() } } }),
  );

function params(schoolId: string, over: Partial<ConversationTurnParams> = {}): ConversationTurnParams {
  return {
    schoolId,
    userId: null,
    prompt: PROMPT,
    system: "You help school staff.",
    history: [{ role: "user", text: "How do I add a term?" }],
    tools: [TOOL],
    executeTool: async (c) => ({ toolUseId: c.id, content: "result" }),
    ...over,
  };
}

describe("runConversationTurn — one ledger row per model call, budget before every call", () => {
  afterAll(async () => {
    for (const id of schoolIds) {
      await withTenant(id, async (db) => {
        await db.aIGeneration.deleteMany({ where: { schoolId: id } });
        await db.aIBudgetPeriod.deleteMany({ where: { schoolId: id } });
      });
      await basePrisma.school.delete({ where: { id } });
    }
  });

  it("a one-step answer: one call, one row with prompt name, version and model", async () => {
    const schoolId = await makeSchool();
    const port = new ScriptedPort([answer("Go to Settings.")]);
    const res = await new AiGenerationService(configStub(), port).runConversationTurn(params(schoolId));

    expect(res).toEqual({ outcome: "answered", text: "Go to Settings.", steps: 1, toolCallNames: [], inputTokens: 100, outputTokens: 20 });
    const rows = await ledger(schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ promptName: "spec-conversation", promptVersion: "1", model: MODELS.HAIKU_4_5, success: true, inputTokens: 100, outputTokens: 20 });
  });

  it("three steps: tools run between calls, results go back after the opaque turn, rows = calls", async () => {
    const schoolId = await makeSchool();
    const port = new ScriptedPort([toolStep("a", "b"), toolStep("c"), answer("Done.")]);
    const executed: string[] = [];
    const res = await new AiGenerationService(configStub(), port).runConversationTurn(
      params(schoolId, { executeTool: async (c) => (executed.push(c.id), { toolUseId: c.id, content: `r-${c.id}` }) }),
    );

    expect(res).toMatchObject({ outcome: "answered", steps: 3, toolCallNames: ["lookup", "lookup", "lookup"] });
    expect(executed).toEqual(["a", "b", "c"]);
    expect(await ledger(schoolId)).toHaveLength(port.requests.length);
    const third = port.requests[2]!.messages;
    expect(third).toHaveLength(5);
    expect(third[1]).toMatchObject({ role: "assistant", turn: { kind: "ai-assistant-turn" } });
    expect(third[2]).toEqual({
      role: "user",
      toolResults: [
        { toolUseId: "a", content: "r-a" },
        { toolUseId: "b", content: "r-b" },
      ],
    });
  });

  it("the step ceiling with calls still pending stops without another model call or running those tools", async () => {
    const schoolId = await makeSchool();
    const port = new ScriptedPort([toolStep("1"), toolStep("2"), toolStep("3"), toolStep("4"), answer("never")]);
    const executed: string[] = [];
    const res = await new AiGenerationService(configStub(), port).runConversationTurn(
      params(schoolId, { executeTool: async (c) => (executed.push(c.id), { toolUseId: c.id, content: "r" }) }),
    );

    expect(res.outcome).toBe("step_limit");
    expect(port.requests).toHaveLength(4);
    expect(executed).toEqual(["1", "2", "3"]);
    expect(await ledger(schoolId)).toHaveLength(4);
  });

  it("budget exhausted before step 2: ends with budget_exhausted, one call, one row, none for the call not made", async () => {
    // Step 1 fits (estimate ~ 520 + maxTokens 100 <= 700) and settles to 610
    // actual; step 2 would reserve 610 + ... + 100 on top, which cannot fit.
    const schoolId = await makeSchool(700);
    const port = new ScriptedPort([{ ...(toolStep("a") as object), stopReason: "tool_use", inputTokens: 600, outputTokens: 10 }, answer("never")]);
    const res = await new AiGenerationService(configStub(), port).runConversationTurn(params(schoolId));

    expect(res).toMatchObject({ outcome: "budget_exhausted", steps: 1 });
    expect(port.requests).toHaveLength(1);
    expect(await ledger(schoolId)).toHaveLength(1);
    expect((await period(schoolId))?.tokensReserved).toBe(610);
  });

  it("the per-user daily cap counts steps: one call left gives one step, then user_rate_limited", async () => {
    const schoolId = await makeSchool();
    const userId = `user-${runId}`;
    await withTenant(schoolId, (db) =>
      db.aIGeneration.createMany({
        data: Array.from({ length: DEFAULT_USER_DAILY_CALL_CAP - 1 }, () => ({
          schoolId, userId, model: MODELS.HAIKU_4_5, promptName: "seed", promptVersion: "1",
          inputTokens: 0, outputTokens: 0, latencyMs: 0, costMicroUsd: 0, pricedAtVersion: "seed", success: true,
        })),
      }),
    );
    const port = new ScriptedPort([toolStep("a"), answer("never")]);
    const res = await new AiGenerationService(configStub(), port).runConversationTurn(params(schoolId, { userId }));

    expect(res).toMatchObject({ outcome: "user_rate_limited", steps: 1 });
    expect(port.requests).toHaveLength(1);
  });

  it("the per-turn input ceiling stops before the call that would breach it — even the first", async () => {
    const schoolId = await makeSchool();
    const port = new ScriptedPort([answer("never")]);
    const res = await new AiGenerationService(configStub(), port).runConversationTurn(params(schoolId, { maxInputTokensPerTurn: 100 }));
    expect(res).toMatchObject({ outcome: "turn_token_limit", steps: 0 });
    expect(port.requests).toHaveLength(0);
    expect(await ledger(schoolId)).toHaveLength(0);

    const school2 = await makeSchool();
    const port2 = new ScriptedPort([{ ...(toolStep("a") as object), stopReason: "tool_use", inputTokens: 900, outputTokens: 50 }, answer("never")]);
    const res2 = await new AiGenerationService(configStub(), port2).runConversationTurn(params(school2, { maxInputTokensPerTurn: 1_500 }));
    expect(res2).toMatchObject({ outcome: "turn_token_limit", steps: 1 });
    expect(port2.requests).toHaveLength(1);
  });

  it("refusal, max_tokens and pause_turn end the turn with outcomes; a refusal row is success=false", async () => {
    const schoolId = await makeSchool();
    const svc = (s: Step[]) => new AiGenerationService(configStub(), new ScriptedPort(s));
    expect((await svc([{ stopReason: "refusal" }]).runConversationTurn(params(schoolId))).outcome).toBe("refused");
    expect((await svc([{ stopReason: "max_tokens", text: "part" }]).runConversationTurn(params(schoolId))).outcome).toBe("truncated");
    expect((await svc([{ stopReason: "pause_turn" }]).runConversationTurn(params(schoolId))).outcome).toBe("unexpected_stop");
    const rows = await ledger(schoolId);
    expect(rows.find((r) => r.errorMessage === "stop_reason=refusal")?.success).toBe(false);
  });

  it("a port failure: row success=false with a code only, reservation released, content-free InternalError", async () => {
    const schoolId = await makeSchool();
    const secret = new TypeError("provider echoed SECRET-PROMPT-TEXT");
    const err = await new AiGenerationService(configStub(), new ScriptedPort([secret]))
      .runConversationTurn(params(schoolId))
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(InternalError);
    expect(JSON.stringify(err)).not.toContain("SECRET-PROMPT-TEXT");
    const rows = await ledger(schoolId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ success: false, errorMessage: "TypeError" });
    expect((await period(schoolId))?.tokensReserved).toBe(0);
  });

  it("platform switch off, no key, or a port without converse(): refused before any reservation", async () => {
    const schoolId = await makeSchool();
    const port = new ScriptedPort([answer("never")]);
    await expect(new AiGenerationService(configStub({ AI_ENABLED: "false" }), port).runConversationTurn(params(schoolId))).rejects.toBeInstanceOf(ForbiddenError);
    const createOnly: AnthropicPort = { create: async () => ({ text: "", inputTokens: 0, outputTokens: 0, stopReason: "end_turn" }) };
    await expect(new AiGenerationService(configStub(), createOnly).runConversationTurn(params(schoolId))).rejects.toMatchObject({ code: AI_ERROR_CODES.NOT_CONFIGURED });
    expect(port.requests).toHaveLength(0);
    expect(await ledger(schoolId)).toHaveLength(0);
  });

  it("history must be text only and end with the user's message", async () => {
    const schoolId = await makeSchool();
    const port = new ScriptedPort([answer("never")]);
    const svc = new AiGenerationService(configStub(), port);
    const turn: AiAssistantTurn = { kind: "ai-assistant-turn" };
    await expect(svc.runConversationTurn(params(schoolId, { history: [{ role: "user", text: "q" }, { role: "assistant", turn }, { role: "user", text: "q2" }] }))).rejects.toThrow(/text only/);
    await expect(svc.runConversationTurn(params(schoolId, { history: [{ role: "user", text: "q" }, { role: "assistant", text: "a" }] }))).rejects.toThrow(/ending with the user's message/);
    expect(port.requests).toHaveLength(0);
  });

  it("the result carries no opaque turn, and only the documented fields", async () => {
    const schoolId = await makeSchool();
    const res = await new AiGenerationService(configStub(), new ScriptedPort([toolStep("a"), answer("ok")])).runConversationTurn(params(schoolId));
    expect(Object.keys(res).sort()).toEqual(["inputTokens", "outcome", "outputTokens", "steps", "text", "toolCallNames"]);
    expect(JSON.stringify(res)).not.toContain("ai-assistant-turn");
  });
});

describe("runConversationTurn — no conversation content in logs or the ledger", () => {
  const captured: string[] = [];
  beforeEach(() => {
    captured.length = 0;
    for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        captured.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(" "));
      });
    }
  });
  afterEach(() => vi.restoreAllMocks());

  it("planted markers in system, history, tool output, a thrown tool error and the reply appear in no log line or ledger field", async () => {
    const schoolId = await makeSchool();
    const port = new ScriptedPort([toolStep("a", "b"), answer("REPLY-MARK")]);
    const res = await new AiGenerationService(configStub(), port).runConversationTurn(
      params(schoolId, {
        system: "SYSTEM-MARK",
        history: [{ role: "user", text: "HISTORY-MARK" }],
        executeTool: async (c) => {
          if (c.id === "b") throw new Error("TOOL-ERROR-MARK");
          return { toolUseId: c.id, content: "TOOL-OUTPUT-MARK" };
        },
      }),
    );

    expect(res.outcome).toBe("answered");
    // The failing tool's result is the fixed text, not its error.
    expect(port.requests[1]!.messages[2]).toEqual({
      role: "user",
      toolResults: [
        { toolUseId: "a", content: "TOOL-OUTPUT-MARK" },
        { toolUseId: "b", content: TOOL_FAILED_TEXT, isError: true },
      ],
    });
    expect(captured.length).toBeGreaterThan(0);
    const logs = captured.join("\n");
    for (const mark of ["SYSTEM-MARK", "HISTORY-MARK", "TOOL-OUTPUT-MARK", "TOOL-ERROR-MARK", "REPLY-MARK", "ai-assistant-turn"]) {
      expect(logs).not.toContain(mark);
    }
    const rows = await ledger(schoolId);
    expect(JSON.stringify(rows)).not.toMatch(/SYSTEM-MARK|HISTORY-MARK|TOOL-OUTPUT-MARK|TOOL-ERROR-MARK|REPLY-MARK/);
  });
});

describe("estimateConversationInput", () => {
  it("grows with system, history and tool schemas, and adds the tool overhead only when tools are offered", () => {
    const base = estimateConversationInput("s", [{ role: "user", text: "q" }], []);
    const longer = estimateConversationInput("s".repeat(400), [{ role: "user", text: "q".repeat(400) }], []);
    const withTool = estimateConversationInput("s", [{ role: "user", text: "q" }], [TOOL]);
    expect(base).toBe(Math.ceil(2 / 4) + 16);
    expect(longer).toBe(Math.ceil(800 / 4) + 16);
    expect(withTool - base).toBeGreaterThan(TOOL_USE_OVERHEAD_TOKENS);
  });
});
