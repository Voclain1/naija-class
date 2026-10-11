"use client";

import { useRouter } from "next/navigation";

import { InlineAlert } from "@/components/shared/inline-alert";
import { useAuth } from "@/lib/auth/use-auth";

// Reminds an owner or admin that the school has no logo yet
// (docs/modules/school-identity.md). Until it has one, SchoolKit's icon stands
// in beside the school's name in the menu, the parent portal and the app.
// Gone the moment a logo is uploaded: the auth context's school.logoUrl is
// updated by the upload itself.
export function LogoReminder() {
  const { school, roles } = useAuth();
  const router = useRouter();
  const canUpload = roles.some((r) => r.key === "owner" || r.key === "admin");
  if (!school || school.logoUrl || !canUpload) return null;

  return (
    <InlineAlert
      tone="warning"
      title="Add your school's logo"
      action={{ label: "Add logo", onClick: () => router.push("/settings/school") }}
    >
      Parents and staff see your logo beside {school.name} in the menu, the parent portal and the app. Until you add
      one, SchoolKit&apos;s logo shows in its place.
    </InlineAlert>
  );
}
