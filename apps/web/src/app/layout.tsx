import { DM_Sans } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "@/lib/providers";

import "./globals.css";
import "@school-kit/ui/surfaces.css";

// One sans family across body, headings and figures. Self-hosted by Next;
// no runtime font request. See docs/modules/app-visual-refresh.md.
const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
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
        className={`${dmSans.variable} schoolkit-surface min-h-screen bg-background font-sans`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
