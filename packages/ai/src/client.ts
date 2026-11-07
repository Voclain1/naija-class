// THE ONLY FILE IN THIS REPO PERMITTED TO IMPORT @anthropic-ai/sdk.
//
// Enforced, not requested: packages/config/eslint/base.js has a
// `no-restricted-imports` rule banning `@anthropic-ai/sdk` everywhere except
// this path, with an allowlist entry naming this file specifically. That
// mirrors the existing ban on `basePrisma` outside the tenant client, and
// exists for the same reason — CLAUDE.md's AI hard rule says EVERY call to
// messages.create must be logged to ai_generations and must pass a budget
// check first. If a feature module could construct its own Anthropic client,
// that rule would be a convention rather than a guarantee, and the second AI
// slice would quietly bypass it.
//
// Everything above this layer talks to `AnthropicPort`, never to the SDK.
// That is also what makes budget/ledger behaviour testable without a live API
// key: the specs inject a fake port.

import Anthropic from "@anthropic-ai/sdk";

import type { ModelId } from "./models.js";

// One image attached to a request.
//
// `widthPx`/`heightPx` are REQUIRED, and that is deliberate rather than
// convenient: the budget reservation runs before the call and has no other
// way to price an image (see estimateImageTokens in ./models.ts). Making them
// optional would let a caller silently reserve nothing for a 4784-token
// image, which is precisely the hard-rule regression this contract exists to
// prevent. The upload path decodes them from the image header.
//
// `base64` is the raw base64 payload WITHOUT a data: URI prefix — the API
// takes the bytes, not a data URL, and a leaked "data:image/jpeg;base64,"
// prefix is a 400 that is annoying to diagnose.
//
// No `file_id` source type: @anthropic-ai/sdk@0.116.0 exposes FileImageSource
// only in the beta namespace, and we have no use for it anyway — every image
// in this product is sent exactly once and never retained (D3).
export interface AiImageInput {
  readonly mediaType: "image/jpeg" | "image/png" | "image/webp";
  readonly base64: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface AiCallRequest {
  readonly model: ModelId;
  readonly system?: string;
  readonly userContent: string;
  // Optional images, sent BEFORE the text block. Anthropic's vision docs are
  // explicit that image-then-text outperforms text-then-image, and for an
  // extraction prompt the ordering matters more than usual: the instructions
  // are about the image, so the model should have seen it first.
  //
  // PII WARNING: images are the one input channel in this codebase that can
  // legitimately carry student PII, and only for the single prompt named in
  // CLAUDE.md's PII-bearing prompt allowlist. If you are attaching an image
  // from any other prompt, stop and read that table.
  readonly images?: readonly AiImageInput[];
  readonly maxTokens: number;
  // Optional JSON Schema. When present the response is constrained to match
  // it (structured outputs), which removes the "model wandered off the output
  // format" failure mode that delimiter-parsing has. Preferred over asking for
  // sections in prose and parsing them: a lesson plan has five required
  // sections and a partial parse would silently write empty columns.
  //
  // Schema restrictions worth knowing: every object needs
  // `additionalProperties: false` and an explicit `required` list; recursive
  // schemas and numeric/string constraints (minimum, minLength, ...) are not
  // supported. First use of a given schema pays a one-time compilation cost,
  // then caches for 24h.
  readonly jsonSchema?: Record<string, unknown>;
}

export interface AiCallResult {
  readonly text: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  // "end_turn" | "max_tokens" | "refusal" | ... — surfaced rather than thrown
  // so the caller can write an accurate ledger row. A refusal is a real,
  // billable outcome, not an exception.
  readonly stopReason: string | null;
}

// ---------------------------------------------------------------------------
// Conversations with tools (FD-2a, docs/reviews/agentic-implementation-plan.md
// §3.3). A SEPARATE entry point, `converse`, rather than new optional fields on
// AiCallRequest: the single-call `create` path every shipped feature uses stays
// byte-for-byte what it was, and a conversation can never be half-built from a
// single-call request by accident.
//
// These types are the port's own, not the SDK's, on purpose: the ESLint ban on
// importing @anthropic-ai/sdk outside this file covers type imports too, so the
// rest of the app talks in these narrow shapes and only this file maps them.
//
// What this layer does NOT do (later PRs, by design): the step loop, budget
// reservation per step and the ai_generations row per step are FD-2b in
// AiGenerationService; tool permission checks and execution are FD-3a. The port
// only turns one request into one model call.
// ---------------------------------------------------------------------------

/**
 * A tool the model may call. Sent with `strict: true`, so the API guarantees the
 * call's input matches `inputSchema`: the schema must be an object schema with
 * `additionalProperties: false` (checked before sending). Tool choice is always
 * left to the model (`auto`): forced tool choice is rejected by newer models.
 */
export interface AiToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
}

