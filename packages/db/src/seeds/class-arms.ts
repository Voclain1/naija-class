// Default-arm naming, shared by both places a ClassLevel can come into
// existence: the signup bootstrap's 14 seeded levels (auth.service.ts) and
// an admin's later custom level (ClassLevelsService.create()). One helper so
// the two call sites can't drift apart on the convention.
//
// Naming matches what the manual "Add class arm" dialog's own placeholder
// text already establishes (apps/web's class-arm-dialog.tsx: "JSS 1A" /
// "jss1-a") — level name/code with a bare "A" concatenated directly, no
// separating space. The point is that this auto-created row is
// indistinguishable from one an admin would have typed by hand: an
// ordinary, renamable, deactivatable, deletable ClassArm from the moment it
// exists — this function only picks its starting name/code.

export interface DefaultArmSourceLevel {
  name: string;
  code: string;
}

export interface DefaultArm {
  name: string;
  code: string;
}

export function defaultArmFor(level: DefaultArmSourceLevel): DefaultArm {
  return {
    // createClassArmSchema caps name at 40 chars. Level name is capped at 40
    // chars too, so `${name}A` could in theory land at 41 — clamp
    // defensively rather than let a maximal-length level name abort an
    // otherwise-successful level creation. Level codes are capped at 16
    // (createClassLevelSchema), so `${code}-a` tops out at 18, well inside
    // the arm code's own 20-char cap — no clamp needed there.
    name: `${level.name.slice(0, 39)}A`,
    code: `${level.code}-a`,
  };
}
