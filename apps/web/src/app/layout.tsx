import { DM_Sans, DM_Serif_Display } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "@/lib/providers";

import "./globals.css";

// Self-hosted by Next (no runtime call to Google's CDN) — see CLAUDE.md
// "Design system" section.
//
// DM Serif Display + DM Sans, chosen 2026-09-29 over Fraunces + Hanken
// Grotesk. Fraunces is a wonky, soft serif: characterful on a marketing page
// and slightly unserious above a table of a school's children. DM Serif
// Display is heavier and squarer, so a heading reads as authority rather than
// as personality, and the two were drawn as one family — they sit together
// without the mismatched-weight problem the old pair had at small sizes.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});
const dmSerifDisplay = DM_Serif_Display({
  subsets: ["latin"],
  // Display serifs ship one weight; asking for more fails the build.
  weight: ["400"],
  variable: "--font-dm-serif-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SchoolKit",
  // Shown in search results and link previews, so it is marketing copy, not a
  // system description. Was "Multi-tenant school management for Nigerian
  // private schools." until 2026-08-09 — "multi-tenant" is an architecture
  // term no school owner searches for or understands.
  description:
    "Student records, fees, attendance and report cards for Nigerian private schools — in one place.",
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
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${dmSerifDisplay.variable} min-h-screen bg-background font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
