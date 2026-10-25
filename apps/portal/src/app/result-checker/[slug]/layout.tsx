import type { Metadata } from "next";
import type { ReactNode } from "react";

import { clip } from "@school-kit/types";

import { loadSchool } from "@/lib/school-site";

// The result checker's title and address for search engines
// (docs/modules/school-website.md, "Search"). Parents search for it by name.

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const school = await loadSchool((await params).slug).catch(() => null);
  if (!school) return { title: "Check results" };
  const title = `Check results | ${school.name}`;
  const description = clip(`Check your child's ${school.name} results with the admission number and a result PIN.`, 160);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: school.seo.urls.results },
    robots: school.resultChecker ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: "website", url: school.seo.urls.results, siteName: school.name, title, description, locale: "en_NG", images: [{ url: `${school.seo.urls.home.replace(/\/$/, "")}/share-image`, width: 1200, height: 630 }] },
  };
}

export default function ResultCheckerLayout({ children }: { children: ReactNode }) {
  return children;
}
