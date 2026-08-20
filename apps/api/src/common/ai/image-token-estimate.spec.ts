import { describe, expect, it } from "vitest";

import { MODELS, estimateImageTokens } from "@school-kit/ai";

import { estimateInputTokens } from "./ai-generation.service.js";

// The budget RESERVATION's image arithmetic.
//
// CLAUDE.md's AI hard rule is "per-school monthly token budget enforced
// before the call, not after". For a text prompt the chars/4 approximation
// carries that. For an image it carries nothing at all — an image
// contributes zero characters — so before this arithmetic existed a
// ~4,784-visual-token register photo reserved as if it were free.
//
// settle() reconciles the LEDGER to the truth afterwards either way, which
// is exactly what made this easy to miss: nothing looks wrong in
// ai_generations. What is wrong is that the pre-call check let the school
// past its cap. These tests pin the fix.
//
// Numbers here come from Anthropic's published vision documentation
// (fetched 2026-08-20): cost is ceil(w/28) * ceil(h/28) visual tokens,
// capped per resolution tier — 4784 on high-resolution models (Claude 4.7
// and later, so Sonnet 5) and 1568 on standard ones (Haiku 4.5).

describe("estimateImageTokens", () => {
  it("computes patch count for an image below the tier cap", () => {
    // 280x280 => 10x10 patches. Well under either cap, so no clamping.
    expect(estimateImageTokens(MODELS.SONNET_5, 280, 280)).toBe(100);
  });

  it("rounds partial patches up", () => {
    // 281px spans 11 patches, not 10.04 — a partial patch is still a patch,
    // and rounding down would under-reserve on every non-multiple-of-28 image,
    // which is essentially all of them.
    expect(estimateImageTokens(MODELS.SONNET_5, 281, 281)).toBe(121);
  });

  it("clamps a phone photo to the high-resolution tier cap on Sonnet 5", () => {
    // A 12MP phone photo (4032x3024) is far above the tier's limits, so the
    // API downsizes it server-side before charging. The cap is therefore an
    // accurate ceiling rather than a guess: whatever we send, we are never
    // billed more than this.
    expect(estimateImageTokens(MODELS.SONNET_5, 4032, 3024)).toBe(4784);
  });

  it("clamps the same photo to the much lower standard-tier cap on Haiku", () => {
    // Roughly a third of Sonnet 5's budget for the identical image — the
    // pixel-detail difference behind the model choice in
    // smart-student-import.md §2.
    expect(estimateImageTokens(MODELS.HAIKU_4_5, 4032, 3024)).toBe(1568);
  });

  it("charges the FULL tier cap when dimensions could not be decoded", () => {
    // The decoder returns null for an exotic-but-valid header, and the
    // caller passes 0. Charging the cap is the safe direction; charging zero
    // would reinstate the exact bug this module exists to prevent.
    expect(estimateImageTokens(MODELS.SONNET_5, 0, 0)).toBe(4784);
    expect(estimateImageTokens(MODELS.HAIKU_4_5, -1, 100)).toBe(1568);
    expect(estimateImageTokens(MODELS.SONNET_5, Number.NaN, 100)).toBe(4784);
  });
});

describe("estimateInputTokens", () => {
  it("is unchanged for text-only calls", () => {
    // Every shipped prompt takes this path. The image work must not move
    // these numbers, or five live features' reservations shift for no reason.
    const text = "x".repeat(400);
    expect(estimateInputTokens(undefined, text)).toBe(116);
    expect(estimateInputTokens("y".repeat(400), text)).toBe(216);
  });

  it("adds visual tokens on top of the text estimate", () => {
    const text = "x".repeat(400);
    const textOnly = estimateInputTokens(undefined, text);
    const withImage = estimateInputTokens(undefined, text, MODELS.SONNET_5, [
      { mediaType: "image/jpeg", base64: "", widthPx: 4032, heightPx: 3024 },
    ]);
    expect(withImage).toBe(textOnly + 4784);
  });

  it("sums across multiple images", () => {
    const withTwo = estimateInputTokens("", "", MODELS.SONNET_5, [
      { mediaType: "image/jpeg", base64: "", widthPx: 280, heightPx: 280 },
      { mediaType: "image/png", base64: "", widthPx: 280, heightPx: 280 },
    ]);
    expect(withTwo).toBe(estimateInputTokens("", "") + 200);
  });

  it("prices the same image differently per model", () => {
    const image = [
      { mediaType: "image/jpeg" as const, base64: "", widthPx: 4032, heightPx: 3024 },
    ];
    const onSonnet = estimateInputTokens("", "", MODELS.SONNET_5, image);
    const onHaiku = estimateInputTokens("", "", MODELS.HAIKU_4_5, image);
    expect(onSonnet).toBeGreaterThan(onHaiku);
    expect(onSonnet - onHaiku).toBe(4784 - 1568);
  });

  it("throws rather than silently under-reserving when images arrive without a model", () => {
    // Unreachable through generate(), which always passes the prompt's model.
    // It throws anyway because the alternative — quietly falling back to the
    // text-only estimate — restores the original bug in the one code path
    // most likely to hit it, and does so invisibly.
    expect(() =>
      estimateInputTokens(undefined, "hello", undefined, [
        { mediaType: "image/jpeg", base64: "", widthPx: 100, heightPx: 100 },
      ]),
    ).toThrow(/images supplied without a model/i);
  });

  it("does not throw for an empty image array", () => {
    // "No images" and "images I cannot price" are different situations, and
    // only the second is a bug.
    expect(() => estimateInputTokens(undefined, "hello", undefined, [])).not.toThrow();
  });

  it("reserves realistically for a full 40-student register scan", () => {
    // The end-to-end sanity check behind smart-student-import.md §4's cost
    // table. A real scan is ~800 tokens of prompt text plus a capped image;
    // if this drifts far from ~5,600 input tokens, the published per-scan
    // cost estimate and the "~192 scans/month" budget headroom figure are
    // both wrong and the doc needs revisiting.
    const estimate = estimateInputTokens(
      "s".repeat(2600), // system prompt
      "u".repeat(600), // rendered per-call text
      MODELS.SONNET_5,
      [{ mediaType: "image/jpeg", base64: "", widthPx: 4032, heightPx: 3024 }],
    );
    expect(estimate).toBeGreaterThan(5_000);
    expect(estimate).toBeLessThan(6_200);
  });
});
