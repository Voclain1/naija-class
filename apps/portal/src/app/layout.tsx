import { DM_Sans } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "@school-kit/ui/surfaces.css";

// Same sans family and visual tokens as the staff app.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

// No Providers wrapper yet (unlike apps/web's layout.tsx) — slice 1 has no
// client-side state to provide. Guardian auth (slice 2) is what first needs
// one; add it then rather than installing react-query/PostHog/an
// AuthProvider now for nothing to use.
export const metadata: Metadata = {
  title: "SchoolKit — Parent Portal",
  description: "View your child's fees and payments, and stay in touch with the school.",
  // Parents' pages are private: kept out of search by default. A school's
  // public pages, its admission form and result checker say otherwise in
  // their own metadata (docs/modules/school-website.md, "Search").
  robots: { index: false, follow: false },
  // The same favicons as apps/web. Until 2026-10-02 the portal had no public/
  // directory at all, so its tab showed Next's default icon.
  icons: {
    icon: [
      { url: "/brand/schoolkit-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/schoolkit-favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/brand/schoolkit-favicon-128.png", sizes: "128x128", type: "image/png" },
      { url: "/brand/schoolkit-favicon-256.png", sizes: "256x256", type: "image/png" },
    ],
    shortcut: "/brand/schoolkit-favicon-32.png",
    apple: "/brand/schoolkit-favicon-256.png",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-NG">
      <body
        className={`${dmSans.variable} schoolkit-surface min-h-screen bg-background font-sans`}
      >
        {children}
      </body>
    </html>
  );
}
