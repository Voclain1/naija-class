import { inspect } from "node:util";

import { describe, expect, it } from "vitest";

import {
  MODELS,
  createAnthropicClient,
  type AiConversationMessage,
  type AiToolDefinition,
  type AnthropicPort,
} from "@school-kit/ai";

// The AnthropicPort seam (packages/ai/src/client.ts), driven through the REAL
// SDK with a fake fetch: every assertion is on the exact JSON body the SDK
// would put on the wire, and on how a real response shape is read back. No
// network and no key are involved.
//
// FD-2a (docs/reviews/agentic-implementation-plan.md §3.3): `converse` adds
// conversations with tools. The first block pins the single-call `create` body
// so that change provably leaves every shipped feature's request untouched.

interface Captured {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

function fakeApi(responses: Record<string, unknown>[]) {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = responses.shift();
    if (!next) throw new Error("fake API: no response queued");
    return new Response(JSON.stringify(next), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const port = createAnthropicClient("sk-ant-test-not-real", { fetch: fetchImpl, maxRetries: 0 }) as AnthropicPort;
  return { port, calls };
}

function message(content: unknown[], stopReason: string, usage = { input_tokens: 11, output_tokens: 7 }) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: MODELS.HAIKU_4_5,
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage,
  };
}

const LOOKUP_TOOL: AiToolDefinition = {
  name: "grading_boundaries",
  description: "Returns the school's grade boundaries.",
  inputSchema: {
    type: "object",
    properties: { termId: { type: "string" } },
    required: [],
    additionalProperties: false,
  },
};

describe("create() — the single-call path is unchanged", () => {
  it("sends exactly model, max_tokens, system and one string user message for a text-only prompt", async () => {
    const { port, calls } = fakeApi([message([{ type: "text", text: "hello" }], "end_turn")]);
    const res = await port.create({ model: MODELS.HAIKU_4_5, system: "sys", userContent: "hi", maxTokens: 100 });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toMatch(/\/v1\/messages$/);
    expect(calls[0]!.body).toEqual({
      model: MODELS.HAIKU_4_5,
      max_tokens: 100,
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(res).toEqual({ text: "hello", inputTokens: 11, outputTokens: 7, stopReason: "end_turn" });
  });

  it("adds output_config only when a schema is given, and puts images before the text", async () => {
    const { port, calls } = fakeApi([message([{ type: "text", text: "{}" }], "end_turn")]);
    await port.create({
      model: MODELS.HAIKU_4_5,
      userContent: "read this",
      maxTokens: 50,
      jsonSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
      images: [{ mediaType: "image/png", base64: "AAAA", widthPx: 10, heightPx: 10 }],
    });
    expect(calls[0]!.body).toEqual({
      model: MODELS.HAIKU_4_5,
      max_tokens: 50,
      output_config: {
        format: { type: "json_schema", schema: { type: "object", properties: {}, required: [], additionalProperties: false } },
      },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
            { type: "text", text: "read this" },
          ],
        },
      ],
    });
    expect(calls[0]!.body).not.toHaveProperty("tools");
  });
});

