"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { InlineAlert } from "@/components/shared/inline-alert";
import { useAuth } from "@/lib/auth/use-auth";
import { dismissReminder, noteSession, REMIND_AFTER_SESSIONS, shouldRemind } from "@/lib/dashboard/logo-reminder-state";

// Reminds an owner or admin that the school has no logo yet
// (docs/modules/school-identity.md). Until it has one, SchoolKit's icon stands
// in beside the school's name in the menu, the parent portal and the app.
// Gone the moment a logo is uploaded: the auth context's school.logoUrl is
// updated by the upload itself. Closable; it comes back after
// REMIND_AFTER_SESSIONS more sittings (lib/dashboard/logo-reminder-state.ts).
function storageOrNull(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return window[kind];
  } catch {
    return null;
  }
}

export function LogoReminder() {
  const { school, roles } = useAuth();
  const router = useRouter();
  const canUpload = roles.some((r) => r.key === "owner" || r.key === "admin");
  const needsLogo = Boolean(school && !school.logoUrl && canUpload);
  const schoolId = school?.id ?? null;
  // Decided after mount: storage is browser-only, and showing nothing until
  // then avoids a reminder that flashes and vanishes.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!needsLogo || !schoolId) {
      setVisible(false);
      return;
    }
    const local = storageOrNull("localStorage");
    const session = storageOrNull("sessionStorage");
    setVisible(local && session ? shouldRemind(noteSession(local, session, schoolId)) : true);
  }, [needsLogo, schoolId]);

  if (!visible || !school) return null;

  function close() {
    const local = storageOrNull("localStorage");
    if (local && schoolId) dismissReminder(local, schoolId);
    setVisible(false);
  }

  return (
    <InlineAlert
      tone="warning"
      title="Add your school's logo"
      action={{ label: "Add logo", onClick: () => router.push("/settings/school") }}
      onDismiss={close}
    >
      Parents and staff see your logo beside {school.name} in the menu, the parent portal and the app. Until you add
      one, SchoolKit&apos;s logo shows in its place. Closed, this comes back after {REMIND_AFTER_SESSIONS} visits.
    </InlineAlert>
  );
}
