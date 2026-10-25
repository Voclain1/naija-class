"use client";

import {
  schoolPageDescription,
  schoolPageTitle,
  townFromAddress,
  WEBSITE_LEVEL_LABELS,
  WEBSITE_LIMITS,
  type WebsiteDetails,
} from "@school-kit/types";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth/use-auth";

const TEXTAREA = "w-full rounded-md border border-input bg-background p-2 text-sm";

// "How you appear on Google" (docs/modules/school-website.md, "Search"): the
// town and the school's own description, with a preview drawn by the same
// functions the public page uses. Open to every plan.
export function SearchPreview({
  d,
  set,
  detailsOpen,
}: {
  d: WebsiteDetails;
  set: <K extends keyof WebsiteDetails>(key: K, value: WebsiteDetails[K]) => void;
  /** The plan shows the page details (and so the levels) on the page. */
  detailsOpen: boolean;
}) {
  const { school } = useAuth();
  if (!school) return null;
  const text = (v: string) => (v.length ? v : null);
  const town = d.town ?? townFromAddress(school.address);
  const preview = {
    name: school.name,
    motto: school.motto ?? null,
    admissionsOpen: false,
    website: { cover: d.welcome ? { welcome: d.welcome } : null },
    seo: {
      urls: { home: school.siteUrls.home, news: "", gallery: "", apply: "", results: "" },
      description: d.searchDescription,
      town,
      levels: detailsOpen ? d.levels.map((l) => WEBSITE_LEVEL_LABELS[l]) : [],
      founded: null,
      updatedAt: null,
    },
  };
  const left = WEBSITE_LIMITS.searchDescription - (d.searchDescription?.length ?? 0);

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <legend className="px-1 text-base font-semibold">How you appear on Google</legend>
      <p className="text-sm text-muted-foreground">
        Parents search for things like &quot;primary school in {town ?? "your town"}&quot;. Your school&apos;s name, town and
        classes help Google show your page to them.
      </p>
      <div className="flex flex-col gap-1">
        <Label htmlFor="w-town">Town or area</Label>
        <Input
          id="w-town"
          maxLength={WEBSITE_LIMITS.town}
          value={d.town ?? ""}
          onChange={(e) => set("town", text(e.target.value))}
          placeholder={townFromAddress(school.address) ?? "e.g. Independence Layout, Enugu"}
        />
        <span className="text-xs text-muted-foreground">Leave empty to use the town from your school address.</span>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="w-search">Description for Google (optional)</Label>
        <textarea
          id="w-search"
          className={`${TEXTAREA} min-h-20`}
          maxLength={WEBSITE_LIMITS.searchDescription}
          value={d.searchDescription ?? ""}
          onChange={(e) => set("searchDescription", text(e.target.value))}
          placeholder="e.g. A caring nursery and primary school in Enugu with small classes, a library and a school bus."
        />
        <span className="text-xs text-muted-foreground">
          {left} characters left. Leave empty and SchoolKit writes one from your page.
        </span>
      </div>
      <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-4" aria-label="Search result preview">
        <span className="text-xs text-muted-foreground">{school.siteUrls.home.replace(/^https?:\/\//, "").replace(/\/$/, "")}</span>
        <span className="text-lg font-medium text-[#1a0dab] dark:text-[#8ab4f8]">{schoolPageTitle(preview)}</span>
        <span className="text-sm text-muted-foreground">{schoolPageDescription(preview)}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        While admissions are open, &quot;Admissions open&quot; is added to the title. Google updates its results in its own
        time, usually within a few days of Publish.
      </p>
    </fieldset>
  );
}
