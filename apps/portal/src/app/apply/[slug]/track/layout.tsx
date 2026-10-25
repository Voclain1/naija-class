import type { Metadata } from "next";
import type { ReactNode } from "react";

// A family's private tracking link: never in search results.
export const metadata: Metadata = { title: "Your application", robots: { index: false, follow: false } };

export default function TrackLayout({ children }: { children: ReactNode }) {
  return children;
}
