"use client";

import { ConsoleHeading } from "@/components/super-admin/console-shell";
import { PlatformActivity } from "@/components/super-admin/platform-activity";
import { Card, CardContent } from "@/components/ui/card";

export default function PlatformAdminActivityPage() {
  return (
    <>
      <ConsoleHeading
        title="Activity"
        description="Every platform admin action, newest first."
      />
      <Card>
        <CardContent className="pt-6">
          <PlatformActivity allowViews />
        </CardContent>
      </Card>
    </>
  );
}
