import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Providers } from "@/lib/providers";

import "./globals.css";

export const metadata: Metadata = {
  title: "School Kit",
  description: "Multi-tenant school management for Nigerian private schools.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
