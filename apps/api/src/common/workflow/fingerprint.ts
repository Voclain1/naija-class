import { createHash } from "node:crypto";

// Preview fingerprints for server-owned workflow proposals
// (docs/modules/student-intake-proposals.md, reminder-campaigns.md).

/** JSON with object keys sorted at every level, so equal values hash equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** The fingerprint of a preview: SHA-256 over its stable serialisation. */
export function fingerprint(value: unknown): string {
  return sha256(stableStringify(value));
}
