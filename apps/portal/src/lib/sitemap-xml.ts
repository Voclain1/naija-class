// Sitemap and robots text (docs/modules/school-website.md, "Search"), as
// plain strings so they are easy to test.

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function urlsetXml(entries: { url: string; lastModified: string | null }[]): string {
  const rows = entries
    .map((e) => `  <url><loc>${escape(e.url)}</loc>${e.lastModified ? `<lastmod>${e.lastModified}</lastmod>` : ""}</url>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</urlset>\n`;
}

export function sitemapIndexXml(sitemaps: { url: string; lastModified: string | null }[]): string {
  const rows = sitemaps
    .map((s) => `  <sitemap><loc>${escape(s.url)}</loc>${s.lastModified ? `<lastmod>${s.lastModified}</lastmod>` : ""}</sitemap>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows}\n</sitemapindex>\n`;
}

/**
 * A school's own address: its public pages are open; the parents' and staff
 * areas, the admission tracking pages and previews are not.
 */
export function schoolRobotsTxt(sitemapUrl: string): string {
  return [
    "User-agent: *",
    "Allow: /",
    "Disallow: /parents",
    "Disallow: /staff",
    "Disallow: /apply/track",
    "Disallow: /*?preview=",
    "",
    `Sitemap: ${sitemapUrl}`,
    "",
  ].join("\n");
}

/**
 * The portal's own address: only the schools' public pages, which say where
 * their canonical address is; parents' pages, sign-in and links sent by
 * email are kept out.
 */
export function portalRobotsTxt(sitemapIndexUrl: string): string {
  return [
    "User-agent: *",
    "Allow: /school/",
    "Allow: /apply/",
    "Allow: /result-checker/",
    "Disallow: /apply/*/track",
    "Disallow: /*?preview=",
    "Disallow: /",
    "",
    `Sitemap: ${sitemapIndexUrl}`,
    "",
  ].join("\n");
}
