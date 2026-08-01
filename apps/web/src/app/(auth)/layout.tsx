import type { ReactNode } from "react";

import { SchoolKitWordmark } from "@/components/brand/schoolkit-mark";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-8 flex flex-col items-center gap-2 text-center">
        <SchoolKitWordmark iconSize={40} textClassName="text-2xl" />
        <p className="text-sm text-muted-foreground">
          Multi-tenant school management
        </p>
      </div>
      {children}
    </div>
  );
}