/** A tool call the model asked for. `input` is parsed JSON; validate it before use. */
export interface AiToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** The outcome of one tool call, sent back on the next user turn. */
export interface AiToolResult {
  readonly toolUseId: string;
  readonly content: string;
  readonly isError?: boolean;
}

/**
 * An assistant turn as the model returned it, OPAQUE to callers. It must be sent
 * back unchanged on the next request: it can hold thinking blocks (with their
 * signatures) that a tool-use loop has to return exactly as received, and any
 * edit to them breaks the loop. Only `converse` creates one, and `converse`
 * refuses one it did not create. Deliberately not serialisable here: whether and
 * how a conversation is stored is decided later (plan §3.6, decision F-17).
 */
export interface AiAssistantTurn {
  readonly kind: "ai-assistant-turn";
}

export type AiConversationMessage =
  | { readonly role: "user"; readonly text: string }
  | { readonly role: "user"; readonly toolResults: readonly AiToolResult[] }
  | { readonly role: "assistant"; readonly turn: AiAssistantTurn };

export interface AiConversationRequest {
  readonly model: ModelId;
  readonly system?: string;
  readonly maxTokens: number;
  readonly messages: readonly AiConversationMessage[];
  readonly tools?: readonly AiToolDefinition[];
}

export interface AiConversationResult {
  /** Text blocks of the reply, joined. Empty on a refusal or a tool-only turn. */
  readonly text: string;
  /** Tool calls requested in this turn, in order. Empty unless stopReason is "tool_use". */
  readonly toolCalls: readonly AiToolCall[];
  /** Pass back as `{ role: "assistant", turn }` before the tool results. */
  readonly assistantTurn: AiAssistantTurn;
  readonly inputTokens: number;
  readonly outputTokens: number;
  // "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn" | ... —
  // surfaced, not thrown, exactly as AiCallResult does, so the ledger row is
  // accurate whatever happened.
  readonly stopReason: string | null;
}

// The seam. AiGenerationService depends on this interface only.
export interface AnthropicPort {
  create(req: AiCallRequest): Promise<AiCallResult>;
  // Optional so every existing fake port (one per AI feature spec) still
  // satisfies the interface. A caller that needs it checks for it.
  converse?(req: AiConversationRequest): Promise<AiConversationResult>;
}

/** Options for tests only: the real client needs neither. */
export interface AnthropicClientOptions {
  readonly fetch?: typeof fetch;
  readonly maxRetries?: number;
}

class AnthropicSdkPort implements AnthropicPort {
  private readonly client: Anthropic;

  constructor(apiKey: string, options: AnthropicClientOptions = {}) {
    this.client = new Anthropic({
      apiKey,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.maxRetries !== undefined ? { maxRetries: options.maxRetries } : {}),
    });
  }

  async converse(req: AiConversationRequest): Promise<AiConversationResult> {
    const tools = (req.tools ?? []).map(toSdkTool);
    assertUniqueToolNames(tools);
    const messages = toSdkMessages(req.messages);

    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      ...(tools.length > 0 ? { tools } : {}),
      messages,
    });

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");
    const toolCalls = response.content
      .filter((block): block is Extract<typeof block, { type: "tool_use" }> => block.type === "tool_use")
      .map((block) => ({ id: block.id, name: block.name, input: block.input }));

    return {
      text,
      toolCalls,
      assistantTurn: wrapAssistantTurn(response.content),
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason ?? null,
    };
  }

  async create(req: AiCallRequest): Promise<AiCallResult> {
    const response = await this.client.messages.create({
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.system ? { system: req.system } : {}),
      // output_config.format is the current parameter; the older top-level
      // `output_format` is deprecated API-wide.
      ...(req.jsonSchema
        ? { output_config: { format: { type: "json_schema" as const, schema: req.jsonSchema } } }
        : {}),
      messages: [{ role: "user", content: buildUserContent(req) }],
    });

    // response.content is a discriminated union; narrow before reading .text.
    // A refusal yields no text block at all, which is why this tolerates an
    // empty result instead of indexing content[0].
    const text = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("");

    return {
      text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason ?? null,
    };
  }
}

// Builds the user turn's content.
//
// Returns a bare string when there are no images — not a single-element block
// array — so every existing text-only prompt produces a byte-identical request
// to the one it produced before vision support landed. That matters for more
// than tidiness: prompt caching is a prefix match, and silently rewrapping
// five shipped prompts' content would invalidate every cached prefix in the
// product for no benefit.
function buildUserContent(req: AiCallRequest): Anthropic.MessageParam["content"] {
  if (!req.images || req.images.length === 0) return req.userContent;

  return [
    ...req.images.map((image) => ({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: image.mediaType,
        data: image.base64,
      },
    })),
    { type: "text" as const, text: req.userContent },
  ];
}

// ---------------------------------------------------------------------------
// Conversation mapping (FD-2a). Every check here throws BEFORE any request is
// sent: a malformed conversation is a programming error, and failing locally
// costs nothing, where a 400 from the API costs a round trip and, under FD-2b,
// a ledger row.
// ---------------------------------------------------------------------------

