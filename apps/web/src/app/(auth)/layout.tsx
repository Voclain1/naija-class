import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/40 p-4">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">School Kit</h1>
        <p className="text-sm text-muted-foreground">
          Multi-tenant school management
        </p>
      </div>
      {children}
    </div>
  );
}
