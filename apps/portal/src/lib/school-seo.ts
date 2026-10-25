import type { Metadata } from "next";

import {
  clip,
  schoolPageDescription,
  schoolPageTitle,
  SEO_DESCRIPTION_MAX,
  type PublicWebsitePostDto,
  type SchoolPublicDto,
} from "@school-kit/types";

// What search engines and link previews read on a school's public pages
// (docs/modules/school-website.md, "Search"). Every URL here is the canonical
// one the API gave (the school's own address once live, else the portal's),
// so each page has exactly one address in Google.

/** The school's site, without a trailing slash: "https://x.schoolkit.ng". */
export function siteBase(school: SchoolPublicDto): string {
  return school.seo.urls.home.replace(/\/$/, "");
}

/** The share picture, drawn per school (share-image/route.tsx). */
export function shareImageUrl(school: SchoolPublicDto): string {
  return `${siteBase(school)}/share-image`;
}

/** A link that always reaches the school's current logo (school-logo/route.ts). */
export function logoUrl(school: SchoolPublicDto): string {
  return `${siteBase(school)}/school-logo`;
}

const SHARE = { width: 1200, height: 630 };

function pageMetadata(
  school: SchoolPublicDto,
  page: { title: string; description: string; url: string; image?: { url: string; alt: string } | null; type?: "website" | "article"; publishedTime?: string },
  opts: { preview?: boolean } = {},
): Metadata {
  const image = page.image ?? { url: shareImageUrl(school), alt: school.name, ...SHARE };
  return {
    // The school's own name ends every title; SchoolKit's never does.
    title: { absolute: page.title },
    description: page.description,
    alternates: { canonical: page.url },
    robots: opts.preview ? { index: false, follow: false } : { index: true, follow: true },
    icons: school.logoUrl ? { icon: logoUrl(school), apple: logoUrl(school) } : undefined,
    openGraph: {
      type: page.type ?? "website",
      url: page.url,
      siteName: school.name,
      title: page.title,
      description: page.description,
      locale: "en_NG",
      images: [image],
      ...(page.publishedTime ? { publishedTime: page.publishedTime } : {}),
    },
    twitter: { card: "summary_large_image", title: page.title, description: page.description, images: [image.url] },
  };
}

export function frontPageMetadata(school: SchoolPublicDto, preview: boolean): Metadata {
  return pageMetadata(
    school,
    { title: schoolPageTitle(school), description: schoolPageDescription(school), url: school.seo.urls.home },
    { preview },
  );
}

export function newsMetadata(school: SchoolPublicDto): Metadata {
  return pageMetadata(school, {
    title: `News | ${school.name}`,
    description: clip(`The latest news from ${school.name}${school.seo.town ? `, ${school.seo.town}` : ""}.`, SEO_DESCRIPTION_MAX),
    url: school.seo.urls.news,
  });
}

export function galleryMetadata(school: SchoolPublicDto): Metadata {
  return pageMetadata(school, {
    title: `Photo gallery | ${school.name}`,
    description: clip(`Photos of ${school.name}: our buildings, classrooms and school events.`, SEO_DESCRIPTION_MAX),
    url: school.seo.urls.gallery,
  });
}

export function postMetadata(school: SchoolPublicDto, post: PublicWebsitePostDto): Metadata {
  const photo = post.photos[0];
  return pageMetadata(school, {
    title: clip(`${post.title} | ${school.name}`, 70),
    description: clip(post.body, SEO_DESCRIPTION_MAX),
    url: `${school.seo.urls.news}/${post.id}`,
    image: photo ? { url: photo.largeUrl, alt: photo.caption ?? post.title } : null,
    type: "article",
    publishedTime: post.publishedAt,
  });
}

// ─── Structured data (schema.org JSON-LD) ──────────────────────────────────

type Json = Record<string, unknown>;

function postalAddress(school: SchoolPublicDto): Json | undefined {
  if (!school.address) return undefined;
  return {
    "@type": "PostalAddress",
    streetAddress: school.address,
    ...(school.seo.town ? { addressLocality: school.seo.town } : {}),
    addressCountry: "NG",
  };
}

/** The school itself, for the front page. */
export function schoolJsonLd(school: SchoolPublicDto): Json {
  const address = postalAddress(school);
  return {
    "@context": "https://schema.org",
    "@type": "School",
    "@id": `${school.seo.urls.home}#school`,
    name: school.name,
    url: school.seo.urls.home,
    description: schoolPageDescription(school),
    image: shareImageUrl(school),
    ...(school.logoUrl ? { logo: logoUrl(school) } : {}),
    ...(school.motto ? { slogan: school.motto } : {}),
    ...(school.phone ? { telephone: school.phone } : {}),
    ...(school.email ? { email: school.email } : {}),
    ...(address ? { address } : {}),
    ...(school.seo.founded ? { foundingDate: String(school.seo.founded) } : {}),
    ...(school.seo.town ? { areaServed: school.seo.town } : {}),
  };
}

/** Upcoming events, so Google can show them with dates. */
export function eventsJsonLd(school: SchoolPublicDto): Json[] {
  const address = postalAddress(school);
  return school.website.events.map((e) => ({
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.title,
    ...(e.description ? { description: e.description } : {}),
    startDate: e.startDate,
    endDate: e.endDate,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    location: { "@type": "Place", name: school.name, ...(address ? { address } : {}) },
    organizer: { "@type": "Organization", name: school.name, url: school.seo.urls.home },
  }));
}

export function articleJsonLd(school: SchoolPublicDto, post: PublicWebsitePostDto): Json {
  const org = { "@type": "Organization", name: school.name, url: school.seo.urls.home, ...(school.logoUrl ? { logo: logoUrl(school) } : {}) };
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: clip(post.title, 110),
    datePublished: post.publishedAt,
    mainEntityOfPage: `${school.seo.urls.news}/${post.id}`,
    image: post.photos.length ? post.photos.map((p) => p.largeUrl) : [shareImageUrl(school)],
    author: org,
    publisher: org,
  };
}

export function breadcrumbJsonLd(school: SchoolPublicDto, trail: { name: string; url: string }[]): Json {
  const items = [{ name: school.name, url: school.seo.urls.home }, ...trail];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

/** Safe inside a <script>: no "</script>" can close it early. */
export function jsonLdScript(data: Json | Json[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
