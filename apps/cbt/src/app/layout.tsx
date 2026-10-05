import { DM_Sans, DM_Serif_Display } from "next/font/google";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { ServiceWorker } from "@/components/service-worker";

import "./globals.css";

// apps/cbt — the lab computers' exam app (docs/modules/cbt.md D9). The same
// typefaces as the web and the portal; next/font serves them from this app's
// own files, so they work offline too.
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans", display: "swap" });
const dmSerifDisplay = DM_Serif_Display({ subsets: ["latin"], weight: ["400"], variable: "--font-dm-serif-display", display: "swap" });

export const metadata: Metadata = {
  title: "SchoolKit — Exams",
  description: "Sit your school's exam on a school computer.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/brand/schoolkit-favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/schoolkit-favicon-128.png", sizes: "128x128", type: "image/png" },
    ],
    apple: "/brand/schoolkit-favicon-256.png",
  },
  // Lab machines are not where search results should send anyone.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#0E5C43" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${dmSans.variable} ${dmSerifDisplay.variable} min-h-screen bg-background font-sans antialiased`}>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
