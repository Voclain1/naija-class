import type { ReactNode } from "react";

// Genuinely separate top-level surface — shares the Next.js root layout
// (fonts, providers) because this route lives inside apps/web, not a
// separate app, but deliberately does NOT share (admin)'s RequireAuth-
// wrapped shell (sidebar nav, role gate) or (teacher)'s. No nav link to
// this route exists anywhere in that shell. The sign-in page centres itself
// (login/layout.tsx); the console has its own side menu (dashboard/layout.tsx).
export default function SuperAdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="min-h-screen bg-background">{children}</div>;
}
