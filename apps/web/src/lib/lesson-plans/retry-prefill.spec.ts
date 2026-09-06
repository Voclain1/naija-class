import { describe, expect, it } from "vitest";

import { buildRetryHref, readRetryPrefill, type RetryInputs } from "./retry-prefill";

// D42 — the retry path, both ends.
//
// What this defends: a teacher whose topic was not found in their scheme of
// work clicks "Try different wording" and lands on the create form. If the
// link drops their objectives, or the parser reads a parameter under a
// different name, the retry silently discards work they already did — and it
// discards it at the exact moment they have been told something went wrong,
// which is the worst possible moment to lose their input.
//
// The round-trip assertions are the point. Testing buildRetryHref and
// readRetryPrefill separately would pass even if both agreed on a misspelt
// parameter name.

const FULL: RetryInputs = {
  topic: "JSS3 summary writing lesson note with examples",
  classLevelId: "11111111-1111-4111-8111-111111111111",
  subjectId: "22222222-2222-4222-8222-222222222222",
  objectives: "Pupils should be able to summarise a passage in three sentences.",
  durationMinutes: 45,
};

describe("D42 retry link — round trip", () => {
  it("carries every input back unchanged", () => {
    expect(readRetryPrefill(new URL(buildRetryHref(FULL), "http://x").search)).toEqual(FULL);
  });

  it("survives the characters teachers actually type", () => {
    // Ampersands, quotes and slashes are exactly what breaks hand-built query
    // strings. A topic like this is not exotic — "Simile, metaphor & irony" is
    // an ordinary way to write it.
    const awkward: RetryInputs = {
      ...FULL,
      topic: 'Simile, metaphor & personification — "figures of speech" (poetry/prose)',
      objectives: "Identify 3+ devices; explain each; use one in a sentence 50% of the time",
    };
    const back = readRetryPrefill(new URL(buildRetryHref(awkward), "http://x").search);
    expect(back?.topic).toBe(awkward.topic);
    expect(back?.objectives).toBe(awkward.objectives);
  });

  it("omits optional fields rather than sending them empty", () => {
    const minimal: RetryInputs = { ...FULL, objectives: null, durationMinutes: null };
    const href = buildRetryHref(minimal);
    expect(href).not.toContain("objectives=");
    expect(href).not.toContain("duration=");
    expect(readRetryPrefill(new URL(href, "http://x").search)).toEqual(minimal);
  });

  it("points at the create form, not at the plan it came from", () => {
    expect(buildRetryHref(FULL).startsWith("/teacher/lesson-plans?")).toBe(true);
  });
});

describe("D42 retry link — reading a visit that is not a retry", () => {
  it("returns null for an ordinary visit", () => {
    expect(readRetryPrefill("")).toBeNull();
    expect(readRetryPrefill("?")).toBeNull();
  });

  it("returns null when a topic is absent, even if other params are present", () => {
    // A stray query string must not pre-fill a form. `topic` is the marker for
    // a retry, not just one field among several.
    expect(readRetryPrefill("?classLevelId=abc&subjectId=def&duration=40")).toBeNull();
  });

  it("returns null for a blank topic", () => {
    expect(readRetryPrefill("?topic=%20%20")).toBeNull();
  });

  it("falls back to null duration rather than NaN", () => {
    // NaN in a number input renders as an empty field the form cannot submit,
    // and the teacher gets a validation error for something they never typed.
    expect(readRetryPrefill("?topic=x&duration=abc")?.durationMinutes).toBeNull();
    expect(readRetryPrefill("?topic=x&duration=0")?.durationMinutes).toBeNull();
    expect(readRetryPrefill("?topic=x")?.durationMinutes).toBeNull();
  });
});
