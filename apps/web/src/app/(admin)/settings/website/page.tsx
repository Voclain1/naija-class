"use client";

import { ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { PLAN_LABELS, type SchoolWebsiteDto } from "@school-kit/types";

import { PageHeader } from "@/components/layout/page-primitives";
import { WebsiteDetailsForm } from "@/components/school-website/website-details-form";
import { WebsiteGalleryPanel } from "@/components/school-website/website-gallery-panel";
import { WebsitePostsPanel } from "@/components/school-website/website-posts-panel";
import { InlineAlert } from "@/components/shared/inline-alert";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api-client";
import { getSchoolWebsite, previewWebsite, publishWebsite } from "@/lib/school-website/school-website-api";

// Settings → School website (2026-10-22, docs/modules/school-website.md).
// The page details, news and the gallery, with Preview and Publish. Events
// and announcements are ticked where they are written (Calendar,
// Announcements), so nothing is typed twice.

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

export default function SchoolWebsitePage() {
  const [site, setSite] = useState<SchoolWebsiteDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "publish" | null>(null);

  const refresh = useCallback(() => {
    getSchoolWebsite()
      .then(setSite)
      .catch((e: unknown) => setError(message(e)));
  }, []);

  useEffect(refresh, [refresh]);

  async function preview() {
    setBusy("preview");
    try {
      const { url } = await previewWebsite();
      window.open(url, "_blank", "noopener");
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    setBusy("publish");
    try {
      setSite(await publishWebsite());
      toast.success("Published. Families see the new page now.");
    } catch (e) {
      toast.error(message(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader title="School website" subtitle="Your school's public page: your story, news, photos, events and announcements." />
      {error && <InlineAlert>{error}</InlineAlert>}
      {!site ? (
        !error && <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <section className="flex flex-col gap-3 rounded-lg bg-muted/40 p-4" aria-label="Status">
            <div className="flex flex-wrap items-center gap-3">
              <a href={site.pageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sm font-medium text-primary underline-offset-2 hover:underline">
                View your page <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <span className="text-sm text-muted-foreground">
                {site.publishedAt ? `Last published ${new Date(site.publishedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.` : "Not published yet."}
              </span>
              {site.unpublishedChanges && <span className="text-sm text-amber-700 dark:text-amber-400">You have changes families cannot see yet.</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" disabled={busy !== null} onClick={() => void preview()}>
                {busy === "preview" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Preview
              </Button>
              <Button type="button" disabled={busy !== null || !site.unpublishedChanges} onClick={() => void publish()}>
                {busy === "publish" && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                Publish page details
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Your plan: {PLAN_LABELS[site.plan]}.{" "}
              {site.enforcement === "warn" ? "During early access every section is open to you." : "Sections above your plan are kept, but not shown on your page."} News posts are published one by one, below.
            </p>
          </section>

          <section className="flex flex-col gap-2 rounded-lg border bg-card p-4" aria-labelledby="on-page">
            <h2 id="on-page" className="font-semibold">
              Events and announcements
            </h2>
            <p className="text-sm text-muted-foreground">
              Tick <strong>Show on the school website</strong> when you add an event or send an announcement to everyone or to parents.
              On your page now: {site.counts.events} event{site.counts.events === 1 ? "" : "s"}, {site.counts.announcements} announcement
              {site.counts.announcements === 1 ? "" : "s"}. Your plan shows the {site.limits.events === null ? "upcoming" : `next ${site.limits.events}`} events and the latest{" "}
              {site.limits.announcements} announcements.
            </p>
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href="/events" className="text-primary underline-offset-2 hover:underline">
                Go to the calendar
              </Link>
              <Link href="/announcements" className="text-primary underline-offset-2 hover:underline">
                Go to announcements
              </Link>
            </div>
          </section>

          <Tabs defaultValue="details">
            <TabsList>
              <TabsTrigger value="details">Page details</TabsTrigger>
              <TabsTrigger value="news">News ({site.counts.publishedPosts})</TabsTrigger>
              <TabsTrigger value="gallery">Gallery ({site.counts.galleryPhotos})</TabsTrigger>
            </TabsList>
            <TabsContent value="details" className="pt-4">
              <WebsiteDetailsForm site={site} onSaved={setSite} />
            </TabsContent>
            <TabsContent value="news" className="pt-4">
              <WebsitePostsPanel site={site} onChanged={refresh} />
            </TabsContent>
            <TabsContent value="gallery" className="pt-4">
              <WebsiteGalleryPanel site={site} onChanged={refresh} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