const ASSISTANT_TURN_CONTENT = Symbol("ai-assistant-turn-content");

interface AssistantTurnInternal extends AiAssistantTurn {
  readonly [ASSISTANT_TURN_CONTENT]: readonly Anthropic.ContentBlock[];
}

function wrapAssistantTurn(content: readonly Anthropic.ContentBlock[]): AiAssistantTurn {
  const turn: AssistantTurnInternal = { kind: "ai-assistant-turn", [ASSISTANT_TURN_CONTENT]: content };
  return Object.freeze(turn);
}

function unwrapAssistantTurn(turn: AiAssistantTurn): readonly Anthropic.ContentBlock[] {
  const content = (turn as Partial<AssistantTurnInternal>)[ASSISTANT_TURN_CONTENT];
  if (!content) {
    throw new Error("An assistant turn must be the one returned by converse(), passed back unchanged.");
  }
  return content;
}

const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

function toSdkTool(tool: AiToolDefinition): Anthropic.Tool {
  if (!TOOL_NAME.test(tool.name)) {
    throw new Error(`Tool name "${tool.name}" must be 1-64 letters, digits, "_" or "-".`);
  }
  if (tool.description.trim() === "") {
    throw new Error(`Tool "${tool.name}" needs a description.`);
  }
  // strict: true needs an object schema that forbids extra properties.
  const schema = tool.inputSchema;
  if (schema.type !== "object" || schema.additionalProperties !== false) {
    throw new Error(`Tool "${tool.name}" input schema must be { type: "object", additionalProperties: false, ... }.`);
  }
  return {
    name: tool.name,
    description: tool.description,
    input_schema: schema as Anthropic.Tool.InputSchema,
    strict: true,
  };
}

function assertUniqueToolNames(tools: readonly Anthropic.Tool[]): void {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (seen.has(tool.name)) throw new Error(`Tool "${tool.name}" is defined twice.`);
    seen.add(tool.name);
  }
}

function toSdkMessages(messages: readonly AiConversationMessage[]): Anthropic.MessageParam[] {
  if (messages.length === 0) throw new Error("A conversation needs at least one message.");
  if (messages[0]!.role !== "user") throw new Error("A conversation must start with a user message.");

  const out: Anthropic.MessageParam[] = [];
  // Tool calls from the most recent assistant turn that still need a result.
  let openCalls: Set<string> | null = null;

  for (const message of messages) {
    if (message.role === "assistant") {
      if (openCalls && openCalls.size > 0) {
        throw new Error("Every tool call needs a result before the next assistant turn.");
      }
      const content = unwrapAssistantTurn(message.turn);
      out.push({ role: "assistant", content: content as Anthropic.ContentBlockParam[] });
      const ids = content.filter((b) => b.type === "tool_use").map((b) => (b as Anthropic.ToolUseBlock).id);
      openCalls = new Set(ids);
      continue;
    }

    if ("toolResults" in message) {
      if (message.toolResults.length === 0) throw new Error("A tool-results message needs at least one result.");
      if (!openCalls) throw new Error("Tool results must follow the assistant turn that asked for them.");
      const results: Anthropic.ToolResultBlockParam[] = message.toolResults.map((result) => {
        if (!openCalls!.has(result.toolUseId)) {
          throw new Error(`Tool result for "${result.toolUseId}" matches no open call in the previous assistant turn.`);
        }
        openCalls!.delete(result.toolUseId);
        return {
          type: "tool_result",
          tool_use_id: result.toolUseId,
          content: result.content,
          ...(result.isError ? { is_error: true } : {}),
        };
      });
      if (openCalls.size > 0) {
        // The API rejects a turn that leaves a call unanswered; say which.
        throw new Error(`Missing tool results for: ${[...openCalls].join(", ")}.`);
      }
      out.push({ role: "user", content: results });
      continue;
    }

    if (openCalls && openCalls.size > 0) {
      throw new Error("Every tool call needs a result before the next user message.");
    }
    out.push({ role: "user", content: message.text });
  }
  return out;
}

// Returns null when no API key is configured, rather than throwing at import
// or boot time. This is the fail-soft behaviour locked as phase-5.md D11:
// a missing ANTHROPIC_API_KEY must make AI features report themselves
// disabled, NOT crash-loop the API for all six live schools. (There is no
// isolated staging environment — every "staging" deploy hits the production
// database — and a boot crash-loop from a missing env var has already
// happened once in this project.) Global boot-time env validation is
// deliberately a separate change with its own manual gate.
export function createAnthropicClient(
  apiKey: string | undefined | null,
  options?: AnthropicClientOptions,
): AnthropicPort | null {
  if (!apiKey || apiKey.trim() === "") return null;
  return new AnthropicSdkPort(apiKey, options);
}
