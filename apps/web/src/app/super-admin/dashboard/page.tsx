"use client";

import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { PlatformAdminDashboard } from "@/components/super-admin/platform-admin-dashboard";

export default function PlatformAdminDashboardPage() {
  const router = useRouter();

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            await fetch("/api/platform-admin/logout", { method: "DELETE" });
            router.replace("/super-admin/login");
          }}
        >
          Sign out
        </Button>
      </div>
      <PlatformAdminDashboard />
    </div>
  );
}
