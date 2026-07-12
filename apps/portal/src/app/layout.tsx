import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

// No Providers wrapper yet (unlike apps/web's layout.tsx) — slice 1 has no
// client-side state to provide. Guardian auth (slice 2) is what first needs
// one; add it then rather than installing react-query/PostHog/an
// AuthProvider now for nothing to use.
export const metadata: Metadata = {
  title: "School Kit — Parent Portal",
  description: "View your child's fees and payments, and stay in touch with the school.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  );
}
