import type { ReactNode } from "react";

import { ConsoleShell } from "@/components/super-admin/console-shell";

export default function PlatformAdminConsoleLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <ConsoleShell>{children}</ConsoleShell>;
}
