// D42 — the retry path's data, as pure functions.
//
// Extracted from the two components that use it because apps/web's Vitest
// config is node-only and covers "PURE logic extracted out of components"
// (see vitest.config.ts). The alternative was leaving a link-building and a
// query-parsing step untested on both ends, which is precisely where a retry
// silently loses the teacher's objectives or duration.
//
// The pair is written to ROUND-TRIP: readRetryPrefill(buildRetryHref(x)) must
// reproduce x. That is the property worth testing, and it is stronger than
// asserting either half in isolation — a shared misspelling of a parameter
// name would pass two separate tests and fail the round trip.

export interface RetryInputs {
  readonly topic: string;
  readonly classLevelId: string;
  readonly subjectId: string;
  readonly objectives: string | null;
  readonly durationMinutes: number | null;
}

/** The create form, pre-filled with what the teacher already asked for. */
export function buildRetryHref(inputs: RetryInputs): string {
  const params = new URLSearchParams({
    topic: inputs.topic,
    classLevelId: inputs.classLevelId,
    subjectId: inputs.subjectId,
  });
  // Omitted rather than sent empty: an empty `objectives=` would round-trip to
  // "" and overwrite nothing, but it would also show as a blank filled field,
  // implying the teacher had entered something they had not.
  if (inputs.objectives) params.set("objectives", inputs.objectives);
  if (inputs.durationMinutes) params.set("duration", String(inputs.durationMinutes));
  return `/teacher/lesson-plans?${params.toString()}`;
}

/**
 * Read a retry link back. Returns null when this is an ordinary visit.
 *
 * `topic` is the marker for a retry, not merely one of the fields: a link with
 * a class level but no topic is not a retry, and treating it as one would
 * pre-fill a form from a stray query string.
 */
export function readRetryPrefill(search: string): RetryInputs | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const topic = params.get("topic");
  if (!topic || !topic.trim()) return null;

  const duration = Number.parseInt(params.get("duration") ?? "", 10);
  return {
    topic,
    classLevelId: params.get("classLevelId") ?? "",
    subjectId: params.get("subjectId") ?? "",
    objectives: params.get("objectives"),
    // A non-numeric or absent duration falls back to null so the form keeps its
    // own default rather than rendering NaN in a number field.
    durationMinutes: Number.isFinite(duration) && duration > 0 ? duration : null,
  };
}
