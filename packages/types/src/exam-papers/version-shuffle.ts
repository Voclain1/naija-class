// Phase 8c / CP5c — versions A–D of an exam paper (docs/modules/phase-8.md §22.3).
//
// Each version prints the same questions with the multiple-choice OPTIONS in a
// different order, so neighbours in an exam hall cannot copy letters. The
// order must be:
//   * deterministic — reprinting version C next week gives the same paper, and
//     its marking scheme the same letters;
//   * different per question, so a pupil cannot work out "B is always one on";
//   * unchanged for version A, which reads exactly as the teacher set it.
// So it is a pure function of a seed string, with no Math.random anywhere.

export const VERSION_LETTERS = ["A", "B", "C", "D"] as const;
export type PaperVersion = (typeof VERSION_LETTERS)[number];

/** FNV-1a, 32-bit. Small, well-spread, and identical in every JS runtime. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded generator returning [0, 1). */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The order to print `count` options in for one question of one version:
 * a permutation of 0..count-1. Version A is always the identity. Any other
 * version is never the identity either (when there is more than one option),
 * so every version after A genuinely moves the answers.
 *
 * `seedKey` names the question within the paper — the service uses
 * `${paperId}:${itemId}` — so the same question on two papers moves
 * independently.
 */
export function optionOrderFor(version: PaperVersion, seedKey: string, count: number): number[] {
  const order = Array.from({ length: count }, (_, i) => i);
  if (version === "A" || count < 2) return order;
  const random = seeded(hash32(`${seedKey}:${version}`));
  for (let i = count - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  if (order.every((v, i) => v === i)) order.push(order.shift()!);
  return order;
}

/** The versions a paper with `versionCount` prints: A, or A–B, … A–D. */
export function versionsOf(versionCount: number): PaperVersion[] {
  return VERSION_LETTERS.slice(0, Math.min(Math.max(versionCount, 1), VERSION_LETTERS.length));
}

/**
 * Online exams (CBT, docs/modules/cbt.md D2): which version a candidate sits.
 * A hash of the sitting and the student — deterministic, so a re-published
 * sitting gives every student the same version again, and spread so
 * neighbours rarely share one.
 */
export function versionForCandidate(sittingId: string, studentId: string, versionCount: number): PaperVersion {
  const versions = versionsOf(versionCount);
  return versions[hash32(`${sittingId}:${studentId}`) % versions.length]!;
}
