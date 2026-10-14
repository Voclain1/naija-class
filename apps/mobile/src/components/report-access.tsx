import { Linking } from "react-native";

import { staffWebHandoff } from "../lib/api/staff-auth";
import { hasPermission } from "../lib/auth/permissions";
import { isSchoolAdmin } from "../lib/auth/roles";
import { useSession } from "../lib/auth/session";
import { signedInWebUrl, webUrl } from "../lib/web-handoff";

// Phase 9 / CP1.3b — who may open the analytics summaries, and the website
// link a summary offers for what does not fit a phone (the subject heatmap).

export function useAnalyticsAccess() {
  const { status, principal, staff } = useSession();
  const authed = status === "authenticated" && principal === "staff";
  const schoolId = staff?.school.id ?? "";
  const userId = staff?.user.id ?? "";
  const allowed = isSchoolAdmin(staff?.roles) && hasPermission(staff?.permissions ?? [], "reports.analytics.read");
  return { status, authed, schoolId, userId, allowed, ready: authed && allowed && schoolId !== "" && userId !== "" };
}

export const websiteAvailable = (): boolean => webUrl("/") !== null;

export function openOnWebsite(path: string): void {
  void signedInWebUrl(path, (next) => staffWebHandoff(next)).then((url) => {
    if (url) void Linking.openURL(url);
  });
}
