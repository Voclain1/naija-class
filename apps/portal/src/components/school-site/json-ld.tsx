import { jsonLdScript } from "@/lib/school-seo";

/** Structured data for search engines (docs/modules/school-website.md, "Search"). The JSON is escaped by jsonLdScript. */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(data) }} />;
}
