import type { Metadata } from "next";
import type { ReactNode } from "react";

import { clip } from "@school-kit/types";

import { loadSchool } from "@/lib/school-site";

// The admission form's title and address for search engines
// (docs/modules/school-website.md, "Search"). The page itself is a client
// form; its tracking pages below have their own layout, kept out of search.

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const school = await loadSchool((await params).slug).catch(() => null);
  if (!school) return { title: "Apply for admission" };
  const where = school.seo.town ? ` in ${school.seo.town}` : "";
  const title = `Apply for admission | ${school.name}`;
  const description = clip(`Apply online for a place at ${school.name}${where}. Fill in the form and upload documents from your phone.`, 160);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: school.seo.urls.apply },
    robots: school.admissionsOpen ? { index: true, follow: true } : { index: false, follow: true },
    openGraph: { type: "website", url: school.seo.urls.apply, siteName: school.name, title, description, locale: "en_NG", images: [{ url: `${school.seo.urls.home.replace(/\/$/, "")}/share-image`, width: 1200, height: 630 }] },
  };
}

export default function ApplyLayout({ children }: { children: ReactNode }) {
  return children;
}
