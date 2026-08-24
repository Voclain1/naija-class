export interface StaffMobileRolloutArgs {
  schoolId: string;
  enabled: boolean;
  apply: boolean;
}

function valuesAfter(args: string[], flag: string): string[] {
  return args.flatMap((value, index) => value === flag && args[index + 1] ? [args[index + 1]!] : []);
}

export function parseStaffMobileRolloutArgs(args: string[]): StaffMobileRolloutArgs {
  const schoolIds = valuesAfter(args, "--school-id");
  if (schoolIds.length !== 1) throw new Error("Pass exactly one operator-reviewed --school-id.");
  const apply = args.includes("--apply");
  const confirm = valuesAfter(args, "--confirm-school-id");
  if (apply && (confirm.length !== 1 || confirm[0] !== schoolIds[0])) {
    throw new Error("--apply requires one matching --confirm-school-id.");
  }
  const disable = args.includes("--disable");
  if (disable && args.includes("--enable")) throw new Error("Choose --enable or --disable, not both.");
  return { schoolId: schoolIds[0]!, enabled: !disable, apply };
}
