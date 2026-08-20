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
