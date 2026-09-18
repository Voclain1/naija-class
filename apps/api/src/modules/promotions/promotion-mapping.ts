// Promotion engine — the pure mapping rules (docs/modules/promotion-engine.md).
//
// Deliberately free of Prisma, Nest and auth so the rules that decide where a
// child lands can be unit-tested directly. The service loads rows and calls
// these; it does not re-implement any of it.

export interface LadderLevel {
  id: string;
  name: string;
  code: string;
  orderIndex: number;
  isActive: boolean;
}

export interface LadderArm {
  id: string;
  classLevelId: string;
  name: string;
  code: string;
  isActive: boolean;
}

/**
 * Arms are ordered by `code` ASC, and that choice is load-bearing rather than
 * incidental. `code` is the stable per-(school, level) identifier
 * (`@@unique([schoolId, classLevelId, code])`) — it does not change when an
 * admin renames "Primary 1A" to "Primary 1 Gold", so a school's arm ORDER, and
 * therefore every promotion mapping, does not silently re-shuffle on a rename.
 * `name` is free text and would.
 */
export function sortArms(arms: LadderArm[]): LadderArm[] {
  return [...arms].sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Levels in ladder order. Inactive levels are dropped: a retired level is not
 * a step a child should be promoted INTO, and leaving it in would make the
 * next level unreachable.
 */
export function sortLevels(levels: LadderLevel[]): LadderLevel[] {
  return [...levels]
    .filter((l) => l.isActive)
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * The position of `armId` within its level, by the ordering above.
 *
 * Inactive arms ARE counted here, unlike on the destination side. An arm that
 * was retired mid-year still occupied a position, and skipping it would shift
 * every arm after it one place up the alphabet — silently promoting 1C's
 * children into 2B. Retired arms are simply not offered as destinations.
 */
export function armIndexWithinLevel(arms: LadderArm[], armId: string): number {
  return sortArms(arms).findIndex((a) => a.id === armId);
}

export function nextLevel(
  ladder: LadderLevel[],
  sourceLevelId: string,
): LadderLevel | null {
  const ordered = sortLevels(ladder);
  const i = ordered.findIndex((l) => l.id === sourceLevelId);
  if (i === -1) return null; // source level itself retired — treat as no next
  return ordered[i + 1] ?? null;
}

export type DestinationOutcome =
  | { kind: "ARM"; level: LadderLevel; arm: LadderArm }
  | { kind: "NO_LEVEL" }
  | { kind: "NO_ARM"; level: LadderLevel };

/**
 * Where does a child in (sourceLevel, sourceArmIndex) go next year?
 *
 * The next level up, same arm position. "Primary 1B" → "Primary 2B", by
 * POSITION rather than by name, because arm names are per-school free text
 * ("Gold"/"Silver", "Alpha"/"Beta") and position is the thing every school
 * means when it says its arms are in order.
 *
 * Destination candidates are ACTIVE arms only — enrolling into an inactive arm
 * is rejected by EnrollmentsService anyway, so proposing one would just hand
 * the admin a row that cannot be committed.
 */
export function resolveYearDestination(
  ladder: LadderLevel[],
  armsByLevelId: Map<string, LadderArm[]>,
  sourceLevelId: string,
  sourceArmIndex: number,
): DestinationOutcome {
  const level = nextLevel(ladder, sourceLevelId);
  if (!level) return { kind: "NO_LEVEL" };

  const destArms = sortArms(
    (armsByLevelId.get(level.id) ?? []).filter((a) => a.isActive),
  );
  const arm = sourceArmIndex >= 0 ? destArms[sourceArmIndex] : undefined;
  if (!arm) return { kind: "NO_ARM", level };
  return { kind: "ARM", level, arm };
}

/**
 * The name/code we would give the missing arm if the admin asks us to create
 * it. Suggestion only — the create runs through the ordinary
 * POST /class-levels/:id/class-arms endpoint, with the admin able to edit both
 * fields first. This module never creates an arm itself.
 *
 * The suffix is lifted from the source arm rather than generated from the
 * index, so a school whose arms are "Gold"/"Silver" gets "Primary 2 Gold", not
 * "Primary 2A".
 */
export function suggestArm(
  destinationLevel: LadderLevel,
  sourceLevel: LadderLevel,
  sourceArm: LadderArm,
): { name: string; code: string } {
  const nameSuffix = sourceArm.name.startsWith(sourceLevel.name)
    ? sourceArm.name.slice(sourceLevel.name.length)
    : ` ${sourceArm.name}`;

  const codeParts = sourceArm.code.split("-");
  const codeSuffix = codeParts.length > 1 ? codeParts[codeParts.length - 1] : sourceArm.code;

  const code = `${destinationLevel.code}-${codeSuffix}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    name: `${destinationLevel.name}${nameSuffix}`.trim().slice(0, 40),
    code: code.slice(0, 20),
  };
}
