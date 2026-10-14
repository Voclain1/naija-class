import type { SchoolMeDto, SetupStepDto } from "@school-kit/types";

// "School setup N% done" on the staff home, for owners and admins. The web's
// rule (apps/web/src/lib/setup-state/setup-progress.ts), copied rather than
// shared because each app keeps its own pure rules beside their specs; it came
// to the app with the pre-build audit (2026-10-14). The hrefs are WEBSITE
// paths: setup is done on the website, so the app opens them there. Two
// halves, counted together:
//
//   - the setup checklist's real work (required + recommended; optional steps
//     are left out for the reason checklistProgress gives), straight from the
//     API's SetupStateDto, never re-derived here;
//   - the school's profile as parents see it: logo, address, phone and email.
//     These were never checklist steps, because a school can run without them,
//     but they are what makes the school look like itself on every screen
//     (docs/modules/school-identity.md).
//
// `next` is the first thing still to do, checklist first (it blocks real
// work), then the profile, so the indicator can link straight to it.

export interface SetupProgress {
  percent: number;
  done: number;
  total: number;
  next: { label: string; href: string } | null;
}

type ProfileFields = Pick<SchoolMeDto, "logoUrl" | "address" | "phone" | "email">;

const PROFILE_ITEMS: { key: keyof ProfileFields; label: string }[] = [
  { key: "logoUrl", label: "Add your school's logo" },
  { key: "address", label: "Add your school's address" },
  { key: "phone", label: "Add your school's phone number" },
  { key: "email", label: "Add your school's email" },
];

const TIER_RANK = { required: 0, recommended: 1, optional: 2 } as const;

export function setupProgress(steps: SetupStepDto[], school: ProfileFields): SetupProgress {
  const work = steps
    .filter((s) => s.tier !== "optional")
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
  const profile = PROFILE_ITEMS.map((item) => ({
    ...item,
    done: typeof school[item.key] === "string" && (school[item.key] as string).trim() !== "",
  }));

  const done = work.filter((s) => s.done).length + profile.filter((p) => p.done).length;
  const total = work.length + profile.length;

  const nextStep = work.find((s) => !s.done);
  const nextProfile = profile.find((p) => !p.done);
  const next = nextStep
    ? { label: nextStep.title, href: nextStep.href }
    : nextProfile
      ? { label: nextProfile.label, href: "/settings/school" }
      : null;

  return { percent: total === 0 ? 100 : Math.floor((done / total) * 100), done, total, next };
}