describe("converse() — conversations with tools", () => {
  it("sends strict tools with no tool_choice, and reads back text, tool calls, usage and stop reason", async () => {
    const { port, calls } = fakeApi([
      message(
        [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "toolu_1", name: "grading_boundaries", input: { termId: "t1" } },
        ],
        "tool_use",
        { input_tokens: 40, output_tokens: 12 },
      ),
    ]);
    const res = await port.converse!({
      model: MODELS.HAIKU_4_5,
      system: "You help school staff.",
      maxTokens: 500,
      messages: [{ role: "user", text: "Why is 59 a C?" }],
      tools: [LOOKUP_TOOL],
    });

    expect(calls[0]!.body).toEqual({
      model: MODELS.HAIKU_4_5,
      max_tokens: 500,
      system: "You help school staff.",
      tools: [
        {
          name: "grading_boundaries",
          description: "Returns the school's grade boundaries.",
          input_schema: LOOKUP_TOOL.inputSchema,
          strict: true,
        },
      ],
      messages: [{ role: "user", content: "Why is 59 a C?" }],
    });
    expect(calls[0]!.body).not.toHaveProperty("tool_choice");
    expect(res.text).toBe("Let me check.");
    expect(res.toolCalls).toEqual([{ id: "toolu_1", name: "grading_boundaries", input: { termId: "t1" } }]);
    expect(res.inputTokens).toBe(40);
    expect(res.outputTokens).toBe(12);
    expect(res.stopReason).toBe("tool_use");
  });

  it("passes the assistant turn back unchanged — thinking block and signature included — then the tool results", async () => {
    const firstContent = [
      { type: "thinking", thinking: "", signature: "sig-abc" },
      { type: "tool_use", id: "toolu_1", name: "grading_boundaries", input: {} },
      { type: "tool_use", id: "toolu_2", name: "grading_boundaries", input: { termId: "t2" } },
    ];
    const { port, calls } = fakeApi([
      message(firstContent, "tool_use"),
      message([{ type: "text", text: "59 falls in C (50-59)." }], "end_turn"),
    ]);
    const first = await port.converse!({
      model: MODELS.HAIKU_4_5,
      maxTokens: 500,
      messages: [{ role: "user", text: "Why is 59 a C?" }],
      tools: [LOOKUP_TOOL],
    });

    const history: AiConversationMessage[] = [
      { role: "user", text: "Why is 59 a C?" },
      { role: "assistant", turn: first.assistantTurn },
      {
        role: "user",
        toolResults: [
          { toolUseId: "toolu_1", content: '{"C":[50,59]}' },
          { toolUseId: "toolu_2", content: "not permitted", isError: true },
        ],
      },
    ];
    const second = await port.converse!({ model: MODELS.HAIKU_4_5, maxTokens: 500, messages: history, tools: [LOOKUP_TOOL] });

    expect(calls[1]!.body.messages).toEqual([
      { role: "user", content: "Why is 59 a C?" },
      { role: "assistant", content: firstContent },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "toolu_1", content: '{"C":[50,59]}' },
          { type: "tool_result", tool_use_id: "toolu_2", content: "not permitted", is_error: true },
        ],
      },
    ]);
    expect(second.text).toBe("59 falls in C (50-59).");
    expect(second.toolCalls).toEqual([]);
  });

  it("surfaces a refusal and max_tokens as stop reasons, not exceptions", async () => {
    const { port } = fakeApi([message([], "refusal"), message([{ type: "text", text: "partial" }], "max_tokens")]);
    const refused = await port.converse!({ model: MODELS.HAIKU_4_5, maxTokens: 50, messages: [{ role: "user", text: "x" }] });
    expect(refused).toMatchObject({ text: "", toolCalls: [], stopReason: "refusal" });
    const cut = await port.converse!({ model: MODELS.HAIKU_4_5, maxTokens: 50, messages: [{ role: "user", text: "x" }] });
    expect(cut).toMatchObject({ text: "partial", stopReason: "max_tokens" });
  });

  it("omits tools when none are given", async () => {
    const { port, calls } = fakeApi([message([{ type: "text", text: "ok" }], "end_turn")]);
    await port.converse!({ model: MODELS.HAIKU_4_5, maxTokens: 50, messages: [{ role: "user", text: "x" }] });
    expect(calls[0]!.body).not.toHaveProperty("tools");
  });
});

