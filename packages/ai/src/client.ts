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

export interface AiCallRequest {
  readonly model: ModelId;
  readonly system?: string;
  readonly userContent: string;
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

// The seam. AiGenerationService depends on this interface only.
export interface AnthropicPort {
  create(req: AiCallRequest): Promise<AiCallResult>;
}

class AnthropicSdkPort implements AnthropicPort {
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
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
      messages: [{ role: "user", content: req.userContent }],
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

// Returns null when no API key is configured, rather than throwing at import
// or boot time. This is the fail-soft behaviour locked as phase-5.md D11:
// a missing ANTHROPIC_API_KEY must make AI features report themselves
// disabled, NOT crash-loop the API for all six live schools. (There is no
// isolated staging environment — every "staging" deploy hits the production
// database — and a boot crash-loop from a missing env var has already
// happened once in this project.) Global boot-time env validation is
// deliberately a separate change with its own manual gate.
export function createAnthropicClient(apiKey: string | undefined | null): AnthropicPort | null {
  if (!apiKey || apiKey.trim() === "") return null;
  return new AnthropicSdkPort(apiKey);
}
