import { redirect } from "next/navigation";

// /settings has no dashboard of its own yet — the only sub-page in Phase 0
// is /settings/users (Slice 7) and /settings/profile / /settings/school /
// /settings/audit land later. Bouncing here means the sidebar's Settings
// link works without a sub-navigation refactor.
export default function SettingsIndex() {
  redirect("/settings/users");
}
