export interface PaystackSplitBackfillArgs {
  apply: boolean;
  schoolId: string;
  actorUserId?: string;
  actorSchoolId?: string;
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function parsePaystackSplitBackfillArgs(args: string[]): PaystackSplitBackfillArgs {
  const apply = args.includes("--apply");
  const schoolIds = args
    .map((arg, index) => (arg === "--school-id" ? args[index + 1] : undefined))
    .filter((value): value is string => Boolean(value));

  if (schoolIds.length !== 1) {
    throw new Error(
      "Pass exactly one operator-reviewed --school-id <uuid>. The rollout is one school per invocation.",
    );
  }

  const schoolId = schoolIds[0];
  const actorUserId = valueAfter(args, "--actor-user-id");
  const actorSchoolId = valueAfter(args, "--actor-school-id");
  const confirmedSchoolId = valueAfter(args, "--confirm-school-id");

  if (apply && (!actorUserId || !actorSchoolId)) {
    throw new Error("--apply requires --actor-user-id and --actor-school-id for audit.");
  }
  if (apply && confirmedSchoolId !== schoolId) {
    throw new Error(
      "--apply requires --confirm-school-id matching the single reviewed --school-id.",
    );
  }

  return { apply, schoolId, actorUserId, actorSchoolId };
}
