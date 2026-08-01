import { Fraunces, Hanken_Grotesk } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "@/lib/providers";

import "./globals.css";

// Self-hosted by Next (no runtime call to Google's CDN) — see CLAUDE.md
// "Design system" section for why these two typefaces were chosen.
const hankenGrotesk = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken-grotesk",
  display: "swap",
});
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "schoolkit",
  description: "Multi-tenant school management for Nigerian private schools.",
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
        className={`${hankenGrotesk.variable} ${fraunces.variable} min-h-screen bg-background font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
