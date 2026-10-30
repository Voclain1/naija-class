"use client";

import { ConsoleHeading } from "@/components/super-admin/console-shell";
import { SmartImportBetaCard } from "@/components/super-admin/smart-import-beta";

export default function PlatformAdminSmartImportPage() {
  return (
    <>
      <ConsoleHeading
        title="Smart Import beta"
        description="Pages read per school, and how often admins corrected each field. Counts only."
      />
      <SmartImportBetaCard />
    </>
  );
}
