import type { ReactNode } from "react";

import { RequireAuth } from "@/components/auth/require-auth";
import { AdminSidebar } from "@/components/admin/sidebar";
import { AdminTopbar } from "@/components/admin/topbar";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <div className="flex min-h-screen bg-muted/30">
        <AdminSidebar />
        <div className="flex flex-1 flex-col">
          <AdminTopbar />
          <main className="flex-1 p-6">{children}</main>
        </div>
      </div>
    </RequireAuth>
  );
}
