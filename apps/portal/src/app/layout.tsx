import { DM_Sans, DM_Serif_Display } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

// The same pair apps/web uses, chosen 2026-09-29. The portal previously had
// NO typeface configured at all — it fell back to whatever system stack the
// browser offered, which is a large part of why it read as a draft beside the
// app. A parent who meets the portal before the app should not meet a
// different product.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});
const dmSerifDisplay = DM_Serif_Display({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--font-dm-serif-display",
  display: "swap",
});

// No Providers wrapper yet (unlike apps/web's layout.tsx) — slice 1 has no
// client-side state to provide. Guardian auth (slice 2) is what first needs
// one; add it then rather than installing react-query/PostHog/an
// AuthProvider now for nothing to use.
export const metadata: Metadata = {
  title: "SchoolKit — Parent Portal",
  description: "View your child's fees and payments, and stay in touch with the school.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${dmSans.variable} ${dmSerifDisplay.variable} min-h-screen bg-background font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
