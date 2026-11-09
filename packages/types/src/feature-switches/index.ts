import { z } from "zod";

// Per-school feature switches (2026-11-06, docs/modules/feature-switches.md).
//
// The rollout control for agentic features
// (docs/reviews/agentic-implementation-plan.md, first delivery FD-1). Each
// switch is stored in `schools.feature_switches` (JSONB) and is set only by
// the platform operator. Three rules hold everywhere:
//
//   1. OFF BY DEFAULT. A key with no entry, or with anything other than
//      `true`, is off. No migration and no seed turns a key on.
//   2. THE PLATFORM WINS. A key named in the API's `FEATURES_DISABLED`
//      environment variable (or "*") is off for every school, whatever the
//      school's entry says.
//   3. THE KEY LIST IS CODE. Adding a key is a change to FEATURE_KEYS below,
//      reviewed like any other. An unknown key is rejected on write and
//      ignored on read, so a stale or hand-edited entry can never switch on
//      something this build does not know.

export const FEATURE_KEYS = [
  // The help and settings assistant for staff (plan item 4A). Nothing reads
  // this key yet: the assistant itself is not built, and the switch stays off
  // for every school until the owner approves a pilot.
  "assistant-help",
  "assistant-billing",
  // Reviewed student intake (docs/modules/student-intake-proposals.md):
  // prepare a batch, review the server's preview, confirm once. No model is
  // involved; the switch is the rollout control for the new endpoints only.
  // POST /students/bulk is not behind it.
  "student-intake",
  // Durable fee reminder campaigns (docs/modules/reminder-campaigns.md):
  // reviewed selection, confirmed once, sent through a journal. No model.
  // POST /finance/debtors/remind is not behind it. Turning it off also halts
  // running campaigns before their next send.
  "reminder-campaigns",
  // Reviewed corrections to existing students' names, date of birth, gender
  // and email (docs/modules/student-corrections.md). No model. PATCH
  // /students/:id is not behind it.
  "student-corrections",
  // The SchoolKit Assistant workspace panel in the staff shell
  // (docs/modules/assistant-workspace.md). Routes requests locally, with no
  // model, into the four reviewed workflows above; each still needs its own
  // switch. Off by default.
  "assistant-workspace",
  // Model-backed understanding for the SchoolKit Assistant
  // (docs/modules/assistant-workspace.md, "Model orchestration"): staff text
  // goes to the `assistant-orchestrator` prompt. PENDING OWNER APPROVAL of its
  // own allowlist row; the API also refuses it in production until that
  // approval is recorded in code. Off by default and for every school.
  "assistant-model-routing",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const featureKeySchema = z.enum(FEATURE_KEYS);

/** Every key resolved to on or off. */
export type FeatureSwitchMap = Record<FeatureKey, boolean>;

/** A short human label per key, for the operator's screens and audit lines. */
export const FEATURE_LABELS: Record<FeatureKey, string> = {
  "assistant-help": "Help assistant",
  "assistant-billing": "Invoice assistant",
  "student-intake": "Reviewed student intake",
  "reminder-campaigns": "Fee reminder campaigns",
  "student-corrections": "Reviewed student corrections",
  "assistant-workspace": "SchoolKit Assistant",
  "assistant-model-routing": "SchoolKit Assistant: AI understanding (pending approval)",
};

/** Narrows an arbitrary string (an audit row, an env entry) to a known key. */
export function isFeatureKey(value: unknown): value is FeatureKey {
  return typeof value === "string" && (FEATURE_KEYS as readonly string[]).includes(value);
}

/**
 * Reads a stored `feature_switches` value leniently: anything that is not an
 * object, any unknown key, and any value other than the boolean `true` reads
 * as off. Never throws, because a malformed row must fail closed, not take a
 * request down.
 */
export function parseFeatureSwitches(raw: unknown): FeatureSwitchMap {
  const out = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as FeatureSwitchMap;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const key of FEATURE_KEYS) {
    out[key] = (raw as Record<string, unknown>)[key] === true;
  }
  return out;
}

/**
 * Parses the `FEATURES_DISABLED` environment variable: a comma-separated list
 * of keys, or "*" for all of them. Unknown names are ignored (and reported
 * back so the caller can log them), never treated as "*".
 */
export function parseDisabledFeatures(raw: string | undefined | null): {
  all: boolean;
  keys: ReadonlySet<FeatureKey>;
  unknown: readonly string[];
} {
  const parts = (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const all = parts.includes("*");
  const keys = new Set<FeatureKey>();
  const unknown: string[] = [];
  for (const p of parts) {
    if (p === "*") continue;
    if (isFeatureKey(p)) keys.add(p);
    else unknown.push(p);
  }
  return { all, keys, unknown };
}

/** The one precedence rule: the platform's off beats the school's on. */
export function resolveFeature(input: { platformDisabled: boolean; schoolValue: boolean }): boolean {
  return !input.platformDisabled && input.schoolValue;
}

// PATCH /platform-admin/schools/:schoolId/features — one key at a time, so
// every change is one audit row naming exactly what moved.
export const platformAdminSetFeatureSchema = z
  .object({
    key: featureKeySchema,
    enabled: z.boolean(),
  })
  .strict();

export type PlatformAdminSetFeatureInput = z.infer<typeof platformAdminSetFeatureSchema>;

export interface PlatformAdminSetFeatureResponse {
  schoolId: string;
  /** The school's own switches after the write (not including the platform's). */
  featureSwitches: FeatureSwitchMap;
}