describe("opaque assistant turns: nothing to log, nothing that survives a copy", () => {
  async function turnWithSecrets() {
    const api = fakeApi([
      message(
        [
          { type: "thinking", thinking: "THINKING-TEXT", signature: "SIG-SECRET" },
          { type: "text", text: "REPLY-TEXT" },
          { type: "tool_use", id: "toolu_1", name: "grading_boundaries", input: {} },
        ],
        "tool_use",
      ),
    ]);
    const res = await api.port.converse!({
      model: MODELS.HAIKU_4_5,
      maxTokens: 50,
      messages: [{ role: "user", text: "q" }],
      tools: [LOOKUP_TOOL],
    });
    return { ...api, turn: res.assistantTurn };
  }

  it("printing, serializing or cloning a turn shows no reply text, thinking or signature", async () => {
    const { turn } = await turnWithSecrets();
    for (const shown of [inspect(turn, { depth: 10, showHidden: true }), JSON.stringify(turn), inspect(structuredClone(turn))]) {
      expect(shown).not.toMatch(/SIG-SECRET|THINKING-TEXT|REPLY-TEXT|toolu_1/);
    }
    expect(JSON.parse(JSON.stringify(turn))).toEqual({ kind: "ai-assistant-turn" });
  });

  it("a serialized, cloned or spread copy is refused — as after a restart — and nothing is sent", async () => {
    const { port, calls, turn } = await turnWithSecrets();
    for (const copy of [JSON.parse(JSON.stringify(turn)), structuredClone(turn), { ...turn }]) {
      const before = calls.length;
      await expect(
        port.converse!({
          model: MODELS.HAIKU_4_5,
          maxTokens: 50,
          messages: [
            { role: "user", text: "q" },
            { role: "assistant", turn: copy },
            { role: "user", toolResults: [{ toolUseId: "toolu_1", content: "x" }] },
          ],
          tools: [LOOKUP_TOOL],
        }),
      ).rejects.toThrow(/copied, serialized or restored turn is refused/);
      expect(calls.length).toBe(before);
    }
  });
});

describe("converse() refuses a malformed conversation before sending anything", () => {
  async function toolTurn() {
    const api = fakeApi([
      message([{ type: "tool_use", id: "toolu_1", name: "grading_boundaries", input: {} }], "tool_use"),
    ]);
    const res = await api.port.converse!({
      model: MODELS.HAIKU_4_5,
      maxTokens: 50,
      messages: [{ role: "user", text: "q" }],
      tools: [LOOKUP_TOOL],
    });
    return { ...api, turn: res.assistantTurn };
  }

  async function rejectsWithoutSending(
    port: AnthropicPort,
    calls: Captured[],
    messages: AiConversationMessage[],
    pattern: RegExp,
    tools: AiToolDefinition[] = [LOOKUP_TOOL],
  ) {
    const before = calls.length;
    await expect(port.converse!({ model: MODELS.HAIKU_4_5, maxTokens: 50, messages, tools })).rejects.toThrow(pattern);
    expect(calls.length).toBe(before);
  }

  it("a result for a call the previous turn did not make", async () => {
    const { port, calls, turn } = await toolTurn();
    await rejectsWithoutSending(port, calls, [
      { role: "user", text: "q" },
      { role: "assistant", turn },
      { role: "user", toolResults: [{ toolUseId: "toolu_forged", content: "x" }] },
    ], /matches no open call/);
  });

  it("a call left without a result", async () => {
    const { port, calls, turn } = await toolTurn();
    await rejectsWithoutSending(port, calls, [
      { role: "user", text: "q" },
      { role: "assistant", turn },
      { role: "user", text: "never mind" },
    ], /needs a result/);
  });

  it("an assistant turn converse() did not create", async () => {
    const { port, calls } = await toolTurn();
    await rejectsWithoutSending(port, calls, [
      { role: "user", text: "q" },
      { role: "assistant", turn: { kind: "ai-assistant-turn" } },
    ], /passed back unchanged/);
  });

  it("a conversation that does not start with the user, or is empty", async () => {
    const { port, calls, turn } = await toolTurn();
    await rejectsWithoutSending(port, calls, [{ role: "assistant", turn }], /start with a user message/);
    await rejectsWithoutSending(port, calls, [], /at least one message/);
  });

  it("a tool schema that is not strict-compatible, a bad name, or a duplicate", async () => {
    const { port, calls } = await toolTurn();
    const loose = { ...LOOKUP_TOOL, inputSchema: { type: "object", properties: {} } };
    await rejectsWithoutSending(port, calls, [{ role: "user", text: "q" }], /additionalProperties: false/, [loose]);
    await rejectsWithoutSending(port, calls, [{ role: "user", text: "q" }], /Tool name/, [{ ...LOOKUP_TOOL, name: "bad name!" }]);
    await rejectsWithoutSending(port, calls, [{ role: "user", text: "q" }], /defined twice/, [LOOKUP_TOOL, LOOKUP_TOOL]);
  });
});
