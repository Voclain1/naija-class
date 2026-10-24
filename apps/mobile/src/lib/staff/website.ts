import {
  PLAN_LABELS,
  WEBSITE_LIMITS,
  type PlanEnforcement,
  type SchoolWebsiteDto,
  type WebsitePhotoDto,
  type WebsitePostDto,
  type WebsiteSectionStateDto,
} from "@school-kit/types";

// Website news and photos in the staff app (docs/modules/school-website.md).
// The words match the web editor's, so the two never tell a school different
// things about the same post.

/** The size an image of w × h becomes when its long side is at most `max`. Never enlarged. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width: Math.round(width), height: Math.round(height) };
  const scale = max / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Where a post stands, in words. */
export function postStatusLabel(post: Pick<WebsitePostDto, "status" | "takenDown">): "Taken down" | "Published" | "Draft" {
  if (post.takenDown) return "Taken down";
  return post.status === "PUBLISHED" ? "Published" : "Draft";
}

/** What a section needs from the plan, or null when it is the school's own. Same words as the web's SectionLock. */
export function sectionPlanNote(state: WebsiteSectionStateDto | undefined, enforcement: PlanEnforcement): { tone: "info" | "warning"; text: string } | null {
  if (!state || state.inPlan) return null;
  const plan = PLAN_LABELS[state.minPlan];
  if (state.open && enforcement === "warn") return { tone: "info", text: `${plan} plan — included free during early access.` };
  return {
    tone: "warning",
    text: `Locked: comes with the ${plan} plan. You can fill it in now; it shows on your page once your plan includes it.`,
  };
}

/** How many photos one post can carry on this school's plan. */
export function photosPerPost(site: Pick<SchoolWebsiteDto, "limits">): number {
  return Math.min(WEBSITE_LIMITS.photosPerPost, site.limits.photosPerPost || WEBSITE_LIMITS.photosPerPost);
}

/** The gallery's cap on this school's plan. */
export function galleryCap(site: Pick<SchoolWebsiteDto, "limits">): number {
  return site.limits.galleryPhotos || WEBSITE_LIMITS.galleryPhotos;
}

/** A post can be changed unless SchoolKit took it down. */
export function canChangePost(post: Pick<WebsitePostDto, "takenDown">): boolean {
  return post.takenDown === null;
}

/** "42 of 60 photos". */
export function galleryCountLine(photos: readonly WebsitePhotoDto[], cap: number): string {
  return `${photos.length} of ${cap} photo${cap === 1 ? "" : "s"}`;
}

/** Gallery photos grouped by album, albums in their own order, loose photos last. */
export function groupByAlbum(
  photos: readonly WebsitePhotoDto[],
  albums: readonly { id: string; title: string }[],
): { albumId: string | null; title: string; photos: WebsitePhotoDto[] }[] {
  const groups = albums.map((a) => ({ albumId: a.id as string | null, title: a.title, photos: photos.filter((p) => p.albumId === a.id) }));
  const known = new Set(albums.map((a) => a.id));
  const loose = photos.filter((p) => p.albumId === null || !known.has(p.albumId));
  if (loose.length > 0 || groups.length === 0) groups.push({ albumId: null, title: albums.length > 0 ? "Not in an album" : "All photos", photos: loose });
  return groups;
}

/** Whether a post's form can be saved. */
export function postFormReady(title: string, body: string): boolean {
  return title.trim().length > 0 && body.trim().length > 0 && title.length <= WEBSITE_LIMITS.postTitle && body.length <= WEBSITE_LIMITS.postBody;
}
